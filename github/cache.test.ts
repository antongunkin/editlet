// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';

import { createMemoryCache, openGitHubCache } from './cache.ts';
import type { GitHubCache } from './cache.ts';

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

afterEach(async () => {
  for (const c of opened.splice(0)) await c.close?.();
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
      await c.putBlobs([{ sha: 'a', bytes: new Uint8Array([1]) }]);
      expect((await c.getBlobs(['a'])).size).toBe(1);
    } finally {
      if (saved !== undefined) (globalThis as { indexedDB?: unknown }).indexedDB = saved;
    }
  });
});
