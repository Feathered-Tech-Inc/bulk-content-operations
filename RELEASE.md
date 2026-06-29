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

## Standard release commands

1. **Build + sign + notarize + staple**
   ```bash
   APPLE_SIGNING_IDENTITY="Developer ID Application: <Org/Name> (<TEAM_ID>)" NOTARY_PROFILE="your-notary-profile" pnpm run release:macos
   ```

2. **(Optional) Build/sign only, skip notarization**
   ```bash
   APPLE_SIGNING_IDENTITY="Developer ID Application: <Org/Name> (<TEAM_ID>)" SKIP_NOTARIZE=1 pnpm run release:macos
   ```

3. **(Optional) use explicit notary profile**
   ```bash
   APPLE_SIGNING_IDENTITY="Developer ID Application: <Org/Name> (<TEAM_ID>)" NOTARY_PROFILE="your-notary-profile" pnpm run release:macos
   ```

---

## Artifact locations

- App bundle:
    - `src-tauri/target/release/bundle/macos/Bulk Content Operations.app`
- DMG:
    - `src-tauri/target/release/bundle/dmg/Bulk Content Operations_*.dmg`

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

For each public release, publish:

- DMG file
- SHA256 checksum
- Version + commit SHA
- Build date/time
- Maintainer/releaser name (or CI workflow reference)

Example checksum command:
```bash
shasum -a 256 "src-tauri/target/release/bundle/dmg/Bulk Content Operations_*.dmg"
```

---

## Security policy

- Do **not** export/share signing private key casually.
- Prefer CI-based signing/notarization with protected secrets.
- Limit release permissions to trusted maintainers.
- Rotate notary credentials periodically.