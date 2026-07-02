import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

// 1. Get the new version from package.json
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const newVersion = pkg.version;

// 2. Update tauri.conf.json WITHOUT reformatting the file
const tauriConfPath = "src-tauri/tauri.conf.json";
let tauriConfRaw = readFileSync(tauriConfPath, "utf8");

const versionFieldRegex = /("version"\s*:\s*")([^"]+)(")/;
if (!versionFieldRegex.test(tauriConfRaw)) {
    throw new Error(`Could not find "version" field in ${tauriConfPath}`);
}
tauriConfRaw = tauriConfRaw.replace(versionFieldRegex, `$1${newVersion}$3`);
writeFileSync(tauriConfPath, tauriConfRaw);

// 3. Update Cargo.toml (using regex to find the workspace/package version)
const cargoTomlPath = "src-tauri/Cargo.toml";
let cargoToml = readFileSync(cargoTomlPath, "utf8");
cargoToml = cargoToml.replace(/^version\s*=\s*".*"/m, `version = "${newVersion}"`);
writeFileSync(cargoTomlPath, cargoToml);

// 4. Update Cargo.lock to reflect the version change
execSync("cargo update -p bulk-content-operations", { cwd: "src-tauri" });

console.log(`✅ Synced version ${newVersion} to tauri.conf.json, Cargo.toml, and Cargo.lock`);
