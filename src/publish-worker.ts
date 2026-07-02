import { DEFAULT_BULK_ACTION_CONCURRENCY, MAX_BULK_ACTION_CONCURRENCY, getErrorMessage, loadAccessibleSpaces, loadSpaceEnvironments, loadTagsForScope, parseAction, runPublishJob, type PublishEnvironment, type PublishJobParams, type PublishSpace, type PublishTag } from "./publish-core";

type WorkerCommand =
    | {
          kind: "run";
          params: PublishJobParams;
      }
    | {
          kind: "load-spaces";
          token: string;
      }
    | {
          kind: "load-environments";
          token: string;
          spaceId: string;
      }
    | {
          kind: "load-tags";
          token: string;
          spaceId: string;
          environmentId: string;
      };

type WorkerDoneSummary =
    | {
          spaces: PublishSpace[];
      }
    | {
          environments: PublishEnvironment[];
      }
    | {
          tags: PublishTag[];
      }
    | unknown;

type WorkerEvent =
    | {
          type: "log";
          level: "info" | "error";
          message: string;
          timestamp: string;
          meta?: Record<string, unknown>;
      }
    | {
          type: "done";
          success: boolean;
          summary: unknown;
          timestamp: string;
      }
    | {
          type: "error";
          message: string;
          timestamp: string;
      };

function emit(event: WorkerEvent): void {
    process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function readStdin(): Promise<string> {
    return new Promise((resolveRead, rejectRead) => {
        let data = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => {
            data += chunk;
        });
        process.stdin.on("end", () => {
            resolveRead(data);
        });
        process.stdin.on("error", error => {
            rejectRead(error);
        });
    });
}

function parseInteger(value: unknown, field: string, { min, max }: { min: number; max?: number }): number {
    if (typeof value !== "number" || !Number.isInteger(value)) {
        throw new Error(`${field} must be an integer`);
    }
    if (value < min) {
        throw new Error(`${field} must be at least ${min}`);
    }
    if (max !== undefined && value > max) {
        throw new Error(`${field} must be at most ${max}`);
    }
    return value;
}

function parseBoolean(value: unknown, field: string): boolean {
    if (typeof value !== "boolean") {
        throw new Error(`${field} must be a boolean`);
    }
    return value;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`);
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function parseRequiredString(value: unknown, field: string): string {
    const parsed = parseOptionalString(value, field);
    if (!parsed) {
        throw new Error(`${field} is required`);
    }
    return parsed;
}

export function parsePayload(raw: unknown): WorkerCommand {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error("Payload must be a JSON object");
    }

    const payload = raw as Record<string, unknown>;

    if (typeof payload.token !== "string" || payload.token.trim() === "") {
        throw new Error("token is required");
    }

    const command =
        payload.command === undefined
            ? "run"
            : typeof payload.command === "string"
              ? payload.command
              : (() => {
                    throw new Error("command must be a string");
                })();

    if (command === "load-spaces") {
        return {
            kind: "load-spaces",
            token: payload.token
        };
    }

    if (command === "load-environments") {
        return {
            kind: "load-environments",
            token: payload.token,
            spaceId: parseRequiredString(payload.spaceId, "spaceId")
        };
    }

    if (command === "load-tags") {
        return {
            kind: "load-tags",
            token: payload.token,
            spaceId: parseRequiredString(payload.spaceId, "spaceId"),
            environmentId: parseRequiredString(payload.environmentId, "environmentId")
        };
    }

    if (command !== "run") {
        throw new Error("command must be one of: run, load-spaces, load-environments, load-tags");
    }

    const spaceId = parseRequiredString(payload.spaceId, "spaceId");
    const environmentId = parseRequiredString(payload.environmentId, "environmentId");

    if (typeof payload.tagId !== "string" || payload.tagId.trim() === "") {
        throw new Error("tagId is required");
    }

    const action =
        payload.action === undefined
            ? "publish"
            : typeof payload.action === "string"
              ? parseAction(payload.action)
              : (() => {
                    throw new Error("action must be a string");
                })();
    const limit = parseInteger(payload.limit, "limit", { min: 1 });

    const concurrencyValue = payload.concurrency === undefined ? DEFAULT_BULK_ACTION_CONCURRENCY : payload.concurrency;

    const concurrency = parseInteger(concurrencyValue, "concurrency", {
        min: 1,
        max: MAX_BULK_ACTION_CONCURRENCY
    });

    const dryRun = payload.dryRun === undefined ? false : parseBoolean(payload.dryRun, "dryRun");
    const verbose = payload.verbose === undefined ? false : parseBoolean(payload.verbose, "verbose");

    return {
        kind: "run",
        params: {
            token: payload.token,
            spaceId,
            environmentId,
            tagId: payload.tagId,
            action,
            limit,
            concurrency,
            dryRun,
            verbose
        }
    };
}

async function readPayloadFromInput(): Promise<WorkerCommand> {
    const payloadText = process.argv[2] ?? (await readStdin());

    if (!payloadText || payloadText.trim() === "") {
        throw new Error("Missing payload JSON");
    }

    let rawPayload: unknown;
    try {
        rawPayload = JSON.parse(payloadText);
    } catch {
        throw new Error("Payload must be valid JSON");
    }

    return parsePayload(rawPayload);
}

async function main(): Promise<void> {
    try {
        const command = await readPayloadFromInput();

        if (command.kind === "load-spaces") {
            const spaces = await loadAccessibleSpaces({
                token: command.token
            });

            emit({
                type: "done",
                success: true,
                summary: {
                    spaces
                } satisfies WorkerDoneSummary,
                timestamp: new Date().toISOString()
            });
            process.exitCode = 0;
            return;
        }

        if (command.kind === "load-environments") {
            const environments = await loadSpaceEnvironments({
                token: command.token,
                spaceId: command.spaceId
            });

            emit({
                type: "done",
                success: true,
                summary: {
                    environments
                } satisfies WorkerDoneSummary,
                timestamp: new Date().toISOString()
            });
            process.exitCode = 0;
            return;
        }

        if (command.kind === "load-tags") {
            const tags = await loadTagsForScope({
                token: command.token,
                spaceId: command.spaceId,
                environmentId: command.environmentId
            });

            emit({
                type: "done",
                success: true,
                summary: {
                    tags
                } satisfies WorkerDoneSummary,
                timestamp: new Date().toISOString()
            });
            process.exitCode = 0;
            return;
        }

        const result = await runPublishJob(command.params, {
            onLog: log => {
                emit({
                    type: "log",
                    level: log.level,
                    message: log.message,
                    ...(log.meta ? { meta: log.meta } : {}),
                    timestamp: new Date().toISOString()
                });
            }
        });

        emit({
            type: "done",
            success: result.success,
            summary: result.summary,
            timestamp: new Date().toISOString()
        });

        process.exitCode = result.success ? 0 : 1;
    } catch (error) {
        const message = getErrorMessage(error);
        emit({
            type: "error",
            message,
            timestamp: new Date().toISOString()
        });
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch((error: unknown) => {
        emit({
            type: "error",
            message: getErrorMessage(error),
            timestamp: new Date().toISOString()
        });
        process.exitCode = 1;
    });
}
