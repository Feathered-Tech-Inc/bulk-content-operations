import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { format, resolveConfig } from "prettier";

const workerOutputPath = "dist/publish-worker.js";
const tauriWorkerResourcePath = "src-tauri/resources/worker/publish-worker.js";

async function formatFileWithProjectPrettierConfig(filePath) {
    const source = await readFile(filePath, "utf8");
    const prettierConfig = (await resolveConfig(filePath)) ?? {};
    const formatted = await format(source, {
        ...prettierConfig,
        filepath: filePath
    });
    await writeFile(filePath, formatted, "utf8");
}

await build({
    entryPoints: ["src/publish-worker.ts"],
    outfile: workerOutputPath,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    sourcemap: false,
    legalComments: "none",
    logLevel: "info"
});

await formatFileWithProjectPrettierConfig(workerOutputPath);

await mkdir(dirname(tauriWorkerResourcePath), { recursive: true });
await copyFile(workerOutputPath, tauriWorkerResourcePath);

await formatFileWithProjectPrettierConfig(tauriWorkerResourcePath);
