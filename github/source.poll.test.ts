// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub, json, type FakeCall, type FileInput } from './test/fakeGitHub.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title', required: true } } } },
});
const HELLO = '---\ntitle: Hello\n---\n';
const WORLD = '---\ntitle: World\n---\n';
const FILES: Record<string, FileInput> = { 'cms/schema.json': SCHEMA, 'cms/content/post/hello.md': HELLO };

/** One ref read as the source sent it and GitHub answered it. */
interface RefRead {
  status: number;
  ifNoneMatch: string | null;
}

function setup(branch = 'main') {
  const fake = createFakeGitHub({ branches: { main: FILES, 'editlet/edit': FILES } });
  const refReads: RefRead[] = [];
  // The fake's responses, seen as the client receives them (the 304 and its If-None-Match).
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const res = await fake.fetch(input, init);
    if (String(input).includes('/git/ref/heads/')) {
      refReads.push({ status: res.status, ifNoneMatch: new Headers(init?.headers).get('if-none-match') });
    }
    return res;
  };
  const client = createGitHubClient({ token: 'tok', fetch });
  const source = createGitHubSource({ owner: 'o', repo: 'r', branch, client, cache: createMemoryCache() });
  return { fake, source, refReads };
}

const graphqlCalls = (calls: FakeCall[]) => calls.filter((c) => c.operation !== undefined);
const refCalls = (calls: FakeCall[]) => calls.filter((c) => c.method === 'GET' && c.url.includes('/git/ref/heads/'));
const treeCalls = (calls: FakeCall[]) => calls.filter((c) => c.url.includes('/git/trees/'));

describe('an idle poll reads the head ref conditionally', () => {
  it('the first load reads no ref', async () => {
    const { fake, source, refReads } = setup();
    await source.listFiles();
    expect(refCalls(fake.calls)).toHaveLength(0);
    expect(refReads).toHaveLength(0);
  });

  it('two reloads with an unchanged head: no GraphQL, no tree, both ref reads answered 304', async () => {
    const { fake, source, refReads } = setup();
    await source.listFiles(); // the first load
    await source.listFiles(); // the first poll: unconditional, its ETag is kept
    const head = await source.head();
    const mark = fake.calls.length;
    const readsBefore = refReads.length;

    await source.listFiles();
    await source.listFiles();

    const since = fake.calls.slice(mark);
    expect(graphqlCalls(since)).toHaveLength(0);
    expect(treeCalls(since)).toHaveLength(0);
    expect(refCalls(since)).toHaveLength(2);
    expect(refReads.slice(readsBefore)).toEqual([
      { status: 304, ifNoneMatch: `"${head}"` },
      { status: 304, ifNoneMatch: `"${head}"` },
    ]);
  });

  it('a moved head loads a new snapshot with the new headOid, and the polls after it are free again', async () => {
    const { fake, source, refReads } = setup();
    await source.listFiles();
    await source.listFiles();
    const next = fake.commit('main', { 'cms/content/post/world.md': WORLD }, 'Add world');

    const mark = fake.calls.length;
    const files = await source.listFiles();
    expect(await source.head()).toBe(next);
    expect(files.map((f) => f.path)).toContain('cms/content/post/world.md');
    const moved = fake.calls.slice(mark);
    expect(graphqlCalls(moved).map((c) => c.operation)).toContain('Snapshot');
    expect(treeCalls(moved).length).toBeGreaterThan(0);
    expect(refReads.at(-1)?.status).toBe(200);

    const later = fake.calls.length;
    await source.listFiles();
    expect(graphqlCalls(fake.calls.slice(later))).toHaveLength(0);
    expect(treeCalls(fake.calls.slice(later))).toHaveLength(0);
    expect(refReads.at(-1)).toEqual({ status: 304, ifNoneMatch: `"${next}"` });
  });

  it('a failing ref read (500) falls back to the GraphQL head read and still finds a moved head', async () => {
    const { fake, source, refReads } = setup();
    await source.listFiles();
    await source.listFiles(); // the ETag is kept
    const failing = {
      method: 'GET',
      pattern: /^\/git\/ref\/heads\//,
      handle: () => json({ message: 'Server Error' }, 500),
    };
    fake.restRoutes.unshift(failing);
    try {
      // unchanged head: one GraphQL head read, no tree read, no error
      const same = fake.calls.length;
      await source.listFiles();
      expect(graphqlCalls(fake.calls.slice(same)).map((c) => c.operation)).toEqual(['Snapshot']);
      expect(treeCalls(fake.calls.slice(same))).toHaveLength(0);
      expect(refReads.at(-1)?.status).toBe(500);

      // moved head: found through the GraphQL read
      const next = fake.commit('main', { 'cms/content/post/world.md': WORLD }, 'Add world');
      await source.listFiles();
      expect(await source.head()).toBe(next);
      expect(refReads.at(-1)?.status).toBe(500);
    } finally {
      fake.restRoutes.splice(fake.restRoutes.indexOf(failing), 1);
    }
  });

  it('after its own commit, the next poll reads no tree and no GraphQL', async () => {
    const { fake, source } = setup('editlet/edit');
    await source.listFiles();
    await source.listFiles();
    const result = await source.commit([{ path: 'cms/content/post/world.md', content: WORLD }], 'Add world');
    expect(result.issues).toEqual([]);
    const head = result.commit!.oid;

    const mark = fake.calls.length;
    await source.listFiles();
    const since = fake.calls.slice(mark);
    expect(graphqlCalls(since)).toHaveLength(0);
    expect(treeCalls(since)).toHaveLength(0);
    expect(await source.head()).toBe(head);
  });
});
