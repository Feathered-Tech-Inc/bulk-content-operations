# Bulk Content Operations

Bulk-publish or bulk-unpublish Contentful entries for a selected `spaceId` / `environmentId` / `tagId`.

This repo includes:

- a CLI workflow (`pnpm run publish ...`)
- a Tauri desktop app for non-technical users (`pnpm run tauri:dev`)

Runs support both `publish` and `unpublish` actions. Use `--limit` to cap how many entries are processed per run. Entry listing uses cursor pagination (1000 per page). Requests larger than 200 entries are automatically split into multiple bulk actions (Contentful's per-action limit).

## Runtime requirements

### End users (desktop app)

- Apple Silicon macOS (`arm64`) only
- No local `node`, `pnpm`, `tsx`, or `ts-node` install required for desktop app usage
- A Contentful **Management API (CMA)** token with publish permissions

### Contributors (local development/build)

- Node.js 18+
- pnpm
- Rust toolchain (`rustup`, `cargo`) for desktop app build/dev
- Xcode Command Line Tools (macOS)
- A Contentful **Management API (CMA)** token with publish permissions

## Setup (contributors)

```bash
pnpm install
cp .env.example .env
# Set CONTENTFUL_CMA_TOKEN in .env for CLI usage
```

Please see `CONTRIBUTING.md` for details on our development workflow, linting, and pull request requirements.

## CLI usage

Required flags:

- `--space`
- `--environment`
- `--tag`
- `--limit`

```bash
# Publish dry-run
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --limit 10 --dry-run

# Unpublish run
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --action unpublish --limit 10

# Large parallel run
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --limit 90000 --concurrency 5
```

## Desktop app (Tauri)

Desktop runtime model:

- Worker build artifact: `dist/publish-worker.js`
- Bundled Node runtime: `src-tauri/resources/node/node` (auto-fetched at build/dev, pinned `v22.15.0` for `darwin-arm64`)
- Bundled worker resource: `src-tauri/resources/worker/publish-worker.js`
- Runtime cache location: `.cache/node-runtime/` (tarball + `SHASUMS256.txt`)
- `pnpm run tauri:dev` and `pnpm run tauri:build` automatically prebuild the worker and prepare the Node runtime

The Node binary is not stored in git. It is downloaded during `tauri:dev` / `tauri:build`, verified against the official Node `SHASUMS256.txt`, then copied to `src-tauri/resources/node/node` with executable permissions.

### Run in development

```bash
pnpm run tauri:dev
```

### Build macOS artifacts

```bash
pnpm run tauri:build
```

Artifacts are generated at:

- `.app`: `src-tauri/target/release/bundle/macos/Bulk Content Operations.app`
- `.dmg`: `src-tauri/target/release/bundle/dmg/Bulk Content Operations_0.1.0_aarch64.dmg`

Install flow (end users):

1. Download/open the generated `.dmg`.
2. Drag `Bulk Content Operations.app` into `Applications`.
3. Launch app and run jobs without installing Node/pnpm locally.

### Desktop user flow

1. Open the app.
2. Enter CMA token.
3. Load and select a space.
4. Load and select an environment.
5. Load and select a tag.
6. Select action (`publish` or `unpublish`).
7. Enter limit and optional concurrency (1..5).
8. Toggle dry-run / verbose.
9. Click **Run**.
10. Watch real-time logs and final summary.

## Token handling

- By default, token is used in-memory only during a run.
- Plaintext persistence is not enabled.
- “Remember token securely” is currently a placeholder; secure keychain storage is a follow-up item.

## Environment variables (CLI)

| Variable               | Required | Description                                  |
| ---------------------- | -------- | -------------------------------------------- |
| `CONTENTFUL_CMA_TOKEN` | yes      | CMA token with publish/unpublish permissions |

## CLI flags

| Flag               | Required | Description                                               |
| ------------------ | -------- | --------------------------------------------------------- |
| `--space ID`       | yes      | Contentful space ID                                       |
| `--environment ID` | yes      | Contentful environment ID                                 |
| `--tag ID`         | yes      | Tag to filter entries for publish/unpublish               |
| `--action MODE`    | no       | `publish` (default) or `unpublish`                        |
| `--limit N`        | yes      | Process at most `N` actionable entries                    |
| `--concurrency N`  | no       | Run up to `N` bulk actions in parallel (max 5, default 1) |
| `--dry-run`        | no       | List entry IDs without mutating content                   |
| `--verbose`        | no       | Log content type and version per entry                    |

## Staged rollout

Run multiple times with increasing limits:

```bash
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --action publish --limit 5 --dry-run
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --action publish --limit 5
pnpm run publish -- --space example-space-id --environment example-env --tag example-tag --action unpublish --limit 20
```

Exit code is `0` on success and `1` if any bulk action fails or required arguments are missing.
