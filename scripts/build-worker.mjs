import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const workerOutputPath = 'dist/publish-worker.js';
const tauriWorkerResourcePath = 'src-tauri/resources/worker/publish-worker.js';

await build({
  entryPoints: ['src/publish-worker.ts'],
  outfile: workerOutputPath,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
});

await mkdir(dirname(tauriWorkerResourcePath), { recursive: true });
await copyFile(workerOutputPath, tauriWorkerResourcePath);