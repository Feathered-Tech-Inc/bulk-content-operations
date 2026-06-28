const statusIndicator = document.getElementById('status-indicator');
const statusDetail = document.getElementById('status-detail');
const summary = document.getElementById('summary');
const logs = document.getElementById('logs');
const validation = document.getElementById('validation');

const form = document.getElementById('publish-form');
const tokenInput = document.getElementById('token');
const spaceInput = document.getElementById('space');
const environmentInput = document.getElementById('environment');
const actionInput = document.getElementById('action');
const tagInput = document.getElementById('tag');
const loadSpacesButton = document.getElementById('load-spaces-button');
const loadEnvironmentsButton = document.getElementById('load-environments-button');
const loadTagsButton = document.getElementById('load-tags-button');
const limitInput = document.getElementById('limit');
const concurrencyInput = document.getElementById('concurrency');
const dryRunInput = document.getElementById('dry-run');
const verboseInput = document.getElementById('verbose');
const rememberTokenInput = document.getElementById('remember-token');
const runButton = document.getElementById('run-button');
const clearLogsButton = document.getElementById('clear-logs-button');

const tauri = window.__TAURI__;
const invoke = tauri?.core?.invoke;
const listen = tauri?.event?.listen;

let running = false;
let loadingSpaces = false;
let loadingEnvironments = false;
let loadingTags = false;
let loadedEnvironmentSpaceId = '';
let loadedTagScope = '';

function currentScopeKey() {
  return `${spaceInput.value}::${environmentInput.value}`;
}

function appendLog(message, level = 'info') {
  const line = document.createElement('p');
  line.className = `log-line ${level === 'error' ? 'log-error' : ''}`.trim();
  line.textContent = message;
  logs.appendChild(line);
  logs.scrollTop = logs.scrollHeight;
}

function clearValidation() {
  validation.textContent = '';
}

function showValidation(message) {
  validation.textContent = message;
}

function setStatus(kind, detail = '') {
  statusIndicator.className = `status ${kind}`;

  if (kind === 'idle') {
    statusIndicator.textContent = 'Idle';
  } else if (kind === 'running') {
    statusIndicator.textContent = 'Running';
  } else if (kind === 'success') {
    statusIndicator.textContent = 'Success';
  } else {
    statusIndicator.textContent = 'Failure';
  }

  statusDetail.textContent = detail;
}

function setRunningState(nextRunning) {
  running = nextRunning;
  runButton.disabled = running;
  loadSpacesButton.disabled = running || loadingSpaces;
  loadEnvironmentsButton.disabled = running || loadingEnvironments;
  loadTagsButton.disabled = running || loadingTags;
}

function setSelectOptions(select, options, placeholder) {
  select.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  for (const option of options) {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.name;
    select.appendChild(node);
  }
}

function setSpaceOptions(options, placeholder = 'Select a space') {
  setSelectOptions(spaceInput, options, placeholder);
}

function setEnvironmentOptions(options, placeholder = 'Select an environment') {
  setSelectOptions(environmentInput, options, placeholder);
}

function setTagOptions(options, placeholder = 'Select a tag') {
  setSelectOptions(tagInput, options, placeholder);
}

function setLoadingSpaces(nextLoading) {
  loadingSpaces = nextLoading;
  loadSpacesButton.disabled = running || loadingSpaces;
  loadSpacesButton.textContent = loadingSpaces ? 'Loading spaces…' : 'Load spaces';
}

function setLoadingEnvironments(nextLoading) {
  loadingEnvironments = nextLoading;
  loadEnvironmentsButton.disabled = running || loadingEnvironments;
  loadEnvironmentsButton.textContent = loadingEnvironments
    ? 'Loading environments…'
    : 'Load environments';
}

function setLoadingTags(nextLoading) {
  loadingTags = nextLoading;
  loadTagsButton.disabled = running || loadingTags;
  loadTagsButton.textContent = loadingTags ? 'Loading tags…' : 'Load tags';
}

function parseNamedOptions(response) {
  return Array.isArray(response)
    ? response
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const id = typeof item.id === 'string' ? item.id : '';
          const name = typeof item.name === 'string' ? item.name : id;
          return { id, name };
        })
        .filter((item) => item.id)
    : [];
}

function parseInteger(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isInteger(numeric) ? numeric : Number.NaN;
}

function validatePayload(payload) {
  if (!payload.token.trim()) {
    return 'Token is required.';
  }

  if (!payload.spaceId) {
    return 'Space is required.';
  }

  if (!payload.environmentId) {
    return 'Environment is required.';
  }

  if (payload.action !== 'publish' && payload.action !== 'unpublish') {
    return 'Action must be publish or unpublish.';
  }

  if (!payload.tagId) {
    return 'Tag is required.';
  }

  if (!Number.isInteger(payload.limit) || payload.limit <= 0) {
    return 'Limit must be a positive integer.';
  }

  if (!Number.isInteger(payload.concurrency) || payload.concurrency <= 0) {
    return 'Concurrency must be a positive integer.';
  }

  if (payload.concurrency > 5) {
    return 'Concurrency must be at most 5.';
  }

  return null;
}

function buildPayloadFromForm() {
  return {
    token: tokenInput.value,
    spaceId: spaceInput.value,
    environmentId: environmentInput.value,
    action: actionInput.value,
    tagId: tagInput.value,
    limit: parseInteger(limitInput.value),
    concurrency: parseInteger(concurrencyInput.value || '1'),
    dryRun: dryRunInput.checked,
    verbose: verboseInput.checked,
  };
}

function formatSummary(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'No summary returned.';
  }

  const summaryPayload = payload.summary ?? payload;
  if (!summaryPayload || typeof summaryPayload !== 'object') {
    return 'No summary returned.';
  }

  const lines = [];
  if (summaryPayload.spaceId) {
    lines.push(`Space: ${summaryPayload.spaceId}`);
  }
  if (summaryPayload.environmentId) {
    lines.push(`Environment: ${summaryPayload.environmentId}`);
  }
  if (summaryPayload.action) {
    lines.push(`Action: ${summaryPayload.action}`);
  }
  if (summaryPayload.tagId) {
    lines.push(`Tag: ${summaryPayload.tagId}`);
  }
  if (Number.isInteger(summaryPayload.scannedCount)) {
    lines.push(`Scanned: ${summaryPayload.scannedCount}`);
  }
  if (Number.isInteger(summaryPayload.publishableCount)) {
    lines.push(`Publishable: ${summaryPayload.publishableCount}`);
  }
  if (Number.isInteger(summaryPayload.selectedCount)) {
    lines.push(`Selected: ${summaryPayload.selectedCount}`);
  }
  if (Number.isInteger(summaryPayload.publishedCount)) {
    const action =
      summaryPayload.action === 'unpublish' ? 'Unpublished' : 'Published';
    lines.push(`${action}: ${summaryPayload.publishedCount}`);
  }
  if (Number.isInteger(summaryPayload.failedCount)) {
    lines.push(`Failed: ${summaryPayload.failedCount}`);
  }

  if (summaryPayload.dryRun) {
    lines.push('Mode: dry run');
  }

  if (lines.length === 0) {
    return JSON.stringify(summaryPayload, null, 2);
  }

  return lines.join('\n');
}

function normalizeLogPayload(rawPayload) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { message: String(rawPayload), level: 'info' };
  }

  return {
    message:
      typeof rawPayload.message === 'string'
        ? rawPayload.message
        : JSON.stringify(rawPayload),
    level: rawPayload.level === 'error' ? 'error' : 'info',
  };
}

async function registerListeners() {
  if (!listen) {
    showValidation('Tauri event API is unavailable.');
    runButton.disabled = true;
    loadSpacesButton.disabled = true;
    loadEnvironmentsButton.disabled = true;
    loadTagsButton.disabled = true;
    return;
  }

  await listen('publish-log', (event) => {
    const payload = normalizeLogPayload(event.payload);
    appendLog(payload.message, payload.level);
  });

  await listen('publish-error', (event) => {
    const payload = normalizeLogPayload(event.payload);
    appendLog(payload.message, 'error');
    setStatus('failure', payload.message);
  });

  await listen('publish-done', (event) => {
    setRunningState(false);

    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    const success = payload.success !== false;

    setStatus(success ? 'success' : 'failure', success ? 'Run completed.' : 'Run failed.');
    summary.textContent = formatSummary(payload);
  });
}

loadSpacesButton.addEventListener('click', async () => {
  if (running || loadingSpaces) {
    return;
  }

  if (!invoke) {
    showValidation('Tauri invoke API is unavailable.');
    return;
  }

  clearValidation();

  const token = tokenInput.value.trim();
  if (!token) {
    showValidation('Token is required to load spaces.');
    return;
  }

  setLoadingSpaces(true);
  appendLog('Loading accessible spaces...');

  try {
    const response = await invoke('load_spaces', {
      payload: {
        token,
      },
    });
    const spaces = parseNamedOptions(response);

    loadedEnvironmentSpaceId = '';
    loadedTagScope = '';
    setEnvironmentOptions([], 'Load environments first');
    setTagOptions([], 'Load tags first');

    if (spaces.length === 0) {
      setSpaceOptions([], 'No accessible spaces found');
      appendLog('No accessible spaces were returned.');
      return;
    }

    setSpaceOptions(spaces, 'Select a space');
    appendLog(`Loaded ${spaces.length} space(s).`);
  } catch (error) {
    setSpaceOptions([], 'Failed to load spaces');
    const message = error instanceof Error ? error.message : String(error);
    showValidation(`Failed to load spaces: ${message}`);
    appendLog(`Failed to load spaces: ${message}`, 'error');
  } finally {
    setLoadingSpaces(false);
  }
});

loadEnvironmentsButton.addEventListener('click', async () => {
  if (running || loadingEnvironments) {
    return;
  }

  if (!invoke) {
    showValidation('Tauri invoke API is unavailable.');
    return;
  }

  clearValidation();

  const token = tokenInput.value.trim();
  const spaceId = spaceInput.value;

  if (!token) {
    showValidation('Token is required to load environments.');
    return;
  }

  if (!spaceId) {
    showValidation('Space is required to load environments.');
    return;
  }

  setLoadingEnvironments(true);
  appendLog(`Loading environments for space ${spaceId}...`);

  try {
    const response = await invoke('load_environments', {
      payload: {
        token,
        spaceId,
      },
    });
    const environments = parseNamedOptions(response);

    loadedEnvironmentSpaceId = spaceId;
    loadedTagScope = '';
    setTagOptions([], 'Load tags first');

    if (environments.length === 0) {
      setEnvironmentOptions([], 'No accessible environments found');
      appendLog('No accessible environments were returned for this space.');
      return;
    }

    setEnvironmentOptions(environments, 'Select an environment');
    appendLog(`Loaded ${environments.length} environment(s).`);
  } catch (error) {
    setEnvironmentOptions([], 'Failed to load environments');
    const message = error instanceof Error ? error.message : String(error);
    showValidation(`Failed to load environments: ${message}`);
    appendLog(`Failed to load environments: ${message}`, 'error');
  } finally {
    setLoadingEnvironments(false);
  }
});

loadTagsButton.addEventListener('click', async () => {
  if (running || loadingTags) {
    return;
  }

  if (!invoke) {
    showValidation('Tauri invoke API is unavailable.');
    return;
  }

  clearValidation();

  const token = tokenInput.value.trim();
  const spaceId = spaceInput.value;
  const environmentId = environmentInput.value;

  if (!token) {
    showValidation('Token is required to load tags.');
    return;
  }

  if (!spaceId) {
    showValidation('Space is required to load tags.');
    return;
  }

  if (!environmentId) {
    showValidation('Environment is required to load tags.');
    return;
  }

  setLoadingTags(true);
  appendLog(`Loading tags for ${spaceId}/${environmentId}...`);

  try {
    const response = await invoke('load_tags', {
      payload: {
        token,
        spaceId,
        environmentId,
      },
    });

    const tags = parseNamedOptions(response);

    if (tags.length === 0) {
      setTagOptions([], 'No accessible tags found');
      loadedTagScope = currentScopeKey();
      appendLog('No accessible tags were returned for this scope.');
      return;
    }

    setTagOptions(tags, 'Select a tag');
    loadedTagScope = currentScopeKey();
    appendLog(`Loaded ${tags.length} tag(s).`);
  } catch (error) {
    setTagOptions([], 'Failed to load tags');
    const message = error instanceof Error ? error.message : String(error);
    showValidation(`Failed to load tags: ${message}`);
    appendLog(`Failed to load tags: ${message}`, 'error');
  } finally {
    setLoadingTags(false);
  }
});

spaceInput.addEventListener('change', () => {
  if (!spaceInput.value || spaceInput.value !== loadedEnvironmentSpaceId) {
    setEnvironmentOptions([], 'Load environments first');
  }
  if (!spaceInput.value || currentScopeKey() !== loadedTagScope) {
    setTagOptions([], 'Load tags first');
  }
});

environmentInput.addEventListener('change', () => {
  if (!environmentInput.value || currentScopeKey() !== loadedTagScope) {
    setTagOptions([], 'Load tags first');
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (running) {
    return;
  }

  if (!invoke) {
    showValidation('Tauri invoke API is unavailable.');
    return;
  }

  clearValidation();

  if (spaceInput.value !== loadedEnvironmentSpaceId) {
    setEnvironmentOptions([], 'Load environments first');
  }

  if (currentScopeKey() !== loadedTagScope) {
    setTagOptions([], 'Load tags first');
  }

  const payload = buildPayloadFromForm();
  const validationError = validatePayload(payload);
  if (validationError) {
    showValidation(validationError);
    return;
  }

  if (rememberTokenInput.checked) {
    appendLog(
      'Secure token storage is not enabled yet in this build. The token is only used in-memory for this run.',
      'info',
    );
  }

  setRunningState(true);
  const actionLabel = payload.action === 'unpublish' ? 'Unpublish' : 'Publish';
  setStatus('running', `${actionLabel} job started...`);
  summary.textContent = 'Waiting for result...';
  appendLog(`Starting ${payload.action} job...`);

  try {
    await invoke('run_publish', { payload });
  } catch (error) {
    setRunningState(false);
    const message = error instanceof Error ? error.message : String(error);
    appendLog(message, 'error');
    setStatus('failure', message);
    summary.textContent = 'Run failed before worker started.';
  }
});

clearLogsButton.addEventListener('click', () => {
  logs.innerHTML = '';
});

registerListeners().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  showValidation(`Failed to register desktop events: ${message}`);
  runButton.disabled = true;
});