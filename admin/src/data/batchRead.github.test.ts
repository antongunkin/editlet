import { describe, expect, it } from 'vitest';

import { batchedReader } from './batchRead';

import { createMemoryCache } from '../../../github/cache';
import { createGitHubClient } from '../../../github/client';
import { createGitHubSource } from '../../../github/source';
import { createFakeGitHub, type FileInput } from '../../../github/test/fakeGitHub';

// The batched reader over a real GitHub source (a fake GitHub behind it): a large site's first opening costs one GraphQL
// query per 50 files, at most 6 at once (docs/admin/search.md#data-and-limits).

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});

describe('batched reads on the GitHub source', () => {
  it('2,000 entries with distinct contents: 40 Blobs queries, at most 6 in flight', async () => {
    const files: Record<string, FileInput> = { 'cms/schema.json': SCHEMA };
    for (let i = 0; i < 2000; i++) files[`cms/content/post/p${i}.md`] = `---\ntitle: Post ${i}\n---\n`;
    const fake = createFakeGitHub({ branches: { main: files } });
    let blobQueries = 0;
    let inFlight = 0;
    let most = 0;
    const counting: typeof fetch = async (input, init) => {
      // Only the blob reads: the listing also sends the Snapshot and Dir queries (and reads the schema, below).
      const blobs = typeof init?.body === 'string' && init.body.includes('query Blobs');
      if (!blobs) return fake.fetch(input, init);
      blobQueries++;
      most = Math.max(most, ++inFlight);
      try {
        // A little latency, so the requests overlap as they would over the network.
        await new Promise((resolve) => setTimeout(resolve, 2));
        return await fake.fetch(input, init);
      } finally {
        inFlight--;
      }
    };
    const client = createGitHubClient({ token: 'tok', fetch: counting });
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache: createMemoryCache() });
    const listed = (await source.listFiles()).filter((f) => f.path !== 'cms/schema.json');
    expect(listed).toHaveLength(2000);
    blobQueries = 0;
    most = 0;
    const reader = batchedReader(source);
    const read = await Promise.all(listed.map((f) => reader.read(f.path)));
    expect(new TextDecoder().decode(read[0])).toMatch(/^---\ntitle: Post \d+\n---\n$/);
    expect(blobQueries).toBe(40);
    expect(most).toBeLessThanOrEqual(6);
    expect(most).toBeGreaterThan(1);
  });
});
