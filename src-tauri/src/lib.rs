use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{ChildStderr, ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

const MAX_CONCURRENCY: i64 = 5;
const DEFAULT_CONCURRENCY: i64 = 1;

const ACTION_IDS: [&str; 2] = ["publish", "unpublish"];

const NODE_RESOURCE_CANDIDATES: [&str; 2] = ["node/node", "resources/node/node"];
const WORKER_RESOURCE_CANDIDATES: [&str; 3] = [
  "worker/publish-worker.js",
  "resources/worker/publish-worker.js",
  "publish-worker.js",
];

#[derive(Default)]
struct AppState {
  running: Arc<AtomicBool>,
  child_pid: Arc<Mutex<Option<u32>>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunPublishPayload {
  token: String,
  space_id: Option<String>,
  environment_id: Option<String>,
  tag_id: String,
  action: Option<String>,
  limit: i64,
  concurrency: Option<i64>,
  dry_run: Option<bool>,
  verbose: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadSpacesPayload {
  token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadEnvironmentsPayload {
  token: String,
  space_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadTagsPayload {
  token: String,
  space_id: String,
  environment_id: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct TagOption {
  id: String,
  name: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct SpaceOption {
  id: String,
  name: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct EnvironmentOption {
  id: String,
  name: String,
}

#[derive(Debug)]
struct ResolvedScopePayload {
  token: String,
  space_id: String,
  environment_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerPayload {
  token: String,
  space_id: String,
  environment_id: String,
  tag_id: String,
  action: String,
  limit: i64,
  concurrency: i64,
  dry_run: bool,
  verbose: bool,
}

fn normalize_optional(value: Option<String>) -> Option<String> {
  value.and_then(|v| {
    let trimmed = v.trim();
    if trimmed.is_empty() {
      None
    } else {
      Some(trimmed.to_string())
    }
  })
}

fn resolve_scope(
  space_id: Option<String>,
  environment_id: Option<String>,
) -> Result<(String, String), String> {
  let space_id = normalize_optional(space_id);
  let environment_id = normalize_optional(environment_id);

  if (space_id.is_some() && environment_id.is_none())
    || (space_id.is_none() && environment_id.is_some())
  {
    return Err("spaceId and environmentId must be provided together".to_string());
  }

  if let (Some(space_id), Some(environment_id)) = (space_id, environment_id) {
    return Ok((space_id, environment_id));
  }

  Err("spaceId and environmentId are required".to_string())
}

fn validate_payload(payload: RunPublishPayload) -> Result<WorkerPayload, String> {
  if payload.token.trim().is_empty() {
    return Err("token is required".to_string());
  }

  let (space_id, environment_id) = resolve_scope(payload.space_id, payload.environment_id)?;

  if payload.tag_id.trim().is_empty() {
    return Err("tagId is required".to_string());
  }

  let action = payload.action.unwrap_or_else(|| "publish".to_string());
  if !ACTION_IDS.contains(&action.as_str()) {
    return Err(format!("action must be one of: {}", ACTION_IDS.join(", ")));
  }

  if payload.limit <= 0 {
    return Err("limit must be a positive integer".to_string());
  }

  let concurrency = payload.concurrency.unwrap_or(DEFAULT_CONCURRENCY);
  if concurrency <= 0 {
    return Err("concurrency must be a positive integer".to_string());
  }

  if concurrency > MAX_CONCURRENCY {
    return Err(format!("concurrency must be at most {}", MAX_CONCURRENCY));
  }

  Ok(WorkerPayload {
    token: payload.token,
    space_id,
    environment_id,
    tag_id: payload.tag_id,
    action,
    limit: payload.limit,
    concurrency,
    dry_run: payload.dry_run.unwrap_or(false),
    verbose: payload.verbose.unwrap_or(false),
  })
}

fn validate_load_spaces_payload(payload: LoadSpacesPayload) -> Result<LoadSpacesPayload, String> {
  if payload.token.trim().is_empty() {
    return Err("token is required".to_string());
  }

  Ok(payload)
}

fn validate_load_environments_payload(
  payload: LoadEnvironmentsPayload,
) -> Result<LoadEnvironmentsPayload, String> {
  if payload.token.trim().is_empty() {
    return Err("token is required".to_string());
  }

  if payload.space_id.trim().is_empty() {
    return Err("spaceId is required".to_string());
  }

  Ok(payload)
}

fn validate_load_tags_payload(payload: LoadTagsPayload) -> Result<ResolvedScopePayload, String> {
  if payload.token.trim().is_empty() {
    return Err("token is required".to_string());
  }

  let space_id = payload.space_id.trim().to_string();
  if space_id.is_empty() {
    return Err("spaceId is required".to_string());
  }

  let environment_id = payload.environment_id.trim().to_string();
  if environment_id.is_empty() {
    return Err("environmentId is required".to_string());
  }

  Ok(ResolvedScopePayload {
    token: payload.token,
    space_id,
    environment_id,
  })
}

fn first_existing_path(candidates: Vec<PathBuf>) -> Option<PathBuf> {
  candidates.into_iter().find(|candidate| candidate.is_file())
}

#[cfg(unix)]
fn ensure_executable(path: &Path, label: &str) -> Result<(), String> {
  use std::os::unix::fs::PermissionsExt;

  let mode = std::fs::metadata(path)
    .map_err(|error| format!("Failed to read bundled {label} permissions: {error}"))?
    .permissions()
    .mode();

  if mode & 0o111 == 0 {
    return Err(format!(
      "Bundled {label} at {} is not executable. Reinstall the desktop app bundle.",
      path.display()
    ));
  }

  Ok(())
}

fn resolve_bundled_resource(
  app: &AppHandle,
  candidates: &[&str],
  label: &str,
) -> Result<PathBuf, String> {
  let mut resolved_paths = Vec::with_capacity(candidates.len());

  for candidate in candidates {
    let resolved = app
      .path()
      .resolve(candidate, BaseDirectory::Resource)
      .map_err(|error| format!("Failed to resolve bundled {label} path: {error}"))?;
    resolved_paths.push(resolved);
  }

  first_existing_path(resolved_paths).ok_or_else(|| {
    format!(
      "Bundled {label} resource is missing. Reinstall the desktop app bundle."
    )
  })
}

fn resolve_bundled_node_path(app: &AppHandle) -> Result<PathBuf, String> {
  let node_path = resolve_bundled_resource(app, &NODE_RESOURCE_CANDIDATES, "Node runtime")?;

  #[cfg(unix)]
  ensure_executable(&node_path, "Node runtime")?;

  Ok(node_path)
}

fn resolve_bundled_worker_path(app: &AppHandle) -> Result<PathBuf, String> {
  resolve_bundled_resource(app, &WORKER_RESOURCE_CANDIDATES, "worker script")
}

fn emit_publish_error(app: &AppHandle, message: &str) {
  let _ = app.emit("publish-error", json!({ "type": "error", "message": message }));
}

fn spawn_stdout_reader(
  stdout: ChildStdout,
  app: AppHandle,
  done_emitted: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
  thread::spawn(move || {
    let reader = BufReader::new(stdout);
    for line_result in reader.lines() {
      match line_result {
        Ok(line) => {
          let trimmed = line.trim();
          if trimmed.is_empty() {
            continue;
          }

          match serde_json::from_str::<Value>(trimmed) {
            Ok(payload) => {
              let event_type = payload
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or("log");

              match event_type {
                "log" => {
                  let _ = app.emit("publish-log", payload);
                }
                "done" => {
                  done_emitted.store(true, Ordering::SeqCst);
                  let _ = app.emit("publish-done", payload);
                }
                "error" => {
                  let _ = app.emit("publish-error", payload);
                }
                _ => {
                  let _ = app.emit(
                    "publish-log",
                    json!({
                      "type": "log",
                      "level": "info",
                      "message": trimmed,
                    }),
                  );
                }
              }
            }
            Err(_) => {
              let _ = app.emit(
                "publish-log",
                json!({
                  "type": "log",
                  "level": "info",
                  "message": trimmed,
                }),
              );
            }
          }
        }
        Err(error) => {
          emit_publish_error(&app, &format!("Failed to read worker stdout: {error}"));
          return;
        }
      }
    }
  })
}

fn spawn_stderr_reader(stderr: ChildStderr, app: AppHandle) -> thread::JoinHandle<()> {
  thread::spawn(move || {
    let reader = BufReader::new(stderr);
    for line_result in reader.lines() {
      match line_result {
        Ok(line) => {
          let trimmed = line.trim();
          if trimmed.is_empty() {
            continue;
          }
          emit_publish_error(&app, trimmed);
        }
        Err(error) => {
          emit_publish_error(&app, &format!("Failed to read worker stderr: {error}"));
          return;
        }
      }
    }
  })
}

fn terminate_worker_if_running(state: &AppState) {
  let pid = {
    if let Ok(mut guard) = state.child_pid.lock() {
      guard.take()
    } else {
      None
    }
  };

  if let Some(pid) = pid {
    let _ = Command::new("kill")
      .arg("-TERM")
      .arg(pid.to_string())
      .status();
  }

  state.running.store(false, Ordering::SeqCst);
}

fn run_worker_request(app: &AppHandle, worker_payload: String) -> Result<Value, String> {
  let bundled_node = resolve_bundled_node_path(app)?;
  let worker_script = resolve_bundled_worker_path(app)?;

  let output = Command::new(&bundled_node)
    .arg(&worker_script)
    .arg(worker_payload)
    .output()
    .map_err(|error| {
      format!(
        "Failed to launch bundled worker runtime (`{} {}`): {error}",
        bundled_node.display(),
        worker_script.display()
      )
    })?;

  let stdout_text = String::from_utf8_lossy(&output.stdout);
  let stderr_text = String::from_utf8_lossy(&output.stderr).trim().to_string();

  let mut done_summary: Option<Value> = None;
  let mut worker_error: Option<String> = None;

  for line in stdout_text.lines() {
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }

    let payload: Value = match serde_json::from_str(trimmed) {
      Ok(value) => value,
      Err(_) => continue,
    };

    match payload.get("type").and_then(Value::as_str) {
      Some("error") => {
        worker_error = payload
          .get("message")
          .and_then(Value::as_str)
          .map(|message| message.to_string());
      }
      Some("done") => {
        done_summary = payload.get("summary").cloned();
      }
      _ => {}
    }
  }

  if let Some(message) = worker_error {
    return Err(message);
  }

  if let Some(summary) = done_summary {
    return Ok(summary);
  }

  if !output.status.success() {
    if !stderr_text.is_empty() {
      return Err(stderr_text);
    }

    return Err(format!(
      "Worker exited with code {:?}",
      output.status.code()
    ));
  }

  Err("Worker did not return a done summary".to_string())
}

#[tauri::command]
fn load_spaces(
  app: AppHandle,
  payload: LoadSpacesPayload,
  state: State<AppState>,
) -> Result<Vec<SpaceOption>, String> {
  if state.running.load(Ordering::SeqCst) {
    return Err("Cannot load spaces while a publish job is running".to_string());
  }

  let payload = validate_load_spaces_payload(payload)?;
  let worker_payload = serde_json::to_string(&json!({
    "command": "load-spaces",
    "token": payload.token,
  }))
  .map_err(|error| format!("Failed to serialize worker payload: {error}"))?;

  let summary = run_worker_request(&app, worker_payload)?;
  serde_json::from_value(
    summary
      .get("spaces")
      .cloned()
      .unwrap_or_else(|| Value::Array(Vec::new())),
  )
  .map_err(|error| format!("Failed to parse spaces response: {error}"))
}

#[tauri::command]
fn load_environments(
  app: AppHandle,
  payload: LoadEnvironmentsPayload,
  state: State<AppState>,
) -> Result<Vec<EnvironmentOption>, String> {
  if state.running.load(Ordering::SeqCst) {
    return Err("Cannot load environments while a publish job is running".to_string());
  }

  let payload = validate_load_environments_payload(payload)?;
  let worker_payload = serde_json::to_string(&json!({
    "command": "load-environments",
    "token": payload.token,
    "spaceId": payload.space_id,
  }))
  .map_err(|error| format!("Failed to serialize worker payload: {error}"))?;

  let summary = run_worker_request(&app, worker_payload)?;
  serde_json::from_value(
    summary
      .get("environments")
      .cloned()
      .unwrap_or_else(|| Value::Array(Vec::new())),
  )
  .map_err(|error| format!("Failed to parse environments response: {error}"))
}

#[tauri::command]
fn load_tags(
  app: AppHandle,
  payload: LoadTagsPayload,
  state: State<AppState>,
) -> Result<Vec<TagOption>, String> {
  if state.running.load(Ordering::SeqCst) {
    return Err("Cannot load tags while a publish job is running".to_string());
  }

  let payload = validate_load_tags_payload(payload)?;
  let worker_payload = serde_json::to_string(&json!({
    "command": "load-tags",
    "token": payload.token,
    "spaceId": payload.space_id,
    "environmentId": payload.environment_id,
  }))
  .map_err(|error| format!("Failed to serialize worker payload: {error}"))?;

  let summary = run_worker_request(&app, worker_payload)?;
  serde_json::from_value(
    summary
      .get("tags")
      .cloned()
      .unwrap_or_else(|| Value::Array(Vec::new())),
  )
  .map_err(|error| format!("Failed to parse tags response: {error}"))
}

#[tauri::command]
fn run_publish(
  app: AppHandle,
  payload: RunPublishPayload,
  state: State<AppState>,
) -> Result<(), String> {
  let payload = validate_payload(payload)?;

  if state.running.swap(true, Ordering::SeqCst) {
    return Err("A publish job is already running".to_string());
  }

  let worker_payload = serde_json::to_string(&payload)
    .map_err(|error| format!("Failed to serialize worker payload: {error}"))?;

  let bundled_node = match resolve_bundled_node_path(&app) {
    Ok(path) => path,
    Err(error) => {
      state.running.store(false, Ordering::SeqCst);
      return Err(error);
    }
  };

  let worker_script = match resolve_bundled_worker_path(&app) {
    Ok(path) => path,
    Err(error) => {
      state.running.store(false, Ordering::SeqCst);
      return Err(error);
    }
  };

  let mut command = Command::new(&bundled_node);
  command
    .arg(&worker_script)
    .arg(&worker_payload)
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());

  let mut child = command
    .spawn()
    .map_err(|error| {
      state.running.store(false, Ordering::SeqCst);
      format!(
        "Failed to launch bundled worker runtime (`{} {}`): {error}",
        bundled_node.display(),
        worker_script.display()
      )
    })?;

  let pid = child.id();

  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| {
      state.running.store(false, Ordering::SeqCst);
      "Failed to capture worker stdout".to_string()
    })?;
  let stderr = child
    .stderr
    .take()
    .ok_or_else(|| {
      state.running.store(false, Ordering::SeqCst);
      "Failed to capture worker stderr".to_string()
    })?;

  {
    let mut guard = state
      .child_pid
      .lock()
      .map_err(|_| {
        state.running.store(false, Ordering::SeqCst);
        "Failed to lock worker state".to_string()
      })?;
    *guard = Some(pid);
  }

  let running = Arc::clone(&state.running);
  let pid_slot = Arc::clone(&state.child_pid);
  let app_for_thread = app.clone();

  thread::spawn(move || {
    let done_emitted = Arc::new(AtomicBool::new(false));
    let stdout_reader = spawn_stdout_reader(stdout, app_for_thread.clone(), Arc::clone(&done_emitted));
    let stderr_reader = spawn_stderr_reader(stderr, app_for_thread.clone());

    let status_result = child.wait();

    let _ = stdout_reader.join();
    let _ = stderr_reader.join();

    match status_result {
      Ok(status) => {
        if !done_emitted.load(Ordering::SeqCst) {
          let _ = app_for_thread.emit(
            "publish-done",
            json!({
              "type": "done",
              "success": status.success(),
              "exitCode": status.code(),
            }),
          );
        }

        if !status.success() {
          emit_publish_error(
            &app_for_thread,
            &format!("Worker exited with code {:?}", status.code()),
          );
        }
      }
      Err(error) => {
        emit_publish_error(
          &app_for_thread,
          &format!("Failed while waiting for worker process: {error}"),
        );
        let _ = app_for_thread.emit(
          "publish-done",
          json!({
            "type": "done",
            "success": false,
          }),
        );
      }
    }

    running.store(false, Ordering::SeqCst);
    if let Ok(mut guard) = pid_slot.lock() {
      *guard = None;
    }
  });

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let app = tauri::Builder::default()
    .manage(AppState::default())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      run_publish,
      load_spaces,
      load_environments,
      load_tags
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|app_handle, event| {
    if matches!(event, RunEvent::ExitRequested { .. }) {
      if let Some(state) = app_handle.try_state::<AppState>() {
        terminate_worker_if_running(state.inner());
      }
    }
  });
}

#[cfg(test)]
mod tests {
  use super::{
    ensure_executable, first_existing_path, validate_load_tags_payload, validate_payload,
    LoadTagsPayload, RunPublishPayload,
  };
  use std::env;
  use std::fs;
  use std::path::PathBuf;

  #[test]
  fn validate_payload_accepts_explicit_scope() {
    let result = validate_payload(RunPublishPayload {
      token: "token".to_string(),
      space_id: Some("demo-space".to_string()),
      environment_id: Some("demo-env".to_string()),
      tag_id: "demo-tag".to_string(),
      action: Some("publish".to_string()),
      limit: 1,
      concurrency: Some(1),
      dry_run: Some(true),
      verbose: Some(false),
    })
    .expect("payload should be valid");

    assert_eq!(result.space_id, "demo-space");
    assert_eq!(result.environment_id, "demo-env");
    assert_eq!(result.action, "publish");
  }

  #[test]
  fn validate_payload_rejects_missing_scope() {
    let result = validate_payload(RunPublishPayload {
      token: "token".to_string(),
      space_id: None,
      environment_id: None,
      tag_id: "demo-tag".to_string(),
      action: Some("publish".to_string()),
      limit: 1,
      concurrency: Some(1),
      dry_run: Some(false),
      verbose: Some(false),
    });

    assert_eq!(result.unwrap_err(), "spaceId and environmentId are required");
  }

  #[test]
  fn validate_load_tags_payload_rejects_missing_environment() {
    let result = validate_load_tags_payload(LoadTagsPayload {
      token: "token".to_string(),
      space_id: "demo-space".to_string(),
      environment_id: "  ".to_string(),
    });

    assert_eq!(result.unwrap_err(), "environmentId is required");
  }

  #[test]
  fn first_existing_path_returns_first_match() {
    let temp_dir = env::temp_dir().join(format!(
      "bulk-content-operations-resource-test-{}",
      std::process::id()
    ));
    let _ = fs::create_dir_all(&temp_dir);

    let missing = temp_dir.join("missing");
    let existing = temp_dir.join("worker.js");
    fs::write(&existing, "ok").expect("failed to write fake worker file");

    let selected = first_existing_path(vec![missing, existing.clone()]);
    assert_eq!(selected, Some(existing));

    let _ = fs::remove_dir_all(temp_dir);
  }

  #[test]
  fn first_existing_path_returns_none_when_no_files_exist() {
    let selected = first_existing_path(vec![
      PathBuf::from("/path/does/not/exist-a"),
      PathBuf::from("/path/does/not/exist-b"),
    ]);

    assert_eq!(selected, None);
  }

  #[cfg(unix)]
  #[test]
  fn ensure_executable_rejects_non_executable_file() {
    use std::os::unix::fs::PermissionsExt;

    let temp_dir = env::temp_dir().join(format!(
      "bulk-content-operations-node-mode-test-{}",
      std::process::id()
    ));
    let _ = fs::create_dir_all(&temp_dir);
    let node_path = temp_dir.join("node");

    fs::write(&node_path, "#!/bin/sh\n").expect("failed to create fake node executable");
    let mut permissions = fs::metadata(&node_path)
      .expect("metadata should exist")
      .permissions();
    permissions.set_mode(0o644);
    fs::set_permissions(&node_path, permissions).expect("failed to set file permissions");

    let result = ensure_executable(&node_path, "Node runtime");
    assert!(result.is_err());

    let _ = fs::remove_file(&node_path);

    let _ = fs::remove_dir_all(temp_dir);
  }
}
