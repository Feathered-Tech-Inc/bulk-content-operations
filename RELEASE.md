# RELEASE.md

## Purpose

Standard process for producing a **signed + notarized macOS DMG** for public OSS release.

---

## Maintainer responsibilities

- Ensure release credentials are managed securely.
- Run build/sign/notarization checks before publishing artifacts.
- Publish artifacts and checksums with traceability metadata.

---

## Release prerequisites (maintainer machine or CI)

- Apple Developer account access (team with Developer ID cert).
- Installed cert in Keychain:
    - `Developer ID Application: <Org/Name> (<TEAM_ID>)`
- Notary credentials stored once:
    - `xcrun notarytool store-credentials "<PROFILE>" ...`
- Tooling installed:
    - Node 18+, `pnpm`, Rust toolchain, Xcode CLT.

---

## Release Workflow

We use a Pull Request-based release flow to ensure main branch protection and synchronized versioning.

### 1. Bump version and create release branch

Run the bump script. This automatically switches to the `dev` branch, pulls the latest changes, updates all version files (`package.json`, `tauri.conf.json`, `Cargo.toml`), commits them, and pushes a new `release/vX.X.X` branch.

```bash
# Defaults to patch. Use --minor or --major as needed.
./bump-version.sh
```

### 2. Merge Pull Requests

If you have the GitHub CLI (`gh`) installed, the pull requests to `main` and `dev` will be created automatically by the script. Otherwise, go to GitHub and open Pull Requests from your new `release/vX.X.X` branch into **both** `main` and `dev` manually.

Wait for CI checks to pass, then merge both pull requests.

### 3. Tag and build artifacts

Once merged, run the build script. This will automatically switch to `main`, pull the latest changes, officially tag the release, push the tag, and generate the signed/notarized `.dmg` along with the release notes.

```bash
./build-release.sh
```

_(Note: Ensure your `APPLE_SIGNING_IDENTITY` and `NOTARY_PROFILE` are properly configured inside `build-release.sh` or exported in your environment)._

---

## Artifact locations

- App bundle:
    - `src-tauri/target/release/bundle/macos/Bulk Content Operations.app`
- DMG:
    - `src-tauri/target/release/bundle/dmg/Bulk Content Operations_*.dmg`
- Release Notes (auto-generated):
    - `src-tauri/target/release/bundle/release-notes.md`

---

## Go / No-Go checklist

### GO only if all checks pass

- [ ] Build succeeds with no signing errors.
- [ ] App is **not** ad-hoc signed:
    ```bash
    codesign -dvvv "src-tauri/target/release/bundle/macos/Bulk Content Operations.app"
    ```
    Must show:
    - `Authority=Developer ID Application: ...`
    - `TeamIdentifier=...`
    - **not** `Signature=adhoc`
- [ ] Signature verification passes:
    ```bash
    codesign --verify --deep --strict --verbose=2 "src-tauri/target/release/bundle/macos/Bulk Content Operations.app"
    ```
- [ ] Notarization status is Accepted (from release script / notarytool).
- [ ] Staple validation passes:
    ```bash
    xcrun stapler validate "src-tauri/target/release/bundle/dmg/Bulk Content Operations_*.dmg"
    ```
- [ ] Gatekeeper check passes:
    ```bash
    spctl -a -vvv -t install "src-tauri/target/release/bundle/dmg/Bulk Content Operations_*.dmg"
    ```
- [ ] Smoke test on clean Apple Silicon Mac:
    - Mount DMG
    - Drag app to Applications
    - Launch app successfully

### NO-GO if any fail

- Do not distribute artifact.
- Fix signing/notary issue, rebuild, rerun checklist.

---

## Distribution + traceability

If you have the GitHub CLI (`gh`) installed, `build-release.sh` will automatically create a GitHub Release, attach the `.dmg` file, and set the release notes.

Otherwise, for each public release, you will need to manually publish the following to the GitHub Releases page:

- The generated `.dmg` file
- The contents of `release-notes.md` (which automatically includes the SHA256 checksum, version, commit SHA, build date, and releaser info).

---

## Security policy

- Do **not** export/share signing private key casually.
- Prefer CI-based signing/notarization with protected secrets.
- Limit release permissions to trusted maintainers.
- Rotate notary credentials periodically.
