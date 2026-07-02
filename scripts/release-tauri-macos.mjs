#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function run(cmd, options = {}) {
    console.log(`\n$ ${cmd}`);
    execSync(cmd, { stdio: "inherit", ...options });
}

function findFirstByExt(dir, ext) {
    if (!existsSync(dir)) return null;
    const file = readdirSync(dir).find(f => f.toLowerCase().endsWith(ext));
    return file ? join(dir, file) : null;
}

const notaryProfile = process.env.NOTARY_PROFILE?.trim();
const bundleRoot = process.env.TAURI_BUNDLE_DIR || "src-tauri/target/release/bundle";
const dmgDir = join(bundleRoot, "dmg");
const appDir = join(bundleRoot, "macos");

const skipNotarize = process.env.SKIP_NOTARIZE === "1";

run("pnpm run tauri:build");

const appPath = findFirstByExt(appDir, ".app");
const dmgPath = findFirstByExt(dmgDir, ".dmg");

if (!appPath) {
    throw new Error(`.app not found in ${appDir}`);
}
if (!dmgPath) {
    throw new Error(`.dmg not found in ${dmgDir}`);
}

run(`codesign --verify --deep --strict --verbose=2 "${appPath}"`);

if (!skipNotarize) {
    if (!notaryProfile) {
        throw new Error("NOTARY_PROFILE is required when notarization is enabled. Set NOTARY_PROFILE or use SKIP_NOTARIZE=1.");
    }
    run(`xcrun notarytool submit "${dmgPath}" --keychain-profile "${notaryProfile}" --wait`);
    run(`xcrun stapler staple "${dmgPath}"`);
    run(`xcrun stapler validate "${dmgPath}"`);
} else {
    console.log("\nSkipping notarization because SKIP_NOTARIZE=1");
}

run(`spctl -a -vvv -t install "${dmgPath}"`);

console.log(`\n$ shasum -a 256 "${dmgPath}"`);
const shasumOutput = execSync(`shasum -a 256 "${dmgPath}"`, { encoding: "utf8" }).trim();
console.log(shasumOutput);

// Gather traceability metadata
const version = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const commitSha = execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim();
const buildDate = new Date().toISOString();
let maintainer = "Unknown";
try {
    maintainer = execSync("git config user.name", { encoding: "utf8" }).trim();
} catch {
    // Fallback if git config is missing
}

// Format the release output
const releaseNotes = `## Distribution Details

- **Version:** ${version}
- **Commit:** \`${commitSha}\`
- **Build Date:** ${buildDate}
- **Releaser:** ${maintainer}

### Checksums
\`\`\`text
${shasumOutput.replace(dmgDir + "/", "")}
\`\`\`
`;

const releaseNotesPath = join(bundleRoot, "release-notes.md");
writeFileSync(releaseNotesPath, releaseNotes);

console.log("\n✅ Release complete");
console.log(`App: ${appPath}`);
console.log(`DMG: ${dmgPath}`);
console.log(`Release Notes: ${releaseNotesPath}`);
if (!skipNotarize) {
    console.log(`Notarization profile: ${notaryProfile}`);
}
