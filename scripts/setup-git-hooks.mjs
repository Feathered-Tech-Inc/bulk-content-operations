import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync(".git")) {
    console.log("ℹ️ Skipping Git hooks setup: .git directory not found");
    process.exit(0);
}

execSync("git config core.hooksPath .githooks", { stdio: "inherit" });
console.log("✅ Git hooks path configured: .githooks");
