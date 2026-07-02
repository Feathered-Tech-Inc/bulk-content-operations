import { createHash } from "node:crypto";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as tar from "tar";

const NODE_VERSION = "v22.15.0";
const PLATFORM = "darwin-arm64";

const DIST_BASE_URL = `https://nodejs.org/dist/${NODE_VERSION}`;
const ARCHIVE_NAME = `node-${NODE_VERSION}-${PLATFORM}.tar.gz`;
const ARCHIVE_URL = `${DIST_BASE_URL}/${ARCHIVE_NAME}`;
const SHASUMS_NAME = "SHASUMS256.txt";
const SHASUMS_URL = `${DIST_BASE_URL}/${SHASUMS_NAME}`;

const CACHE_DIR = ".cache/node-runtime";
const ARCHIVE_PATH = `${CACHE_DIR}/${ARCHIVE_NAME}`;
const SHASUMS_PATH = `${CACHE_DIR}/${SHASUMS_NAME}`;
const RUNTIME_PATH = "src-tauri/resources/node/node";

function log(message) {
    console.log(`[ensure-node-runtime] ${message}`);
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function fileExists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function downloadIfMissing(url, destinationPath) {
    if (await fileExists(destinationPath)) {
        log(`Using cached file: ${destinationPath}`);
        return;
    }

    log(`Downloading ${url}`);
    const response = await fetch(url);
    assert(response.ok, `Failed to download ${url} (HTTP ${response.status}).`);

    const body = await response.arrayBuffer();
    await writeFile(destinationPath, Buffer.from(body));
    log(`Saved to ${destinationPath}`);
}

function getExpectedChecksum(shasumsText) {
    const checksumLine = shasumsText
        .split("\n")
        .map(line => line.trim())
        .find(line => line.endsWith(ARCHIVE_NAME));

    assert(checksumLine, `Could not find checksum for ${ARCHIVE_NAME} in ${SHASUMS_PATH}. Verify NODE_VERSION and PLATFORM.`);

    const [checksum] = checksumLine.split(/\s+/);
    assert(/^[a-f0-9]{64}$/.test(checksum), `Invalid checksum format for ${ARCHIVE_NAME} in ${SHASUMS_PATH}.`);

    return checksum;
}

async function verifyArchiveChecksum() {
    const shasumsText = await readFile(SHASUMS_PATH, "utf8");
    const expectedChecksum = getExpectedChecksum(shasumsText);

    const archiveBytes = await readFile(ARCHIVE_PATH);
    const actualChecksum = createHash("sha256").update(archiveBytes).digest("hex");

    assert(actualChecksum === expectedChecksum, `Checksum mismatch for ${ARCHIVE_PATH}. Expected ${expectedChecksum}, got ${actualChecksum}. Delete ${ARCHIVE_PATH} and rerun.`);

    log(`Checksum verified for ${ARCHIVE_NAME}`);
}

async function extractAndInstallRuntime() {
    const tarEntryPath = `node-${NODE_VERSION}-${PLATFORM}/bin/node`;
    const tempDir = await mkdtemp(join(tmpdir(), "node-runtime-"));

    try {
        await tar.x({
            file: ARCHIVE_PATH,
            cwd: tempDir,
            strip: 2,
            filter: path => path === tarEntryPath
        });

        const extractedNodePath = join(tempDir, "node");
        assert(await fileExists(extractedNodePath), `Unable to extract ${tarEntryPath} from ${ARCHIVE_PATH}.`);

        await mkdir("src-tauri/resources/node", { recursive: true });
        await copyFile(extractedNodePath, RUNTIME_PATH);
        await chmod(RUNTIME_PATH, 0o755);

        log(`Runtime installed at ${RUNTIME_PATH}`);
    } finally {
        await rm(tempDir, { recursive: true, force: true });
    }
}

async function main() {
    log(`Preparing Node runtime ${NODE_VERSION} (${PLATFORM})`);
    await mkdir(CACHE_DIR, { recursive: true });

    await downloadIfMissing(ARCHIVE_URL, ARCHIVE_PATH);
    await downloadIfMissing(SHASUMS_URL, SHASUMS_PATH);
    await verifyArchiveChecksum();
    await extractAndInstallRuntime();

    log("Node runtime is ready.");
}

main().catch(error => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ensure-node-runtime] ERROR: ${message}`);
    process.exitCode = 1;
});
