import { afterEach, describe, expect, it, vi } from 'vitest';

import { changesStore, localScope, onChanges, TAB_ID, type ChangesMessage } from './store';

import { loadSchema } from '../../../core/schema';
import { createMemoryCache } from '../../../github';

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      fields: {
        title: { type: 'string', label: 'Title' },
        cover: { type: 'image', label: 'Cover' },
        body: { type: 'markdown', label: 'Body' },
      },
    },
  },
});

const post = (fm: string, body = '') => `---\n${fm}\n---\n${body}`;

const unsubscribe: (() => void)[] = [];
afterEach(() => {
  for (const off of unsubscribe.splice(0)) off();
});

function listen(): ChangesMessage[] {
  const got: ChangesMessage[] = [];
  unsubscribe.push(onChanges((m) => got.push(m)));
  return got;
}

describe('changesStore', () => {
  it('keeps scopes apart: GitHub branches and dev projects and branches', async () => {
    const cache = createMemoryCache();
    const a = changesStore(cache, 'o/r#editlet/a');
    const b = changesStore(cache, 'o/r#editlet/b');
    const devA = changesStore(cache, localScope('p1', 'main'));
    const devB = changesStore(cache, localScope('p2', 'main'));
    await a.writeEntry({ path: 'cms/content/post/x.md', content: post('title: A'), sha: 's', base: post('title: X') });
    await devA.writeEntry({ path: 'cms/content/post/x.md', content: post('title: D'), sha: null, base: null });
    expect(await b.queue.list()).toEqual([]);
    expect(await devB.queue.list()).toEqual([]);
    expect((await a.queue.list())[0]).toMatchObject({ content: post('title: A'), base: post('title: X') });
    expect((await devA.queue.list())[0]).toMatchObject({ sha: null, base: null });
    expect(localScope('p', null)).toBe('local:p#-');
    expect(await cache.scopes()).toEqual(['local:p1#main', 'o/r#editlet/a']);
  });

  it('writes an entry row with its images in one call and broadcasts the paths with this tab', async () => {
    const got = listen();
    const store = changesStore(createMemoryCache(), 's');
    await store.writeEntry({ path: 'cms/content/post/x.md', content: post('cover: ./x/a.png'), sha: null }, [
      { path: 'cms/content/post/x/a.png', content: new Uint8Array([1]), sha: null },
    ]);
    expect((await store.queue.list()).map((r) => r.path)).toEqual([
      'cms/content/post/x.md',
      'cms/content/post/x/a.png',
    ]);
    expect(got).toEqual([{ scope: 's', paths: ['cms/content/post/x.md', 'cms/content/post/x/a.png'], tab: TAB_ID }]);
  });

  it('prunes the image rows no entry references, by image field and by body image', async () => {
    const store = changesStore(createMemoryCache(), 's');
    await store.writeEntry(
      {
        path: 'cms/content/post/x.md',
        content: post('cover:\n  src: ./x/cover.png\n  alt: A', '![a](./x/body.png)'),
        sha: null,
      },
      [
        { path: 'cms/content/post/x/cover.png', content: new Uint8Array([1]), sha: null },
        { path: 'cms/content/post/x/body.png', content: new Uint8Array([2]), sha: null },
        { path: 'cms/content/post/x/dropped.png', content: new Uint8Array([3]), sha: null },
      ],
    );
    await store.pruneImages(schema);
    expect((await store.queue.list()).map((r) => r.path)).toEqual([
      'cms/content/post/x.md',
      'cms/content/post/x/body.png',
      'cms/content/post/x/cover.png',
    ]);
    await store.removeEntry('cms/content/post/x.md');
    await store.pruneImages(schema);
    expect(await store.queue.list()).toEqual([]);
  });

  it('runs writes in order on one queue per cache, across stores', async () => {
    const cache = createMemoryCache();
    const slow = cache.pending('s');
    const order: string[] = [];
    const putMany = slow.putMany.bind(slow);
    vi.spyOn(cache, 'pending').mockImplementation(() => ({
      ...slow,
      putMany: async (rows) => {
        await new Promise((r) => setTimeout(r, rows[0]!.path === 'a' ? 20 : 0));
        order.push(`put ${rows[0]!.path}`);
        return putMany(rows);
      },
      remove: async (paths) => {
        order.push(`remove ${paths[0]}`);
        return slow.remove(paths);
      },
    }));
    const one = changesStore(cache, 's');
    const two = changesStore(cache, 's');
    await Promise.all([
      one.writeEntry({ path: 'a', content: 'a', sha: null }),
      two.removeEntry('a'),
      two.writeEntry({ path: 'b', content: 'b', sha: null }),
    ]);
    expect(order).toEqual(['put a', 'remove a', 'put b']);
    expect((await slow.list()).map((r) => r.path)).toEqual(['b']);
  });

  it('a failed write rejects its caller and does not stop the queue', async () => {
    const cache = createMemoryCache();
    const queue = cache.pending('s');
    vi.spyOn(cache, 'pending').mockReturnValue({
      ...queue,
      putMany: () => Promise.reject(new Error('quota')),
    });
    const store = changesStore(cache, 's');
    await expect(store.writeEntry({ path: 'a', content: 'a', sha: null })).rejects.toThrow('quota');
    await store.removeEntry('a');
  });

  it('removeIf keeps a row written after the save started', async () => {
    const store = changesStore(createMemoryCache(), 's');
    await store.writeEntry({ path: 'a', content: '1', sha: null });
    const committed = (await store.queue.get('a'))!.updatedAt;
    await store.writeEntry({ path: 'a', content: '2', sha: null });
    await store.removeIf('a', committed);
    expect((await store.queue.get('a'))?.content).toBe('2');
  });

  it('moves a scope and clears one, broadcasting both scopes', async () => {
    const got = listen();
    const cache = createMemoryCache();
    const gone = changesStore(cache, 'o/r#editlet/gone');
    await gone.writeEntry({ path: 'a', content: 'a', sha: 'x', base: 'old' });
    got.length = 0;
    await gone.moveScope('o/r#editlet/gone', 'o/r#main');
    expect(await gone.queue.list()).toEqual([]);
    expect(await cache.pending('o/r#main').list()).toMatchObject([{ path: 'a', content: 'a', sha: 'x', base: 'old' }]);
    expect(got.map((m) => m.scope)).toEqual(['o/r#editlet/gone', 'o/r#main']);
    const main = changesStore(cache, 'o/r#main');
    await main.clearAll();
    expect(await main.queue.list()).toEqual([]);
  });
});
