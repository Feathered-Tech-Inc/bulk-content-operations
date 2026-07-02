# Contributing

Thanks for your interest in contributing to `Bulk Content Operations`.

## Development setup

```bash
pnpm install
cp .env.example .env
```

Set `CONTENTFUL_CMA_TOKEN` in `.env` for local CLI usage.

## Development Workflow

To ensure code quality and security, direct pushes to `main` and `dev` are disabled. All changes must be made via Pull Requests.

1. Fork the repository and create your feature branch from `dev`.
2. Make your changes.
3. Run the local checks before committing.
4. Open a Pull Request against `dev`.

## Code Quality and Local Checks

We use ESLint for linting and Prettier for formatting. A pre-commit hook will automatically run checks when you try to commit, but you can also run them manually:

- `pnpm run format` - Auto-formats all code according to our `.prettierrc` rules.
- `pnpm run lint` - Checks for code issues and bugs.
- `pnpm run typecheck` - Validates TypeScript types.
- `pnpm run test` - Runs the test suite.

## Before opening a pull request

Run:

```bash
pnpm run precommit:checks
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

When you open a Pull Request, our GitHub Actions pipeline will automatically run:

- **Gitleaks**: Scans for accidentally committed secrets or tokens.
- **Lint & Format Check**: Ensures the code matches our style guide.
- **Tests & Typecheck**: Verifies the code compiles and tests pass.

_Your PR must pass all CI checks and be approved by a code owner before it can be merged._

## Reporting issues

- Use GitHub Issues for bugs and feature requests.
- For security issues, follow `SECURITY.md`.

## Community expectations

By participating, you agree to follow `CODE_OF_CONDUCT.md`.
