import assert from 'node:assert/strict';
import test from 'node:test';
import type { EntryProps, PlainClientAPI } from 'contentful-management';
import { parseAction, runPublishJob } from './publish-core';

function createEntry(
  id: string,
  {
    version,
    publishedVersion,
    contentType = 'article',
  }: {
    version: number;
    publishedVersion?: number;
    contentType?: string;
  },
): EntryProps {
  return {
    sys: {
      id,
      type: 'Entry',
      version,
      ...(publishedVersion === undefined ? {} : { publishedVersion }),
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      locale: 'en-US',
      contentType: {
        sys: {
          type: 'Link',
          linkType: 'ContentType',
          id: contentType,
        },
      },
      space: {
        sys: {
          type: 'Link',
          linkType: 'Space',
          id: 'test-space',
        },
      },
      environment: {
        sys: {
          type: 'Link',
          linkType: 'Environment',
          id: 'master',
        },
      },
    },
    metadata: {
      tags: [],
    },
    fields: {},
  } as unknown as EntryProps;
}

function createClientWithEntries(
  entries: EntryProps[],
  bulkStatus: unknown,
  onBulkAction?: (action: 'publish' | 'unpublish') => void,
): PlainClientAPI {
  return {
    entry: {
      getManyWithCursor: async () => ({
        items: entries,
        pages: {},
      }),
    },
    bulkAction: {
      publish: async () => {
        onBulkAction?.('publish');
        return {
          sys: {
            id: 'bulk-1',
          },
        };
      },
      unpublish: async () => {
        onBulkAction?.('unpublish');
        return {
          sys: {
            id: 'bulk-1',
          },
        };
      },
      get: async () => bulkStatus,
    },
  } as unknown as PlainClientAPI;
}

test('runPublishJob dry-run returns publishable entries and success', async () => {
  const draftEntry = createEntry('entry-draft', { version: 1 });
  const upToDateEntry = createEntry('entry-published', {
    version: 2,
    publishedVersion: 1,
  });

  const logs: string[] = [];
  const result = await runPublishJob(
    {
      token: 'token',
      spaceId: 'test-space',
      environmentId: 'master',
      tagId: 'campaign-tag',
      limit: 10,
      dryRun: true,
      verbose: false,
    },
    {
      createClient: () =>
        createClientWithEntries(draftEntry ? [draftEntry, upToDateEntry] : [], {
          sys: { status: 'succeeded' },
        }),
      onLog: (log) => {
        logs.push(log.message);
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.summary.action, 'publish');
  assert.equal(result.summary.publishableCount, 1);
  assert.equal(result.summary.selectedCount, 1);
  assert.equal(result.summary.dryRun, true);
  assert.ok(logs.some((line) => line.includes('Publishable entry IDs')));
  assert.ok(logs.some((line) => line.includes('entry-draft')));
});

test('runPublishJob unpublish dry-run returns unpublishable entries and success', async () => {
  const publishedEntry = createEntry('entry-published', {
    version: 3,
    publishedVersion: 2,
  });
  const draftEntry = createEntry('entry-draft', { version: 1 });

  const logs: string[] = [];
  const result = await runPublishJob(
    {
      token: 'token',
      spaceId: 'test-space',
      environmentId: 'master',
      tagId: 'campaign-tag',
      action: 'unpublish',
      limit: 10,
      dryRun: true,
      verbose: false,
    },
    {
      createClient: () =>
        createClientWithEntries([publishedEntry, draftEntry], {
          sys: { status: 'succeeded' },
        }),
      onLog: (log) => {
        logs.push(log.message);
      },
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.summary.action, 'unpublish');
  assert.equal(result.summary.publishableCount, 1);
  assert.equal(result.summary.selectedCount, 1);
  assert.equal(result.summary.dryRun, true);
  assert.ok(logs.some((line) => line.includes('Unpublishable entry IDs')));
  assert.ok(logs.some((line) => line.includes('entry-published')));
});

test('runPublishJob unpublish execution uses unpublish bulk action', async () => {
  const entry = createEntry('entry-1', {
    version: 3,
    publishedVersion: 2,
  });
  const actions: Array<'publish' | 'unpublish'> = [];

  const result = await runPublishJob(
    {
      token: 'token',
      spaceId: 'test-space',
      environmentId: 'master',
      tagId: 'campaign-tag',
      action: 'unpublish',
      limit: 1,
      dryRun: false,
      verbose: false,
      concurrency: 1,
    },
    {
      createClient: () =>
        createClientWithEntries(
          [entry],
          {
            sys: { status: 'succeeded' },
          },
          (action) => {
            actions.push(action);
          },
        ),
      sleep: async () => {},
    },
  );

  assert.deepEqual(actions, ['unpublish']);
  assert.equal(result.success, true);
  assert.equal(result.summary.action, 'unpublish');
  assert.equal(result.summary.results[0]?.status, 'unpublished');
});

test('parseAction validates unknown actions', () => {
  assert.equal(parseAction('publish'), 'publish');
  assert.equal(parseAction('unpublish'), 'unpublish');
  assert.throws(
    () => parseAction('remove'),
    /Unknown --action value\. Valid actions: publish, unpublish/,
  );
});

test('runPublishJob marks partial publish failures in summary', async () => {
  const firstEntry = createEntry('entry-1', { version: 1 });
  const secondEntry = createEntry('entry-2', { version: 1 });

  const result = await runPublishJob(
    {
      token: 'token',
      spaceId: 'test-space',
      environmentId: 'master',
      tagId: 'campaign-tag',
      limit: 2,
      dryRun: false,
      verbose: false,
      concurrency: 1,
    },
    {
      createClient: () =>
        createClientWithEntries([firstEntry, secondEntry], {
          sys: { status: 'failed' },
          error: {
            details: {
              errors: [
                {
                  entity: {
                    sys: {
                      id: 'entry-2',
                    },
                  },
                  error: {
                    message: 'Validation failed',
                  },
                },
              ],
            },
          },
        }),
      sleep: async () => {},
    },
  );

  assert.equal(result.success, false);
  assert.equal(result.summary.publishedCount, 1);
  assert.equal(result.summary.failedCount, 1);
  assert.equal(
    result.summary.results.find((item) => item.entryId === 'entry-2')?.status,
    'failed',
  );
});

test('runPublishJob validates concurrency upper bound', async () => {
  await assert.rejects(
    () =>
      runPublishJob({
        token: 'token',
        spaceId: 'test-space',
        environmentId: 'master',
        tagId: 'campaign-tag',
        limit: 1,
        concurrency: 6,
      }),
    /concurrency must be at most 5/,
  );
});

test('runPublishJob supports explicit space/environment scope without target', async () => {
  const draftEntry = createEntry('entry-draft', { version: 1 });

  const result = await runPublishJob(
    {
      token: 'token',
      spaceId: 'custom-space',
      environmentId: 'preview',
      tagId: 'campaign-tag',
      action: 'publish',
      limit: 5,
      dryRun: true,
    },
    {
      createClient: () =>
        createClientWithEntries([draftEntry], {
          sys: { status: 'succeeded' },
        }),
    },
  );

  assert.equal(result.success, true);
  assert.equal(result.summary.target, undefined);
  assert.equal(result.summary.targetLabel, undefined);
  assert.equal(result.summary.spaceId, 'custom-space');
  assert.equal(result.summary.environmentId, 'preview');
});

test('runPublishJob rejects missing scope when target is omitted', async () => {
  await assert.rejects(
    () =>
      runPublishJob({
        token: 'token',
        tagId: 'campaign-tag',
        limit: 1,
      }),
    /spaceId and environmentId are required/,
  );
});