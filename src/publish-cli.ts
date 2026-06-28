import { config as loadEnvFile } from 'dotenv';
import { resolve } from 'path';
import {
  type PublishAction,
  DEFAULT_BULK_ACTION_CONCURRENCY,
  MAX_BULK_ACTION_CONCURRENCY,
  getErrorMessage,
  parseAction,
  runPublishJob,
} from './publish-core';

const PROJECT_ROOT = resolve(__dirname, '..');

function loadEnv(): void {
  loadEnvFile({ path: resolve(PROJECT_ROOT, '.env') });
}

loadEnv();

export type CliOptions = {
  token?: string;
  spaceId: string;
  environmentId: string;
  tagId: string;
  action: PublishAction;
  limit: number;
  dryRun: boolean;
  verbose: boolean;
  concurrency: number;
};

export function parseArgs(argv: string[]): CliOptions {
  let token: string | undefined;
  let spaceId: string | undefined;
  let environmentId: string | undefined;
  let tagId: string | undefined;
  let action: PublishAction = 'publish';
  let limit: number | undefined;
  let dryRun = false;
  let verbose = false;
  let concurrency = DEFAULT_BULK_ACTION_CONCURRENCY;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      continue;
    }

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--verbose') {
      verbose = true;
      continue;
    }

    if (arg === '--concurrency') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--concurrency requires a positive integer value');
      }
      concurrency = Number.parseInt(value, 10);
      continue;
    }

    if (arg.startsWith('--concurrency=')) {
      concurrency = Number.parseInt(arg.slice('--concurrency='.length), 10);
      continue;
    }

    if (arg === '--token') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--token requires a value');
      }
      token = value.trim() || undefined;
      continue;
    }

    if (arg.startsWith('--token=')) {
      token = arg.slice('--token='.length).trim() || undefined;
      continue;
    }

    if (arg === '--target' || arg.startsWith('--target=')) {
      throw new Error(
        '--target is no longer supported. Use explicit --space and --environment.',
      );
    }

    if (arg === '--space') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--space requires a value');
      }
      spaceId = value.trim();
      continue;
    }

    if (arg.startsWith('--space=')) {
      spaceId = arg.slice('--space='.length).trim();
      continue;
    }

    if (arg === '--environment') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--environment requires a value');
      }
      environmentId = value.trim();
      continue;
    }

    if (arg.startsWith('--environment=')) {
      environmentId = arg.slice('--environment='.length).trim();
      continue;
    }

    if (arg === '--action') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--action requires a value (publish|unpublish)');
      }
      action = parseAction(value);
      continue;
    }

    if (arg.startsWith('--action=')) {
      action = parseAction(arg.slice('--action='.length));
      continue;
    }

    if (arg === '--tag') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--tag requires a value');
      }
      tagId = value.trim();
      continue;
    }

    if (arg.startsWith('--tag=')) {
      tagId = arg.slice('--tag='.length).trim();
      continue;
    }

    if (arg === '--limit') {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error('--limit requires a positive integer value');
      }
      limit = Number.parseInt(value, 10);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.slice('--limit='.length), 10);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!spaceId) {
    throw new Error('--space is required (e.g. --space your-space-id)');
  }

  if (!environmentId) {
    throw new Error(
      '--environment is required (e.g. --environment your-environment-id)',
    );
  }

  if (limit === undefined) {
    throw new Error('--limit is required (e.g. --limit 10)');
  }

  if (!tagId) {
    throw new Error('--tag is required (e.g. --tag seasonalCampaign)');
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  if (!Number.isInteger(concurrency) || concurrency <= 0) {
    throw new Error('--concurrency must be a positive integer');
  }

  if (concurrency > MAX_BULK_ACTION_CONCURRENCY) {
    throw new Error(
      `--concurrency must be at most ${MAX_BULK_ACTION_CONCURRENCY} (Contentful max active bulk actions per space)`,
    );
  }

  return {
    ...(token ? { token } : {}),
    spaceId,
    environmentId,
    tagId,
    action,
    limit,
    dryRun,
    verbose,
    concurrency,
  };
}

export function resolveToken(cliToken?: string): string {
  const token = cliToken ?? process.env.CONTENTFUL_CMA_TOKEN;
  if (!token) {
    throw new Error(
      'token is required (use --token or set CONTENTFUL_CMA_TOKEN in .env/environment)',
    );
  }

  return token;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const token = resolveToken(options.token);

  const result = await runPublishJob(
    {
      token,
      spaceId: options.spaceId,
      environmentId: options.environmentId,
      tagId: options.tagId,
      action: options.action,
      limit: options.limit,
      concurrency: options.concurrency,
      dryRun: options.dryRun,
      verbose: options.verbose,
    },
    {
      onLog: (log) => {
        if (log.level === 'error') {
          console.error(log.message);
          return;
        }
        console.log(log.message);
      },
    },
  );

  if (!result.success) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(getErrorMessage(error));
    process.exitCode = 1;
  });
}
