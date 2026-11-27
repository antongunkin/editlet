// @vitest-environment node
// The cache's budgets, eviction and pruning (T3 of lazy loading). Small budgets (KBs) stand for the real ones (MBs).
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CACHE_BUDGET, createMemoryCache, openGitHubCache } from './cache.ts';
import type { BlobKind, CacheBudget, GitHubCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub } from './test/fakeGitHub.ts';

import type { EntrySummary } from '../core/summary.ts';

const DAY = 24 * 60 * 60_000;
const T0 = Date.UTC(2026, 10, 26);
const KB = 1000;

const opened: GitHubCache[] = [];
const openedRaw: Dexie[] = [];
/** The idle callbacks asked for, run by hand. */
let idle: (() => void)[] = [];

beforeEach(() => {
  idle = [];
  vi.stubGlobal('requestIdleCallback', (task: () => void) => idle.push(task));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const c of opened.splice(0)) await c.close?.();
  for (const db of openedRaw.splice(0)) db.close();
});

type Deps = { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
const idb = (): Deps => ({ indexedDB: new IDBFactory(), IDBKeyRange });

function dexie(budget?: Partial<CacheBudget>, deps = idb()): GitHubCache {
  const cache = openGitHubCache({ ...deps, budget });
  opened.push(cache);
  return cache;
}

/** Evicts nothing: no budget is this large. */
const NEVER = { entries: Infinity, images: Infinity, lastCommits: Infinity, summaries: Infinity };

const ticks = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Lets what a put left behind (counting the stored rows, its budget check) happen. */
const settled = async (cache: GitHubCache) => {
  await cache.evict(NEVER); // queued behind what the put queued
  await ticks();
};

/** Runs the asked idle callbacks and waits for the eviction they start. */
async function runIdle(cache: GitHubCache) {
  for (const task of idle.splice(0)) task();
  await settled(cache);
}

/** Puts `count` blobs of 1 KB, each a millisecond after the last, named `<prefix>0`… in age order. */
async function fill(cache: GitHubCache, prefix: string, count: number, kind: BlobKind = 'entry') {
  const shas = Array.from({ length: count }, (_, i) => `${prefix}${i}`);
  for (const sha of shas) {
    vi.advanceTimersByTime(1);
    await cache.putBlobs([{ sha, bytes: new Uint8Array(KB), kind }]);
  }
  return shas;
}

const kept = async (cache: GitHubCache, shas: string[]) => [...(await cache.getBlobs(shas)).keys()];

const commitKeys = (count: number) => Array.from({ length: count }, (_, i) => ({ path: `p${i}`, sha: `s${i}` }));
const keptCommits = async (cache: GitHubCache, count: number) => [
  ...(await cache.getLastCommits('main', commitKeys(count))).keys(),
];
async function fillCommits(cache: GitHubCache, from: number, to: number) {
  for (const key of commitKeys(to).slice(from)) {
    vi.advanceTimersByTime(1);
    await cache.putLastCommits('main', [{ ...key, event: null }]);
  }
}

const SUMMARY: EntrySummary = { v: 1, title: 'T', draft: false, refs: [], images: [], issues: 0 };
const summaryKeys = (count: number) => Array.from({ length: count }, (_, i) => ({ sha: `s${i}`, fp: 'f' }));
const keptSummaries = async (cache: GitHubCache, count: number) =>
  [...(await cache.getSummaries(summaryKeys(count))).keys()].map((key) => key.split(':')[0]);
async function fillSummaries(cache: GitHubCache, from: number, to: number) {
  for (const key of summaryKeys(to).slice(from)) {
    vi.advanceTimersByTime(1);
    await cache.putSummaries([{ ...key, summary: SUMMARY }]);
  }
}

const UNSAVED = { path: 'a.md', content: 'unsaved', sha: null };

it('has the default budgets of the spec', () => {
  expect(CACHE_BUDGET).toEqual({
    entries: 50 * 2 ** 20,
    images: 50 * 2 ** 20,
    lastCommits: 50_000,
    summaries: 50_000,
  });
});

describe.each([
  ['dexie', (budget?: Partial<CacheBudget>) => dexie(budget)],
  ['memory', (budget?: Partial<CacheBudget>) => createMemoryCache({ budget })],
])('%s cache budgets', (_name, make) => {
  it('60 KB of entries in a 50 KB budget leaves 40 KB, the newest', async () => {
    const cache = make({ entries: 50 * KB });
    const shas = await fill(cache, 'e', 60);
    await cache.evict();
    expect(await kept(cache, shas)).toEqual(shas.slice(20));
  });

  it('counts images and entries apart', async () => {
    const cache = make({ entries: 50 * KB, images: 50 * KB });
    const entries = await fill(cache, 'e', 30);
    const images = await fill(cache, 'i', 60, 'image');
    await cache.evict();
    expect(await kept(cache, entries)).toEqual(entries);
    expect(await kept(cache, images)).toEqual(images.slice(20));
  });

  it('keeps a blob read just now, though it was written first', async () => {
    const cache = make({ entries: 5 * KB });
    const shas = await fill(cache, 'e', 6);
    vi.setSystemTime(T0 + DAY * 2);
    await cache.getBlobs(['e0']);
    await cache.evict();
    expect(await kept(cache, shas)).toEqual(['e0', 'e3', 'e4', 'e5']);
  });

  it('keeps to the last-commit budget by rows', async () => {
    const cache = make({ lastCommits: 10 });
    await fillCommits(cache, 0, 11);
    await cache.evict();
    expect(await keptCommits(cache, 11)).toEqual(
      commitKeys(11)
        .slice(3)
        .map((k) => k.path),
    );
  });

  it('keeps to the summary budget by rows, dropping the oldest first', async () => {
    const cache = make({ summaries: 10 });
    await cache.pending('o/r#editlet/a').put(UNSAVED);
    await fillSummaries(cache, 0, 11);
    await fillCommits(cache, 0, 3);
    await cache.evict();
    expect(await keptSummaries(cache, 11)).toEqual(
      summaryKeys(11)
        .slice(3)
        .map((k) => k.sha),
    );
    expect(await keptCommits(cache, 3)).toHaveLength(3); // its own budget
    expect(await cache.pending('o/r#editlet/a').list()).toMatchObject([UNSAVED]);
  });

  it('keeps a summary read just now, though it was written first', async () => {
    const cache = make({ summaries: 5 });
    await fillSummaries(cache, 0, 6);
    vi.setSystemTime(T0 + DAY * 2);
    await cache.getSummaries(summaryKeys(1));
    await cache.evict();
    expect(await keptSummaries(cache, 6)).toEqual(['s0', 's3', 's4', 's5']);
  });

  it('schedules a run for too many summaries', async () => {
    const cache = make({ summaries: 5 });
    await fillSummaries(cache, 0, 5);
    await fillSummaries(cache, 0, 5); // the same rows again are not counted twice
    await settled(cache);
    expect(idle).toHaveLength(0);
    await fillSummaries(cache, 5, 6);
    await settled(cache);
    expect(idle).toHaveLength(1);
    await runIdle(cache);
    expect(await keptSummaries(cache, 6)).toEqual(['s2', 's3', 's4', 's5']);
  });

  it('keeps its summary total right across evictions, pruning and clearContent', async () => {
    const cache = make({ summaries: 10 });
    const quiet = async () => {
      await settled(cache);
      expect(idle).toHaveLength(0);
    };
    await fillSummaries(cache, 0, 9);
    await cache.putSummaries([
      { sha: 'twin', fp: 'f', summary: SUMMARY },
      { sha: 'twin', fp: 'f', summary: SUMMARY },
    ]);
    await quiet(); // 10 rows
    await cache.evict({ summaries: 5 }); // 4
    await fillSummaries(cache, 20, 26);
    await quiet(); // 10
    await cache.pruneUnreachable(new Set(), T0 + DAY); // 0
    await fillSummaries(cache, 0, 10);
    await quiet(); // 10
    await cache.clearContent();
    await fillSummaries(cache, 0, 10);
    await quiet();
    await fillSummaries(cache, 10, 11);
    await settled(cache);
    expect(idle).toHaveLength(1);
  });

  it('evict() takes budgets for that run alone, and does nothing under them', async () => {
    const cache = make();
    const shas = await fill(cache, 'e', 5);
    await cache.evict();
    expect(await kept(cache, shas)).toEqual(shas);
    await cache.evict({ entries: 4 * KB });
    expect(await kept(cache, shas)).toEqual(shas.slice(2));
    await settled(cache);
    expect(idle).toHaveLength(0);
  });

  it('schedules one run for many puts over a budget, and another after it', async () => {
    const cache = make({ entries: 5 * KB });
    const first = await fill(cache, 'a', 5);
    await settled(cache);
    expect(idle).toHaveLength(0); // at the budget, not over it
    const more = await fill(cache, 'b', 5);
    await settled(cache);
    expect(idle).toHaveLength(1);
    await runIdle(cache);
    expect(await kept(cache, [...first, ...more])).toEqual(more.slice(1));
    const last = await fill(cache, 'c', 2);
    await settled(cache);
    expect(idle).toHaveLength(1);
    await runIdle(cache);
    expect(await kept(cache, [...more, ...last])).toEqual(['b3', 'b4', 'c0', 'c1']);
  });

  it('schedules a run for too many last commits', async () => {
    const cache = make({ lastCommits: 5 });
    await fillCommits(cache, 0, 5);
    await fillCommits(cache, 0, 5); // the same rows again are not counted twice
    await settled(cache);
    expect(idle).toHaveLength(0);
    await fillCommits(cache, 5, 6);
    await settled(cache);
    expect(idle).toHaveLength(1);
    await runIdle(cache);
    expect(await keptCommits(cache, 6)).toEqual(['p2', 'p3', 'p4', 'p5']);
  });

  it('keeps its totals right across puts, evictions, pruning and clearContent', async () => {
    const cache = make({ entries: 10 * KB });
    const quiet = async () => {
      await settled(cache);
      expect(idle).toHaveLength(0);
    };
    await fill(cache, 'a', 8);
    await fill(cache, 'a', 8); // the same blobs again are not counted twice
    await cache.putBlobs([
      { sha: 'twin', bytes: new Uint8Array(KB) },
      { sha: 'twin', bytes: new Uint8Array(KB) },
    ]);
    await quiet(); // 9 KB
    await cache.evict({ entries: 5 * KB }); // 4 KB
    await fill(cache, 'b', 6);
    await quiet(); // 10 KB
    await cache.pruneUnreachable(new Set(), T0 + DAY); // 0
    await fill(cache, 'c', 10);
    await quiet(); // 10 KB
    await cache.clearContent();
    await fill(cache, 'd', 10);
    await quiet();
    await cache.putBlobs([{ sha: 'one', bytes: new Uint8Array(1) }]);
    await settled(cache);
    expect(idle).toHaveLength(1);
  });

  it('pruneUnreachable drops only rows that are unreachable and old', async () => {
    const cache = make();
    await cache.putBlobs([
      { sha: 's0', bytes: new Uint8Array(1) },
      { sha: 's1', bytes: new Uint8Array(1), kind: 'image' },
    ]);
    await fillCommits(cache, 0, 2);
    await fillSummaries(cache, 0, 2);
    await cache.putSummaries([{ sha: 's1', fp: 'other', summary: SUMMARY }]);
    vi.setSystemTime(T0 + 30 * DAY);
    await cache.putBlobs([{ sha: 's2', bytes: new Uint8Array(1) }]);
    await fillCommits(cache, 2, 3);
    await fillSummaries(cache, 2, 3);
    await cache.pruneUnreachable(new Set(['s0']), T0 + DAY);
    expect(await kept(cache, ['s0', 's1', 's2'])).toEqual(['s0', 's2']);
    expect(await keptCommits(cache, 3)).toEqual(['p0', 'p2']);
    expect(await keptSummaries(cache, 3)).toEqual(['s0', 's2']);
    expect((await cache.getSummaries([{ sha: 's1', fp: 'other' }])).size).toBe(0);
  });

  it('never drops unsaved edits', async () => {
    const cache = make({ entries: KB, images: KB, lastCommits: 1, summaries: 1 });
    await cache.pending('o/r#editlet/a').put(UNSAVED);
    await fill(cache, 'a', 3);
    await fillCommits(cache, 0, 3);
    await fillSummaries(cache, 0, 3);
    await settled(cache);
    await runIdle(cache);
    await cache.evict({ entries: 0, images: 0, lastCommits: 0, summaries: 0 });
    await cache.pruneUnreachable(new Set(), Number.MAX_SAFE_INTEGER);
    expect(await kept(cache, ['a0', 'a1', 'a2'])).toEqual([]);
    expect(await keptCommits(cache, 3)).toEqual([]);
    expect(await keptSummaries(cache, 3)).toEqual([]);
    expect(await cache.pending('o/r#editlet/a').list()).toMatchObject([UNSAVED]);
  });
});

it('without requestIdleCallback the run comes a second later', async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  // `setTimeout` alone: faking everything would also give Node a `requestIdleCallback`.
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  const cache = createMemoryCache({ budget: { entries: 2 * KB } });
  await cache.putBlobs([{ sha: 'a', bytes: new Uint8Array(3 * KB) }]);
  await vi.advanceTimersByTimeAsync(999);
  expect(await kept(cache, ['a'])).toEqual(['a']);
  await vi.advanceTimersByTimeAsync(1);
  expect(await kept(cache, ['a'])).toEqual([]);
});

describe('the quota', () => {
  const quota = (estimate: () => Promise<StorageEstimate>) => {
    const spy = vi.fn(estimate);
    vi.stubGlobal('navigator', { storage: { estimate: spy } });
    return spy;
  };

  it('lowers the byte budgets to a tenth of the room left, asked once', async () => {
    const estimate = quota(async () => ({ quota: 100 * KB, usage: 50 * KB })); // a tenth of 50 KB
    const cache = dexie();
    const entries = await fill(cache, 'e', 6);
    const images = await fill(cache, 'i', 5, 'image');
    await fillCommits(cache, 0, 3);
    await fillSummaries(cache, 0, 3);
    await settled(cache);
    expect(idle).toHaveLength(1);
    await runIdle(cache);
    expect(await kept(cache, entries)).toEqual(entries.slice(2));
    expect(await kept(cache, images)).toEqual(images);
    expect(await keptCommits(cache, 3)).toHaveLength(3); // rows, not bytes
    expect(await keptSummaries(cache, 3)).toHaveLength(3);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['has plenty of room', async () => ({ quota: 1e12, usage: 0 })],
    ['gives no quota', async () => ({})],
    ['fails', () => Promise.reject(new Error('no'))],
  ])('leaves them when it %s', async (_case, estimate) => {
    quota(estimate);
    const cache = dexie({ entries: 5 * KB });
    const shas = await fill(cache, 'e', 6);
    await cache.evict();
    expect(await kept(cache, shas)).toEqual(shas.slice(2));
  });

  it('is not asked by the memory cache', async () => {
    const estimate = quota(async () => ({ quota: 0 }));
    const cache = createMemoryCache();
    await fill(cache, 'e', 2);
    await cache.evict();
    expect(await kept(cache, ['e0', 'e1'])).toHaveLength(2);
    expect(estimate).not.toHaveBeenCalled();
  });
});

describe('dexie eviction', () => {
  async function raw(deps: Deps): Promise<Dexie> {
    const db = new Dexie('editlet-github', deps);
    openedRaw.push(db);
    await db.open();
    return db;
  }

  it('counts what was stored before this page', async () => {
    const deps = idb();
    const first = dexie({}, deps);
    await fill(first, 'e', 5);
    await fillCommits(first, 0, 5);
    await fillSummaries(first, 0, 5);
    await first.close?.();

    const entries = dexie({ entries: 5 * KB }, deps);
    await fill(entries, 'f', 1);
    await settled(entries);
    expect(idle).toHaveLength(1);
    await entries.close?.();

    idle = [];
    const commits = dexie({ lastCommits: 5 }, deps);
    await fillCommits(commits, 5, 6);
    await settled(commits);
    expect(idle).toHaveLength(1);
    await commits.close?.();

    idle = [];
    const summaries = dexie({ summaries: 5 }, deps);
    await fillSummaries(summaries, 5, 6);
    await settled(summaries);
    expect(idle).toHaveLength(1);
  });

  /** Rows as a tab still on version 1 writes them: no size, last use or kind. */
  async function withOldRows(budget?: Partial<CacheBudget>) {
    const deps = idb();
    const first = dexie({}, deps);
    await fill(first, 'e', 2);
    const db = await raw(deps);
    await db.table('blobs').bulkPut([
      { sha: 'old1', bytes: new Uint8Array(KB) },
      { sha: 'old2', bytes: new Uint8Array(KB) },
    ]);
    await first.close?.();
    return dexie(budget, deps);
  }
  const ALL = ['e0', 'e1', 'old1', 'old2'];

  it('counts rows without size or last use, and drops them first', async () => {
    const cache = await withOldRows({ entries: 3 * KB });
    await cache.evict();
    expect(await kept(cache, ALL)).toEqual(['e0', 'e1']);
  });

  it('prunes them when unreachable, unless they were read meanwhile', async () => {
    const cache = await withOldRows();
    await cache.getBlobs(['old1']); // a read gives it a last use
    await cache.pruneUnreachable(new Set(), T0);
    expect(await kept(cache, ALL)).toEqual(['e0', 'e1', 'old1']);
  });

  it('a read-only page does not count the rows; the first put does not wait for the count', async () => {
    const deps = idb();
    const first = dexie({}, deps);
    await fill(first, 'e', 3);
    await first.close?.();
    const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor');
    const cache = dexie({}, deps);
    await kept(cache, ['e0']);
    await ticks();
    expect(cursor).not.toHaveBeenCalled();
    await cache.putBlobs([{ sha: 'f', bytes: new Uint8Array(1) }]);
    expect(cursor).not.toHaveBeenCalled(); // asked for, not yet run
    await vi.waitFor(() => expect(cursor).toHaveBeenCalled());
  });

  it('neither evict nor pruneUnreachable rejects on a closed database', async () => {
    const cache = dexie();
    await fill(cache, 'e', 1);
    await cache.close?.();
    await expect(cache.evict()).resolves.toBeUndefined();
    await expect(cache.pruneUnreachable(new Set(), T0)).resolves.toBeUndefined();
  });
});

describe('the source prunes after a snapshot loads', () => {
  const SCHEMA = JSON.stringify({
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
  });
  const files = { 'cms/schema.json': SCHEMA, 'cms/content/post/a.md': '---\ntitle: A\n---\n', 'README.md': 'x' };

  function setup(schema = SCHEMA, cache: GitHubCache = createMemoryCache()) {
    const fake = createFakeGitHub({ branches: { main: { ...files, 'cms/schema.json': schema } } });
    const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
    const prune = vi.spyOn(cache, 'pruneUnreachable');
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache });
    return { fake, source, prune };
  }

  const run = async () => {
    for (const task of idle.splice(0)) task();
    await ticks();
  };

  it('when idle, with every listed tree and the schema, once per head', async () => {
    const { fake, source, prune } = setup();
    const first = await source.listFiles();
    expect(prune).not.toHaveBeenCalled();
    await run();
    expect(prune).toHaveBeenCalledTimes(1);
    const [reachable, olderThan] = prune.mock.calls[0]!;
    expect([...reachable].toSorted()).toEqual(first.map((ref) => ref.sha).toSorted());
    expect(olderThan).toBe(T0 - 30 * DAY);

    await source.listFiles(); // the same head
    await run();
    expect(prune).toHaveBeenCalledTimes(1);

    fake.commit('main', { 'cms/content/post/b.md': '---\ntitle: B\n---\n' });
    const second = await source.listFiles();
    await run();
    expect(prune).toHaveBeenCalledTimes(2);
    // The shas of earlier trees stay reachable for the page.
    const all = new Set([...first, ...second].map((ref) => ref.sha));
    expect(new Set(prune.mock.calls[1]![0])).toEqual(all);
  });

  it('not when there is no content tree to compare with', async () => {
    const { source, prune } = setup('not json');
    await source.listFiles();
    await run();
    expect(prune).not.toHaveBeenCalled();
  });

  it('and a prune that throws reaches nobody', async () => {
    const { source, prune } = setup();
    prune.mockImplementation(() => {
      throw new Error('broken cache');
    });
    await source.listFiles();
    await run();
    expect(prune).toHaveBeenCalledTimes(1);
  });
});
