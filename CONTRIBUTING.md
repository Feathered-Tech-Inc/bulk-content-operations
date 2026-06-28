# Contributing

Thanks for your interest in contributing to `Bulk Content Operations`.

## Development setup

```bash
pnpm install
cp .env.example .env
```

Set `CONTENTFUL_CMA_TOKEN` in `.env` for local CLI usage.

## Before opening a pull request

Run:

```bash
pnpm run typecheck
pnpm run test
```

If your change affects desktop behavior, also run:

```bash
pnpm run tauri:dev
```

## Pull request guidelines

- Keep changes focused and scoped.
- Update docs when behavior or user flows change.
- Use generic placeholders in examples (for example `example-space-id`, `example-env`, `example-tag`).
- Do not commit secrets or local environment files.

## Reporting issues

- Use GitHub Issues for bugs and feature requests.
- For security issues, follow `SECURITY.md`.

## Community expectations

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
