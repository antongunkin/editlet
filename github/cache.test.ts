// @vitest-environment node
import Dexie from 'dexie';
import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCache, openGitHubCache } from './cache.ts';
import type { GitHubCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub } from './test/fakeGitHub.ts';

import type { FileEvent } from '../core/source.ts';
import type { EntrySummary } from '../core/summary.ts';

const summary = (title: string): EntrySummary => ({
  v: 1,
  title,
  draft: false,
  refs: [{ field: 'sections.0.author', ref: 'author/jane' }],
  images: [{ field: 'blocks', at: ['blocks', 0, 'image'], label: 'Cover', src: './a.png', alt: 'A' }],
  issues: 0,
});

const event: FileEvent = {
  actor: { name: 'Jane', login: 'jane', avatarUrl: 'https://avatars.test/jane' },
  date: '2026-01-02T03:04:05Z',
  message: 'Edit',
  url: 'https://github.test/c/1',
};

const opened: GitHubCache[] = [];
const makers: [string, () => GitHubCache][] = [
  [
    'dexie',
    () => {
      const c = openGitHubCache({ indexedDB: new IDBFactory(), IDBKeyRange });
      opened.push(c);
      return c;
    },
  ],
  ['memory', () => createMemoryCache()],
];

const openedRaw: Dexie[] = [];

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const c of opened.splice(0)) await c.close?.();
  for (const db of openedRaw.splice(0)) db.close();
});

describe.each(makers)('%s cache', (_name, make) => {
  it('blobs round-trip bytes', async () => {
    const c = make();
    await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([0, 255, 10]) }]);
    const got = await c.getBlobs(['a', 'missing']);
    expect([...got.get('a')!]).toEqual([0, 255, 10]);
    expect((await c.getBlobs(['missing'])).size).toBe(0);
  });

  it('pending is scoped by repo and branch', async () => {
    const c = make();
    await c.pending('o/r#editlet/a').put({ path: 'x', content: 'hi', sha: null });
    expect(await c.pending('o/r#editlet/b').list()).toEqual([]);
    expect(await c.pending('o/r#editlet/a').list()).toHaveLength(1);
  });

  it('pending put replaces and list sorts by path', async () => {
    const q = make().pending('s');
    await q.put({ path: 'b', content: '1', sha: null });
    await q.put({ path: 'a', content: '1', sha: null });
    await q.put({ path: 'b', content: '2', sha: 'x' });
    const list = await q.list();
    expect(list.map((p) => p.path)).toEqual(['a', 'b']);
    expect(list[1]).toMatchObject({ content: '2', sha: 'x' });
    expect(typeof list[1]!.updatedAt).toBe('number');
    expect((await q.get('a'))?.path).toBe('a');
    expect(await q.get('zz')).toBeUndefined();
  });

  it('pending keeps string, bytes and null content', async () => {
    const q = make().pending('s');
    await q.put({ path: 's', content: 'text', sha: null });
    await q.put({ path: 'b', content: new Uint8Array([1, 2, 3]), sha: 'h' });
    await q.put({ path: 'n', content: null, sha: 'h2' });
    expect((await q.get('s'))!.content).toBe('text');
    expect([...((await q.get('b'))!.content as Uint8Array)]).toEqual([1, 2, 3]);
    expect((await q.get('n'))!.content).toBeNull();
  });

  it('remove and clear', async () => {
    const c = make();
    const q = c.pending('s');
    for (const p of ['a', 'b', 'c']) await q.put({ path: p, content: p, sha: null });
    await q.remove(['a', 'b']);
    expect((await q.list()).map((p) => p.path)).toEqual(['c']);
    await q.clear();
    expect(await q.list()).toEqual([]);
    await q.put({ path: 'z', content: 'z', sha: null });
    await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
    await c.clear();
    expect(await q.list()).toEqual([]);
    expect((await c.getBlobs(['a'])).size).toBe(0);
  });

  it('pending keeps base and v, and copies bytes both ways', async () => {
    const q = make().pending('s');
    const bytes = new Uint8Array([1, 2]);
    await q.put({ path: 'e', content: 'new', sha: 'h', base: 'old', v: 1 });
    await q.put({ path: 'n', content: 'first', sha: null, base: null });
    await q.put({ path: 'i', content: bytes, sha: null });
    bytes[0] = 9;
    expect(await q.get('e')).toMatchObject({ content: 'new', sha: 'h', base: 'old', v: 1 });
    expect((await q.get('n'))!.base).toBeNull();
    const image = (await q.get('i'))!;
    expect('base' in image).toBe(false);
    expect('v' in image).toBe(false);
    expect([...(image.content as Uint8Array)]).toEqual([1, 2]);
    (image.content as Uint8Array)[1] = 9;
    expect([...((await q.get('i'))!.content as Uint8Array)]).toEqual([1, 2]);
  });

  it('putMany writes every row; updatedAt is strictly increasing', async () => {
    const q = make().pending('s');
    await q.putMany([
      { path: 'a', content: 'a', sha: null },
      { path: 'b', content: new Uint8Array([1]), sha: null },
    ]);
    const [a, b] = await q.list();
    expect([a!.path, b!.path]).toEqual(['a', 'b']);
    expect(b!.updatedAt).toBeGreaterThan(a!.updatedAt);
  });

  it('removeIf keeps a newer row and removes one that is not newer', async () => {
    const q = make().pending('s');
    await q.put({ path: 'a', content: '1', sha: null });
    const first = (await q.get('a'))!.updatedAt;
    await q.put({ path: 'a', content: '2', sha: null });
    await q.removeIf('a', first);
    expect((await q.get('a'))?.content).toBe('2');
    await q.removeIf('a', (await q.get('a'))!.updatedAt);
    expect(await q.get('a')).toBeUndefined();
    await q.removeIf('missing', Date.now());
  });

  it('last commits round-trip an event and null, apart by branch, path and sha', async () => {
    const c = make();
    await c.putLastCommits('main', [
      { path: 'a', sha: '1', event },
      { path: 'b', sha: '2', event: null },
    ]);
    const keys = [
      { path: 'a', sha: '1' },
      { path: 'b', sha: '2' },
      { path: 'c', sha: '3' },
    ];
    const got = await c.getLastCommits('main', keys);
    expect([...got.keys()]).toEqual(['a', 'b']);
    expect(got.get('a')).toEqual(event);
    expect(got.get('b')).toBeNull();
    expect((await c.getLastCommits('other', keys)).size).toBe(0);
    expect((await c.getLastCommits('main', [{ path: 'a', sha: 'changed' }])).size).toBe(0);
    await c.putLastCommits('main', []);
    expect((await c.getLastCommits('main', [])).size).toBe(0);
  });

  it('summaries round-trip, apart by sha and fingerprint; an absent key is absent', async () => {
    const c = make();
    await c.putSummaries([
      { sha: 'a', fp: 'one', summary: summary('One') },
      { sha: 'a', fp: 'two', summary: summary('Two') },
      { sha: 'b', fp: 'one', summary: summary('B') },
    ]);
    const got = await c.getSummaries([
      { sha: 'a', fp: 'one' },
      { sha: 'a', fp: 'two' },
      { sha: 'b', fp: 'one' },
      { sha: 'b', fp: 'two' },
      { sha: 'c', fp: 'one' },
    ]);
    expect([...got]).toEqual([
      ['a:one', summary('One')],
      ['a:two', summary('Two')],
      ['b:one', summary('B')],
    ]);
    await c.putSummaries([{ sha: 'a', fp: 'one', summary: summary('Again') }]);
    expect((await c.getSummaries([{ sha: 'a', fp: 'one' }])).get('a:one')).toEqual(summary('Again'));
    await c.putSummaries([]);
    expect((await c.getSummaries([])).size).toBe(0);
  });

  it('copies summaries both ways', async () => {
    const c = make();
    const given = summary('One');
    await c.putSummaries([{ sha: 'a', fp: 'f', summary: given }]);
    given.refs.length = 0;
    const read = async () => (await c.getSummaries([{ sha: 'a', fp: 'f' }])).get('a:f')!;
    (await read()).images.length = 0;
    expect(await read()).toEqual(summary('One'));
  });

  it('clearContent drops blobs, last commits and summaries, not unsaved edits; clear drops all four', async () => {
    const c = make();
    const fill = async () => {
      await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
      await c.putLastCommits('main', [{ path: 'p', sha: 's', event }]);
      await c.putSummaries([{ sha: 's', fp: 'f', summary: summary('S') }]);
    };
    const content = async () => [
      (await c.getBlobs(['a'])).size,
      (await c.getLastCommits('main', [{ path: 'p', sha: 's' }])).size,
      (await c.getSummaries([{ sha: 's', fp: 'f' }])).size,
    ];
    await fill();
    await c.pending('o/r#editlet/a').put({ path: 'x', content: 'unsaved', sha: null });
    await c.clearContent();
    expect(await content()).toEqual([0, 0, 0]);
    expect(await c.pending('o/r#editlet/a').list()).toMatchObject([{ path: 'x', content: 'unsaved' }]);

    await fill();
    expect(await content()).toEqual([1, 1, 1]);
    await c.clear();
    expect(await content()).toEqual([0, 0, 0]);
    expect(await c.scopes()).toEqual([]);
  });

  it('scopes lists the scopes with rows', async () => {
    const c = make();
    expect(await c.scopes()).toEqual([]);
    await c.pending('o/r#b').put({ path: 'x', content: 'x', sha: null });
    await c.pending('local:p#main').put({ path: 'y', content: 'y', sha: null });
    await c.pending('o/r#empty').put({ path: 'z', content: 'z', sha: null });
    await c.pending('o/r#empty').remove(['z']);
    expect((await c.scopes()).toSorted()).toEqual(['local:p#main', 'o/r#b']);
  });
});

describe('persistent', () => {
  it('is true for IndexedDB and false for memory', () => {
    const c = openGitHubCache({ indexedDB: new IDBFactory(), IDBKeyRange });
    opened.push(c);
    expect(c.persistent).toBe(true);
    expect(createMemoryCache().persistent).toBe(false);
  });
});

describe('dexie specifics', () => {
  it('two instances with the same name share data', async () => {
    const deps = { indexedDB: new IDBFactory(), IDBKeyRange };
    const a = openGitHubCache({ name: 'shared', ...deps });
    const b = openGitHubCache({ name: 'shared', ...deps });
    opened.push(a, b);
    await a.pending('s').put({ path: 'p', content: 'v', sha: null });
    expect((await b.pending('s').list()).map((p) => p.path)).toEqual(['p']);
  });

  it('openGitHubCache() without indexedDB falls back to memory', async () => {
    const saved = (globalThis as { indexedDB?: unknown }).indexedDB;
    delete (globalThis as { indexedDB?: unknown }).indexedDB;
    try {
      const c = openGitHubCache();
      expect(c.persistent).toBe(false);
      await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
      expect((await c.getBlobs(['a'])).size).toBe(1);
    } finally {
      if (saved !== undefined) (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });
});

interface RawBlob {
  sha: string;
  bytes: Uint8Array;
  size?: number;
  usedAt?: number;
  kind?: string;
}

const idb = () => ({ indexedDB: new IDBFactory(), IDBKeyRange });
type Deps = ReturnType<typeof idb>;

function openCache(deps: Deps): GitHubCache {
  const c = openGitHubCache(deps);
  opened.push(c);
  return c;
}

/** The database as it is stored, whatever its version (no declared schema). */
async function openRaw(deps: Deps): Promise<Dexie> {
  const db = new Dexie('editlet-github', deps);
  openedRaw.push(db);
  await db.open();
  return db;
}

const rawBlobs = async (db: Dexie) =>
  Object.fromEntries((await db.table<RawBlob>('blobs').toArray()).map((row) => [row.sha, row]));

/** The schema of cache version 1, as the admin before it declared it. */
async function openVersion1(deps: Deps) {
  const db = new Dexie('editlet-github', deps);
  openedRaw.push(db);
  db.version(1).stores({ blobs: 'sha', pending: '[scope+path], scope' });
  await db.open();
  return db;
}

const V1_PENDING = [
  { scope: 'o/r#editlet/a', path: 'a.md', content: 'new', sha: 'h', updatedAt: 1, base: 'old', v: 1 },
  { scope: 'o/r#editlet/a', path: 'b.png', content: new Uint8Array([9, 8]), sha: null, updatedAt: 2 },
  { scope: 'o/r#editlet/b', path: 'c.md', content: null, sha: 'h2', updatedAt: 3 },
];

describe('upgrade from version 1', () => {
  async function fillVersion1(db: Dexie) {
    await db.table('blobs').bulkPut([
      { sha: 'one', bytes: new Uint8Array([1, 2, 3]) },
      { sha: 'two', bytes: new Uint8Array(1000) },
    ]);
    await db.table('pending').bulkPut(V1_PENDING);
  }

  it('keeps blobs and unsaved edits, and gives each blob its size, last use and kind', async () => {
    const deps = idb();
    const v1 = await openVersion1(deps);
    await fillVersion1(v1);
    v1.close();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(5_000_000);

    const c = openCache(deps);
    expect(await c.scopes()).toEqual(['o/r#editlet/a', 'o/r#editlet/b']);
    const raw = await openRaw(deps);
    expect(raw.verno).toBe(3);
    expect(raw.tables.map((t) => t.name).toSorted()).toEqual(['blobs', 'lastCommits', 'pending', 'summaries']);
    // Untouched: the same rows, field for field.
    expect(await raw.table('pending').toArray()).toEqual(V1_PENDING);
    const rows = await rawBlobs(raw);
    expect(rows.one).toMatchObject({ size: 3, usedAt: 5_000_000, kind: 'entry' });
    expect(rows.two).toMatchObject({ size: 1000, usedAt: 5_000_000, kind: 'entry' });
    expect([...rows.one!.bytes]).toEqual([1, 2, 3]);
    expect(await raw.table('blobs').where('usedAt').equals(5_000_000).count()).toBe(2);
    expect(await raw.table('blobs').where('kind').equals('entry').count()).toBe(2);

    expect([...(await c.getBlobs(['one'])).get('one')!]).toEqual([1, 2, 3]);
    expect(await c.pending('o/r#editlet/a').get('a.md')).toMatchObject({ content: 'new', base: 'old', v: 1 });
  });

  it('upgrades under a tab still on version 1, which keeps its unsaved edits', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined); // Dexie says it closes the old connection
    const deps = idb();
    const oldTab = await openVersion1(deps);
    await fillVersion1(oldTab);

    const c = openCache(deps);
    expect(await c.pending('o/r#editlet/a').list()).toHaveLength(2);
    await oldTab.table('pending').put({ scope: 'o/r#editlet/a', path: 'd.md', content: 'late', sha: null });
    expect(await c.pending('o/r#editlet/a').list()).toHaveLength(3);
  });
});

describe('upgrade from version 2', () => {
  /** The schema of cache version 2, as the admin before it declared it. */
  async function openVersion2(deps: Deps) {
    const db = new Dexie('editlet-github', deps);
    openedRaw.push(db);
    db.version(1).stores({ blobs: 'sha', pending: '[scope+path], scope' });
    db.version(2).stores({
      blobs: 'sha, usedAt, kind',
      pending: '[scope+path], scope',
      lastCommits: '[branch+path+sha], usedAt',
    });
    await db.open();
    return db;
  }

  it('keeps blobs, last commits and unsaved edits as they are, and adds an empty summaries table', async () => {
    const deps = idb();
    const v2 = await openVersion2(deps);
    const blobs = [{ sha: 'one', bytes: new Uint8Array([1, 2, 3]), size: 3, usedAt: 7, kind: 'image' }];
    const commits = [{ branch: 'main', path: 'a.md', sha: 'h', event, usedAt: 8 }];
    await v2.table('blobs').bulkPut(blobs);
    await v2.table('lastCommits').bulkPut(commits);
    await v2.table('pending').bulkPut(V1_PENDING);
    v2.close();

    const c = openCache(deps);
    expect(await c.scopes()).toEqual(['o/r#editlet/a', 'o/r#editlet/b']);
    const raw = await openRaw(deps);
    expect(raw.verno).toBe(3);
    expect(await raw.table('blobs').toArray()).toEqual(blobs);
    expect(await raw.table('lastCommits').toArray()).toEqual(commits);
    expect(await raw.table('pending').toArray()).toEqual(V1_PENDING);
    expect(await raw.table('summaries').count()).toBe(0);
    const { schema } = raw.table('summaries');
    expect(schema.primKey.keyPath).toEqual(['sha', 'fp']);
    expect(schema.indexes.map((index) => index.name)).toEqual(['sha', 'usedAt']);

    await c.putSummaries([{ sha: 'one', fp: 'f', summary: summary('One') }]);
    expect((await c.getSummaries([{ sha: 'one', fp: 'f' }])).size).toBe(1);
    expect((await c.getLastCommits('main', [{ path: 'a.md', sha: 'h' }])).get('a.md')).toEqual(event);
  });
});

describe('dexie rows', () => {
  it('stores size, last use and kind; kind defaults to entry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_000_000);
    const deps = idb();
    await openCache(deps).putBlobs([
      { sha: 'e', bytes: new Uint8Array(3) },
      { sha: 'i', bytes: new Uint8Array(7), kind: 'image' },
    ]);
    const rows = await rawBlobs(await openRaw(deps));
    expect(rows.e).toMatchObject({ size: 3, usedAt: 1_000_000, kind: 'entry' });
    expect(rows.i).toMatchObject({ size: 7, usedAt: 1_000_000, kind: 'image' });
  });

  /**
   * Spies the transactions of connections opened from now on (Dexie keeps the method it finds when it opens), failing
   * the write ones while `fail.writes` is set.
   */
  function spyTransactions() {
    const fail = { writes: false };
    const open = IDBDatabase.prototype.transaction;
    const spy = vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(function (
      this: IDBDatabase,
      ...args
    ) {
      if (fail.writes && args[1] === 'readwrite') throw new DOMException('full', 'QuotaExceededError');
      return open.apply(this, args);
    });
    const writes = () => spy.mock.calls.filter(([, mode]) => mode === 'readwrite').length;
    return { spy, fail, writes };
  }

  const DAY = 24 * 60 * 60_000;
  const STORES = ['blobs', 'lastCommits', 'summaries'] as const;

  /** One row in each table, written at `T0` (fake `Date`), a reader of `store` and its stored `usedAt`. */
  async function oneRow(store: (typeof STORES)[number]) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { spy, writes } = spyTransactions();
    const deps = idb();
    const c = openCache(deps);
    await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
    await c.putLastCommits('main', [{ path: 'p', sha: 's', event }]);
    await c.putSummaries([{ sha: 's', fp: 'f', summary: summary('S') }]);
    const readers = {
      blobs: (cache: GitHubCache) => cache.getBlobs(['a']),
      lastCommits: (cache: GitHubCache) => cache.getLastCommits('main', [{ path: 'p', sha: 's' }]),
      summaries: (cache: GitHubCache) => cache.getSummaries([{ sha: 's', fp: 'f' }]),
    };
    const read = (cache = c) => readers[store](cache);
    const raw = await openRaw(deps);
    const usedAt = async () => ((await raw.table(store).toArray()) as { usedAt: number }[])[0]!.usedAt;
    spy.mockClear();
    return { deps, raw, read, usedAt, writes };
  }

  const T0 = Date.UTC(2026, 10, 26);

  it.each(STORES)('%s: a read writes usedAt only for a row last used a day ago or earlier', async (store) => {
    const { deps, read, usedAt, writes } = await oneRow(store);

    vi.setSystemTime(T0 + DAY - 1);
    expect((await read()).size).toBe(1);
    expect(await usedAt()).toBe(T0);
    expect(writes()).toBe(0);

    vi.setSystemTime(T0 + DAY);
    await read();
    expect(await usedAt()).toBe(T0 + DAY);
    expect(writes()).toBe(1);

    // After a reload the stored `usedAt` alone says the row is fresh.
    const reloaded = openCache(deps);
    vi.setSystemTime(T0 + 2 * DAY - 1);
    expect((await read(reloaded)).size).toBe(1);
    expect(writes()).toBe(1);
    vi.setSystemTime(T0 + 2 * DAY);
    await read(reloaded);
    expect(await usedAt()).toBe(T0 + 2 * DAY);
    expect(writes()).toBe(2);
  });

  it.each(STORES)('%s: overlapping reads of an old row write it once', async (store) => {
    const { read, usedAt, writes } = await oneRow(store);
    vi.setSystemTime(T0 + DAY);
    await Promise.all([read(), read(), read()]);
    expect(await usedAt()).toBe(T0 + DAY);
    expect(writes()).toBe(1);
  });

  it('gives a row without usedAt (written by a tab on version 1) one when it is read', async () => {
    const { raw, read, usedAt } = await oneRow('blobs');
    await raw.table('blobs').put({ sha: 'a', bytes: new Uint8Array([1]) });
    expect((await read()).size).toBe(1);
    expect(await usedAt()).toBe(T0);
  });

  it('writes nothing for a read that finds nothing', async () => {
    const { spy, writes } = spyTransactions();
    const c = openCache(idb());
    await c.getBlobs(['none']); // opens the database
    spy.mockClear();
    await c.getBlobs(['none']);
    await c.getLastCommits('main', [{ path: 'p', sha: 's' }]);
    await c.getSummaries([{ sha: 's', fp: 'f' }]);
    expect(spy).toHaveBeenCalled();
    expect(writes()).toBe(0);
  });

  it('a failed usedAt write does not fail the read', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { spy, fail, writes } = spyTransactions();
    const c = openCache(idb());
    await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
    await c.putLastCommits('main', [{ path: 'p', sha: 's', event: null }]);
    await c.putSummaries([{ sha: 's', fp: 'f', summary: summary('S') }]);
    vi.setSystemTime(T0 + DAY);
    spy.mockClear();
    fail.writes = true;
    expect((await c.getBlobs(['a'])).size).toBe(1);
    expect((await c.getLastCommits('main', [{ path: 'p', sha: 's' }])).size).toBe(1);
    expect((await c.getSummaries([{ sha: 's', fp: 'f' }])).size).toBe(1);
    expect(writes()).toBe(3);
  });

  it('writes usedAt of many old summaries in one transaction', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    const { spy, writes } = spyTransactions();
    const c = openCache(idb());
    const keys = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, fp: 'f' }));
    await c.putSummaries(keys.map((key) => ({ ...key, summary: summary(key.sha) })));
    vi.setSystemTime(T0 + DAY);
    spy.mockClear();
    expect((await c.getSummaries(keys)).size).toBe(50);
    expect(writes()).toBe(1);
  });

  it('keeps last commits across a reload', async () => {
    const deps = idb();
    const first = openCache(deps);
    await first.putLastCommits('main', [
      { path: 'a', sha: '1', event },
      { path: 'b', sha: '2', event: null },
    ]);
    await first.close?.();
    const got = await openCache(deps).getLastCommits('main', [
      { path: 'a', sha: '1' },
      { path: 'b', sha: '2' },
    ]);
    expect([...got]).toEqual([
      ['a', event],
      ['b', null],
    ]);
  });
});

describe('the source stores images as images', () => {
  const SCHEMA = JSON.stringify({
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
  });
  const ENTRY = 'cms/content/post/a.md';
  const SVG = 'cms/content/post/a/drawing.svg'; // text: answered by the GraphQL query
  const PNG = 'cms/content/post/a/photo.PNG'; // binary: read over REST
  const files = {
    'cms/schema.json': SCHEMA,
    [ENTRY]: '---\ntitle: A\n---\n',
    [SVG]: '<svg />',
    [PNG]: new Uint8Array([137, 80, 0, 1]),
  };

  function setup() {
    const deps = idb();
    const fake = createFakeGitHub({ branches: { main: files, 'editlet/x': files } });
    const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
    const cache = openCache(deps);
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'editlet/x', client, cache });
    /** path → the kind of the cached blob its content has. */
    const kinds = async (paths: string[]) => {
      const refs = new Map((await source.listFiles()).map((ref) => [ref.path, ref.sha]));
      const rows = await rawBlobs(await openRaw(deps));
      return paths.map((path) => rows[refs.get(path)!]?.kind);
    };
    return { source, cache, kinds };
  }

  it('on readFiles', async () => {
    const { source, kinds } = setup();
    await source.readFiles([ENTRY, SVG, PNG]);
    expect(await kinds([ENTRY, SVG, PNG, 'cms/schema.json'])).toEqual(['entry', 'image', 'image', 'entry']);
  });

  it('on readVersion', async () => {
    const { source, kinds } = setup();
    await source.readVersion(PNG, await source.head());
    expect(await kinds([PNG])).toEqual(['image']);
  });

  it('on commit', async () => {
    const { source, kinds } = setup();
    const added = 'cms/content/post/a/new.webp';
    const result = await source.commit(
      [
        { path: added, content: new Uint8Array([1, 0, 2]) },
        { path: ENTRY, content: '---\ntitle: B\n---\n' },
      ],
      'Add an image',
    );
    expect(result.issues).toEqual([]);
    expect(await kinds([added, ENTRY])).toEqual(['image', 'entry']);
  });
});
