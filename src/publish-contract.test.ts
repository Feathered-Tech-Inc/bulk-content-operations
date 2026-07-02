import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveToken } from "./publish-cli";
import { parsePayload } from "./publish-worker";

test("parseArgs parses explicit generic scope and token", () => {
    const parsed = parseArgs(["--token", "cli-token", "--space", "demo-space", "--environment", "demo-env", "--tag", "campaign-tag", "--action", "unpublish", "--limit", "2", "--concurrency", "2", "--dry-run", "--verbose"]);

    assert.deepEqual(parsed, {
        token: "cli-token",
        spaceId: "demo-space",
        environmentId: "demo-env",
        tagId: "campaign-tag",
        action: "unpublish",
        limit: 2,
        concurrency: 2,
        dryRun: true,
        verbose: true
    });
});

test("parseArgs rejects unknown arguments", () => {
    assert.throws(() => parseArgs(["--unknown-flag", "--tag", "campaign-tag", "--limit", "1", "--space", "demo-space", "--environment", "demo-env"]), /Unknown argument: --unknown-flag/);
});

test("resolveToken falls back to CONTENTFUL_CMA_TOKEN", () => {
    const previous = process.env.CONTENTFUL_CMA_TOKEN;
    process.env.CONTENTFUL_CMA_TOKEN = "env-token";

    try {
        assert.equal(resolveToken(), "env-token");
        assert.equal(resolveToken("cli-token"), "cli-token");
    } finally {
        if (previous === undefined) {
            delete process.env.CONTENTFUL_CMA_TOKEN;
        } else {
            process.env.CONTENTFUL_CMA_TOKEN = previous;
        }
    }
});

test("parsePayload accepts run command with explicit generic scope", () => {
    const parsed = parsePayload({
        command: "run",
        token: "token",
        spaceId: "demo-space",
        environmentId: "demo-env",
        tagId: "campaign-tag",
        action: "publish",
        limit: 1,
        concurrency: 1,
        dryRun: true,
        verbose: false
    });

    assert.equal(parsed.kind, "run");
    if (parsed.kind !== "run") {
        return;
    }

    assert.equal(parsed.params.spaceId, "demo-space");
    assert.equal(parsed.params.environmentId, "demo-env");
    assert.equal(parsed.params.tagId, "campaign-tag");
    assert.equal(parsed.params.action, "publish");
});

test("parsePayload rejects run payload missing scope fields", () => {
    assert.throws(
        () =>
            parsePayload({
                command: "run",
                token: "token",
                tagId: "campaign-tag",
                action: "publish",
                limit: 1,
                concurrency: 1,
                dryRun: true,
                verbose: false
            }),
        /spaceId is required/
    );
});
