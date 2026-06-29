import { readFileSync, writeFileSync } from "node:fs";

// 1. Get the new version from package.json
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const newVersion = pkg.version;

// 2. Update tauri.conf.json
const tauriConfPath = "src-tauri/tauri.conf.json";
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));
tauriConf.version = newVersion;
// Note: tauri.conf.json in your project uses 4 spaces for indentation
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 4) + "\n");

// 3. Update Cargo.toml (using regex to find the workspace/package version)
const cargoTomlPath = "src-tauri/Cargo.toml";
let cargoToml = readFileSync(cargoTomlPath, "utf8");
cargoToml = cargoToml.replace(/^version\s*=\s*".*"/m, `version = "${newVersion}"`);
writeFileSync(cargoTomlPath, cargoToml);

console.log(`✅ Synced version ${newVersion} to tauri.conf.json and Cargo.toml`);