import { createClient, isDraft, isPublished, isUpdated, type BulkActionProps, type BulkActionPublishPayload, type EntryProps, type PlainClientAPI } from "contentful-management";

const CURSOR_PAGE_SIZE = 1000;
const BULK_ACTION_MAX_ITEMS = 200;
const BULK_ACTION_POLL_MS = 2000;
const BULK_ACTION_POLL_STAGGER_MS = 400;
const BULK_ACTION_MAX_POLLS = 60;

export const MAX_BULK_ACTION_CONCURRENCY = 5;
export const DEFAULT_BULK_ACTION_CONCURRENCY = 1;

export type PublishTargetId = string;

export type PublishAction = "publish" | "unpublish";

export type PublishResult = {
    entryId: string;
    contentType: string;
    status: "published" | "unpublished" | "failed";
    error?: string;
};

export type PublishTag = {
    id: string;
    name: string;
};

export type PublishSpace = {
    id: string;
    name: string;
};

export type PublishEnvironment = {
    id: string;
    name: string;
};

type SpaceLike = {
    sys?: { id?: string };
    name?: string;
};

type EnvironmentLike = {
    sys?: { id?: string };
    name?: string;
};

export type PublishJobParams = {
    token: string;
    target?: PublishTargetId;
    spaceId?: string;
    environmentId?: string;
    tagId: string;
    action?: PublishAction;
    limit: number;
    dryRun?: boolean;
    verbose?: boolean;
    concurrency?: number;
};

export type PublishJobLog = {
    level: "info" | "error";
    message: string;
    meta?: Record<string, unknown>;
};

export type PublishJobProgress =
    | {
          stage: "collecting";
          page: number;
          scannedCount: number;
          publishableCount: number;
      }
    | {
          stage: "publishing";
          batchNumber: number;
          batchCount: number;
      };

export type PublishJobHooks = {
    onLog?: (log: PublishJobLog) => void;
    onProgress?: (progress: PublishJobProgress) => void;
    createClient?: (config: AppConfig) => PlainClientAPI;
    sleep?: (ms: number) => Promise<void>;
};

export type PublishJobSummary = {
    target?: PublishTargetId;
    action: PublishAction;
    targetLabel?: string;
    spaceId: string;
    environmentId: string;
    tagId: string;
    scannedCount: number;
    fullyScanned: boolean;
    publishableCount: number;
    selectedCount: number;
    publishedCount: number;
    failedCount: number;
    dryRun: boolean;
    limit: number;
    concurrency: number;
    results: PublishResult[];
};

export type PublishJobRunResult = {
    success: boolean;
    summary: PublishJobSummary;
};

type NormalizedPublishJobParams = {
    token: string;
    target?: PublishTargetId;
    legacyTargetUsed: boolean;
    spaceId: string;
    environmentId: string;
    tagId: string;
    action: PublishAction;
    limit: number;
    dryRun: boolean;
    verbose: boolean;
    concurrency: number;
};

type AppConfig = {
    accessToken: string;
    target?: PublishTargetId;
    legacyTargetUsed: boolean;
    action: PublishAction;
    targetLabel?: string;
    spaceId: string;
    environmentId: string;
    tagId: string;
};

type ActionLabels = {
    infinitive: string;
    gerund: string;
    past: string;
    noun: string;
    listHeading: string;
    noEntriesMessage: string;
};

function createDefaultPlainClient(config: AppConfig): PlainClientAPI {
    return createScopedClient(config.accessToken, config.spaceId, config.environmentId);
}

function createScopedClient(accessToken: string, spaceId: string, environmentId: string): PlainClientAPI {
    return createClient(
        { accessToken },
        {
            defaults: {
                spaceId,
                environmentId
            }
        }
    );
}

function normalizeTag(item: unknown): PublishTag | null {
    if (typeof item !== "object" || item === null) {
        return null;
    }

    const candidate = item as {
        sys?: { id?: string };
        name?: string;
    };
    const id = candidate.sys?.id?.trim();

    if (!id) {
        return null;
    }

    return {
        id,
        name: candidate.name?.trim() || id
    };
}

function normalizeSpace(item: unknown): PublishSpace | null {
    if (typeof item !== "object" || item === null) {
        return null;
    }

    const candidate = item as SpaceLike;
    const id = candidate.sys?.id?.trim();
    if (!id) {
        return null;
    }

    return {
        id,
        name: candidate.name?.trim() || id
    };
}

function normalizeEnvironment(item: unknown): PublishEnvironment | null {
    if (typeof item !== "object" || item === null) {
        return null;
    }

    const candidate = item as EnvironmentLike;
    const id = candidate.sys?.id?.trim();
    if (!id) {
        return null;
    }

    return {
        id,
        name: candidate.name?.trim() || id
    };
}

export async function loadAccessibleSpaces(params: { token: string }): Promise<PublishSpace[]> {
    const token = params.token.trim();
    if (!token) {
        throw new Error("token is required");
    }

    const client = createClient({ accessToken: token }, { type: "plain" });
    const response = (await client.space.getMany({
        query: {
            limit: 1000
        }
    })) as { items?: unknown[] };

    return (response.items ?? [])
        .map(item => normalizeSpace(item))
        .filter((item): item is PublishSpace => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadSpaceEnvironments(params: { token: string; spaceId: string }): Promise<PublishEnvironment[]> {
    const token = params.token.trim();
    const spaceId = params.spaceId.trim();
    if (!token) {
        throw new Error("token is required");
    }
    if (!spaceId) {
        throw new Error("spaceId is required");
    }

    const client = createClient({ accessToken: token }, { type: "plain" });
    const response = (await client.environment.getMany({
        spaceId,
        query: {
            limit: 1000
        }
    })) as { items?: unknown[] };

    return (response.items ?? [])
        .map(item => normalizeEnvironment(item))
        .filter((item): item is PublishEnvironment => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTagsForScope(params: { token: string; spaceId: string; environmentId: string }): Promise<PublishTag[]> {
    const token = params.token.trim();
    const spaceId = params.spaceId.trim();
    const environmentId = params.environmentId.trim();
    if (!token) {
        throw new Error("token is required");
    }
    if (!spaceId) {
        throw new Error("spaceId is required");
    }
    if (!environmentId) {
        throw new Error("environmentId is required");
    }

    const client = createScopedClient(token, spaceId, environmentId);
    const response = (await client.tag.getMany({
        spaceId,
        environmentId,
        query: {
            limit: 1000
        }
    })) as { items?: unknown[] };

    return (response.items ?? [])
        .map(item => normalizeTag(item))
        .filter((item): item is PublishTag => item !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadTargetTags(params: { token: string; target: PublishTargetId }): Promise<PublishTag[]> {
    throw new Error(`Legacy target aliases are deprecated and not supported for tag discovery (${params.target}). Use explicit spaceId and environmentId with loadTagsForScope instead.`);
}

function emitLog(hooks: PublishJobHooks | undefined, level: PublishJobLog["level"], message: string, meta?: Record<string, unknown>): void {
    hooks?.onLog?.({ level, message, ...(meta ? { meta } : {}) });
}

function emitProgress(hooks: PublishJobHooks | undefined, progress: PublishJobProgress): void {
    hooks?.onProgress?.(progress);
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolveSleep => {
        setTimeout(resolveSleep, ms);
    });
}

function getContentTypeId(entry: EntryProps): string {
    return entry.sys.contentType.sys.id;
}

function needsPublish(entry: EntryProps): boolean {
    return isDraft(entry) || isUpdated(entry);
}

function needsAction(entry: EntryProps, action: PublishAction): boolean {
    if (action === "publish") {
        return needsPublish(entry);
    }

    return isPublished(entry);
}

function getActionLabels(action: PublishAction): ActionLabels {
    if (action === "unpublish") {
        return {
            infinitive: "unpublish",
            gerund: "unpublishing",
            past: "unpublished",
            noun: "unpublishable",
            listHeading: "Unpublishable entry IDs",
            noEntriesMessage: "No entries to unpublish."
        };
    }

    return {
        infinitive: "publish",
        gerund: "publishing",
        past: "published",
        noun: "publishable",
        listHeading: "Publishable entry IDs",
        noEntriesMessage: "No entries to publish."
    };
}

function toSuccessStatus(action: PublishAction): PublishResult["status"] {
    return action === "publish" ? "published" : "unpublished";
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === "object" && error !== null && "message" in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

function chunkEntries<T>(items: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += chunkSize) {
        chunks.push(items.slice(i, i + chunkSize));
    }
    return chunks;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
    if (items.length === 0) {
        return [];
    }

    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }

            results[index] = await fn(items[index]!, index);
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));

    return results;
}

async function collectTaggedEntries(
    client: PlainClientAPI,
    tagId: string,
    action: PublishAction,
    maxPublishable: number,
    hooks?: PublishJobHooks
): Promise<{
    publishableEntries: EntryProps[];
    scannedCount: number;
    fullyScanned: boolean;
}> {
    const publishableEntries: EntryProps[] = [];
    const actionLabels = getActionLabels(action);
    let scannedCount = 0;
    let page = 0;
    let pageNext: string | undefined;

    emitLog(hooks, "error", `Fetching entries tagged ${tagId} to ${actionLabels.infinitive}...`);

    while (true) {
        page += 1;
        const query: {
            "metadata.tags.sys.id[in]"?: string;
            limit: number;
            pageNext?: string;
        } = pageNext ? { limit: CURSOR_PAGE_SIZE, pageNext } : { "metadata.tags.sys.id[in]": tagId, limit: CURSOR_PAGE_SIZE };

        const response = await client.entry.getManyWithCursor({
            query: query as never
        });

        for (const entry of response.items) {
            scannedCount += 1;

            if (needsAction(entry, action)) {
                publishableEntries.push(entry);
                if (publishableEntries.length >= maxPublishable) {
                    emitLog(hooks, "error", `  page ${page}: fetched ${scannedCount} entries (stopped early after finding ${maxPublishable} ${actionLabels.noun})`);
                    emitProgress(hooks, {
                        stage: "collecting",
                        page,
                        scannedCount,
                        publishableCount: publishableEntries.length
                    });
                    return { publishableEntries, scannedCount, fullyScanned: false };
                }
            }
        }

        emitLog(hooks, "error", `  page ${page}: fetched ${scannedCount} entries`);
        emitProgress(hooks, {
            stage: "collecting",
            page,
            scannedCount,
            publishableCount: publishableEntries.length
        });

        if (publishableEntries.length >= maxPublishable) {
            return { publishableEntries, scannedCount, fullyScanned: false };
        }

        const hasMore = Boolean(response.pages?.next) && response.items.length > 0;
        if (!hasMore) {
            return { publishableEntries, scannedCount, fullyScanned: true };
        }

        pageNext = response.pages!.next;
    }
}

function buildBulkPublishPayload(entries: EntryProps[]): BulkActionPublishPayload {
    return {
        entities: {
            sys: { type: "Array" },
            items: entries.map(entry => ({
                sys: {
                    type: "Link",
                    linkType: "Entry",
                    id: entry.sys.id,
                    version: entry.sys.version
                }
            }))
        }
    };
}

async function waitForBulkAction(client: PlainClientAPI, config: AppConfig, bulkActionId: string, pollSlot: number, hooks: PublishJobHooks | undefined): Promise<BulkActionProps<BulkActionPublishPayload>> {
    const sleepFn = hooks?.sleep ?? sleep;

    if (pollSlot > 0) {
        await sleepFn(pollSlot * BULK_ACTION_POLL_STAGGER_MS);
    }

    for (let attempt = 0; attempt < BULK_ACTION_MAX_POLLS; attempt++) {
        const action = await client.bulkAction.get({
            spaceId: config.spaceId,
            environmentId: config.environmentId,
            bulkActionId
        });

        if (action.sys.status === "succeeded" || action.sys.status === "failed") {
            return action as BulkActionProps<BulkActionPublishPayload>;
        }

        await sleepFn(BULK_ACTION_POLL_MS);
    }

    throw new Error(`BulkAction ${bulkActionId} did not finish within ${(BULK_ACTION_MAX_POLLS * BULK_ACTION_POLL_MS) / 1000}s`);
}

function parseBulkActionResults(entries: EntryProps[], bulkAction: BulkActionProps<BulkActionPublishPayload>, action: PublishAction): PublishResult[] {
    const successStatus = toSuccessStatus(action);

    if (bulkAction.sys.status === "succeeded") {
        return entries.map(entry => ({
            entryId: entry.sys.id,
            contentType: getContentTypeId(entry),
            status: successStatus
        }));
    }

    const failedById = new Map<string, string>();
    for (const item of bulkAction.error?.details?.errors ?? []) {
        const entryId = item.entity?.sys?.id;
        if (entryId) {
            failedById.set(entryId, getErrorMessage(item.error));
        }
    }

    return entries.map(entry => {
        const error = failedById.get(entry.sys.id);
        return {
            entryId: entry.sys.id,
            contentType: getContentTypeId(entry),
            status: error ? "failed" : successStatus,
            ...(error ? { error } : {})
        };
    });
}

async function publishBatch(client: PlainClientAPI, config: AppConfig, entries: EntryProps[], action: PublishAction, batchNumber: number, batchCount: number, concurrency: number, verbose: boolean, hooks?: PublishJobHooks): Promise<PublishResult[]> {
    const actionLabels = getActionLabels(action);

    emitProgress(hooks, { stage: "publishing", batchNumber, batchCount });

    if (batchCount > 1) {
        emitLog(hooks, "error", `Starting bulk ${actionLabels.infinitive} batch ${batchNumber}/${batchCount} (${entries.length} entries)...`);
    } else {
        emitLog(hooks, "error", `Starting bulk ${actionLabels.infinitive} for ${entries.length} entries...`);
    }

    const bulkActionInProgress =
        action === "publish"
            ? await client.bulkAction.publish(
                  {
                      spaceId: config.spaceId,
                      environmentId: config.environmentId
                  },
                  buildBulkPublishPayload(entries)
              )
            : await client.bulkAction.unpublish(
                  {
                      spaceId: config.spaceId,
                      environmentId: config.environmentId
                  },
                  buildBulkPublishPayload(entries)
              );

    if (verbose) {
        emitLog(hooks, "error", `  bulk action id: ${bulkActionInProgress.sys.id}`);
    }

    const bulkAction = await waitForBulkAction(client, config, bulkActionInProgress.sys.id, (batchNumber - 1) % concurrency, hooks);

    const results = parseBulkActionResults(entries, bulkAction, action);

    if (verbose) {
        for (const result of results) {
            if (result.status !== "failed") {
                emitLog(hooks, "info", `${actionLabels.past[0].toUpperCase()}${actionLabels.past.slice(1)} ${result.entryId} (${result.contentType})`);
            } else {
                emitLog(hooks, "error", `Failed ${result.entryId} (${result.contentType}): ${result.error}`);
            }
        }
    }

    return results;
}

async function publishEntries(client: PlainClientAPI, config: AppConfig, entries: EntryProps[], action: PublishAction, concurrency: number, verbose: boolean, hooks?: PublishJobHooks): Promise<PublishResult[]> {
    const actionLabels = getActionLabels(action);

    const batches = chunkEntries(entries, BULK_ACTION_MAX_ITEMS);

    if (batches.length > 1) {
        emitLog(hooks, "error", `Splitting ${entries.length} entries into ${batches.length} bulk ${actionLabels.infinitive} actions (max ${BULK_ACTION_MAX_ITEMS} per action)...`);
    }

    if (concurrency > 1 && batches.length > 1) {
        emitLog(hooks, "error", `Running up to ${concurrency} bulk actions in parallel (Contentful allows ${MAX_BULK_ACTION_CONCURRENCY} active per space)...`);
    }

    const batchResults = await mapWithConcurrency(batches, concurrency, (batch, index) => publishBatch(client, config, batch, action, index + 1, batches.length, concurrency, verbose, hooks));

    return batchResults.flat();
}

function logEntry(entry: EntryProps, verbose: boolean, hooks?: PublishJobHooks): void {
    if (!verbose) {
        return;
    }

    const { id, contentType, version, publishedVersion } = entry.sys;
    emitLog(hooks, "info", `  ${id} (${contentType.sys.id}) version=${version} publishedVersion=${publishedVersion ?? "none"}`);
}

export function parseAction(value: string): PublishAction {
    if (value === "publish" || value === "unpublish") {
        return value;
    }

    throw new Error("Unknown --action value. Valid actions: publish, unpublish");
}

function normalizePublishJobParams(params: PublishJobParams): NormalizedPublishJobParams {
    const token = params.token.trim();
    const tagId = params.tagId?.trim();
    const providedSpaceId = params.spaceId?.trim();
    const providedEnvironmentId = params.environmentId?.trim();

    if (!token) {
        throw new Error("token is required");
    }

    if (!tagId) {
        throw new Error("tagId is required");
    }

    if (!Number.isInteger(params.limit) || params.limit <= 0) {
        throw new Error("limit must be a positive integer");
    }

    const concurrency = params.concurrency ?? DEFAULT_BULK_ACTION_CONCURRENCY;
    if (!Number.isInteger(concurrency) || concurrency <= 0) {
        throw new Error("concurrency must be a positive integer");
    }

    if (concurrency > MAX_BULK_ACTION_CONCURRENCY) {
        throw new Error(`concurrency must be at most ${MAX_BULK_ACTION_CONCURRENCY} (Contentful max active bulk actions per space)`);
    }

    const action = parseAction(params.action ?? "publish");

    if ((providedSpaceId && !providedEnvironmentId) || (!providedSpaceId && providedEnvironmentId)) {
        throw new Error("spaceId and environmentId must be provided together");
    }

    const target = params.target?.trim() || undefined;

    if (!providedSpaceId || !providedEnvironmentId) {
        throw new Error("spaceId and environmentId are required");
    }

    const legacyTargetUsed = Boolean(target);

    return {
        token,
        target,
        legacyTargetUsed,
        spaceId: providedSpaceId,
        environmentId: providedEnvironmentId,
        tagId,
        action,
        limit: params.limit,
        dryRun: params.dryRun ?? false,
        verbose: params.verbose ?? false,
        concurrency
    };
}

export function validatePublishJobParams(params: PublishJobParams): void {
    normalizePublishJobParams(params);
}

function getConfig(params: NormalizedPublishJobParams): AppConfig {
    return {
        accessToken: params.token,
        target: params.target,
        legacyTargetUsed: params.legacyTargetUsed,
        action: params.action,
        spaceId: params.spaceId,
        environmentId: params.environmentId,
        tagId: params.tagId
    };
}

export async function runPublishJob(params: PublishJobParams, hooks?: PublishJobHooks): Promise<PublishJobRunResult> {
    const normalizedParams = normalizePublishJobParams(params);
    const config = getConfig(normalizedParams);
    const actionLabels = getActionLabels(config.action);
    const clientFactory = hooks?.createClient ?? createDefaultPlainClient;
    const client = clientFactory(config);

    emitLog(hooks, "info", `Scope: space ${config.spaceId}, environment ${config.environmentId}`);
    emitLog(hooks, "info", `Action: ${config.action}`);

    const { publishableEntries, scannedCount, fullyScanned } = await collectTaggedEntries(client, config.tagId, config.action, normalizedParams.limit, hooks);
    const limitedEntries = publishableEntries.slice(0, normalizedParams.limit);

    if (fullyScanned) {
        emitLog(hooks, "info", `Found ${scannedCount} entries tagged ${config.tagId}`);
        emitLog(hooks, "info", `  ${publishableEntries.length} need ${actionLabels.gerund}`);
        emitLog(hooks, "info", `  ${scannedCount - publishableEntries.length} already up to date (skipped)`);
    } else {
        emitLog(hooks, "info", `Scanned ${scannedCount} entries tagged ${config.tagId}`);
        emitLog(hooks, "info", `  At least ${publishableEntries.length} need ${actionLabels.gerund} (scan stopped after reaching --limit)`);
    }

    if (publishableEntries.length > 0) {
        emitLog(hooks, "info", `  Limit: ${normalizedParams.limit} (${normalizedParams.dryRun ? "listing" : actionLabels.gerund} first ${limitedEntries.length} of ${publishableEntries.length})`);
    }

    if (normalizedParams.dryRun) {
        if (limitedEntries.length === 0) {
            emitLog(hooks, "info", `\n${actionLabels.noEntriesMessage}`);
            return {
                success: true,
                summary: {
                    target: config.target,
                    action: config.action,
                    targetLabel: config.targetLabel,
                    spaceId: config.spaceId,
                    environmentId: config.environmentId,
                    tagId: config.tagId,
                    scannedCount,
                    fullyScanned,
                    publishableCount: publishableEntries.length,
                    selectedCount: 0,
                    publishedCount: 0,
                    failedCount: 0,
                    dryRun: true,
                    limit: normalizedParams.limit,
                    concurrency: normalizedParams.concurrency,
                    results: []
                }
            };
        }

        emitLog(hooks, "info", `\n${actionLabels.listHeading}:`);
        for (const entry of limitedEntries) {
            logEntry(entry, normalizedParams.verbose, hooks);
            if (!normalizedParams.verbose) {
                emitLog(hooks, "info", `  ${entry.sys.id}`);
            }
        }

        return {
            success: true,
            summary: {
                target: config.target,
                action: config.action,
                targetLabel: config.targetLabel,
                spaceId: config.spaceId,
                environmentId: config.environmentId,
                tagId: config.tagId,
                scannedCount,
                fullyScanned,
                publishableCount: publishableEntries.length,
                selectedCount: limitedEntries.length,
                publishedCount: 0,
                failedCount: 0,
                dryRun: true,
                limit: normalizedParams.limit,
                concurrency: normalizedParams.concurrency,
                results: []
            }
        };
    }

    if (limitedEntries.length === 0) {
        emitLog(hooks, "info", `\n${actionLabels.noEntriesMessage}`);
        return {
            success: true,
            summary: {
                target: config.target,
                action: config.action,
                targetLabel: config.targetLabel,
                spaceId: config.spaceId,
                environmentId: config.environmentId,
                tagId: config.tagId,
                scannedCount,
                fullyScanned,
                publishableCount: 0,
                selectedCount: 0,
                publishedCount: 0,
                failedCount: 0,
                dryRun: false,
                limit: normalizedParams.limit,
                concurrency: normalizedParams.concurrency,
                results: []
            }
        };
    }

    const results = await publishEntries(client, config, limitedEntries, config.action, normalizedParams.concurrency, normalizedParams.verbose, hooks);

    const publishedCount = results.filter(r => r.status !== "failed").length;
    const failedResults = results.filter(r => r.status === "failed");

    emitLog(hooks, "info", `\n${actionLabels.past[0].toUpperCase()}${actionLabels.past.slice(1)}: ${publishedCount}`);
    emitLog(hooks, "info", `Failed: ${failedResults.length}`);

    for (const result of failedResults) {
        emitLog(hooks, "info", `  - ${result.entryId}: ${result.error}`);
    }

    return {
        success: failedResults.length === 0,
        summary: {
            target: config.target,
            action: config.action,
            targetLabel: config.targetLabel,
            spaceId: config.spaceId,
            environmentId: config.environmentId,
            tagId: config.tagId,
            scannedCount,
            fullyScanned,
            publishableCount: publishableEntries.length,
            selectedCount: limitedEntries.length,
            publishedCount,
            failedCount: failedResults.length,
            dryRun: false,
            limit: normalizedParams.limit,
            concurrency: normalizedParams.concurrency,
            results
        }
    };
}
