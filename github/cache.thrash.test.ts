// @vitest-environment node
// Does an entries budget far below the content make a read of every entry (the collection list, Search) fetch the same
// blob twice? 2,000 posts (~18 MB) against a 1 MB budget, with the eviction run as soon as it is asked for.
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, expect, it, vi } from 'vitest';

import { openGitHubCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub } from './test/fakeGitHub.ts';

const POSTS = 2000;
/** The admin's `BATCH_LIMIT` (admin/src/data/batchRead.ts): paths per `readFiles` call. */
const BATCH = 200;

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});

/** The bench posts' long tail of body sizes: 60 % 1–4 KB, 30 % 4–20 KB, 10 % 20–60 KB. */
function bodySize(i: number): number {
  const spread = ((i * 7919) % 1000) / 1000;
  const bucket = i % 10;
  if (bucket < 6) return 1024 + spread * 3072;
  if (bucket < 9) return 4096 + spread * 16_384;
  return 20_480 + spread * 40_960;
}

const posts = Object.fromEntries(
  Array.from({ length: POSTS }, (_, i) => [
    `cms/content/post/p${String(i).padStart(4, '0')}.md`,
    `---\ntitle: Post ${i}\n---\n\n${'word '.repeat(Math.ceil(bodySize(i) / 5))}\n`,
  ]),
);

afterEach(() => {
  vi.unstubAllGlobals();
});

it.each(['at once', 'one after another'] as const)(
  'a pass over 2,000 entries never fetches a blob twice (batches %s)',
  async (mode) => {
    // The worst case: the run does not wait for an idle page.
    let runs = 0;
    vi.stubGlobal('requestIdleCallback', (task: () => void) => {
      runs++;
      setTimeout(task, 0);
    });
    const fake = createFakeGitHub({ branches: { main: { 'cms/schema.json': SCHEMA, ...posts } } });
    /** The blob shas asked of GitHub by `Blobs` queries. */
    let asked: string[] = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('query Blobs(')) {
        asked.push(...[...body.matchAll(/object\(oid: \\"([0-9a-f]{40})/g)].map((m) => m[1]!));
      }
      return fake.fetch(input, init);
    };
    const cache = openGitHubCache({ indexedDB: new IDBFactory(), IDBKeyRange, budget: { entries: 2 ** 20 } });
    const client = createGitHubClient({ token: 'tok', fetch });
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache });
    await source.listFiles();

    const paths = Object.keys(posts);
    const batches = Array.from({ length: POSTS / BATCH }, (_, i) => paths.slice(i * BATCH, (i + 1) * BATCH));
    async function pass(): Promise<number> {
      asked = [];
      let read = 0;
      const one = async (batch: string[]) => {
        const got = await source.readFiles(batch);
        read += got.size;
      };
      if (mode === 'at once') await Promise.all(batches.map(one));
      else for (const batch of batches) await one(batch);
      expect(read).toBe(POSTS);
      expect(new Set(asked).size).toBe(asked.length);
      return asked.length;
    }

    const first = await pass();
    // As later in the session: the runs the first pass asked for are over (this one waits behind them).
    await cache.evict();
    const second = await pass();
    expect(first).toBe(POSTS);
    // A scan of 18 times the budget leaves least-recently-used little to hit: nearly everything is fetched again.
    expect(second).toBeGreaterThan(POSTS * 0.9);
    expect(second).toBeLessThanOrEqual(POSTS);
    expect(runs).toBeGreaterThan(1);

    await cache.evict();
    const shas = [...(await source.listFiles())].map((ref) => ref.sha);
    const left = await cache.getBlobs(shas);
    const bytes = [...left.values()].reduce((sum, blob) => sum + blob.byteLength, 0);
    expect(bytes).toBeLessThanOrEqual(2 ** 20);
    await cache.close?.();
  },
  120_000,
);
