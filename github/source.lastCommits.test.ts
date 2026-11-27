// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMemoryCache, type GitHubCache } from './cache.ts';
import { createGitHubClient, GitHubError } from './client.ts';
import { createGitHubSource, LAST_COMMIT_BATCH } from './source.ts';
import { createFakeGitHub, json } from './test/fakeGitHub.ts';

import { AuthError } from '../auth/client.ts';
import { EditletError } from '../core/issues.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});

const pathOf = (i: number) => `cms/content/post/post-${String(i).padStart(4, '0')}.md`;
const textOf = (title: string) => `---\ntitle: ${title}\n---\n`;
const postPaths = (count: number) => Array.from({ length: count }, (_, i) => pathOf(i));

interface Query {
  query: string;
  variables: Record<string, unknown>;
}

/** The paths one `LastCommits` request asked: its `$p0`, `$p1`… variables. */
const asked = (q: Query) => Object.keys(q.variables).filter((key) => /^p\d+$/.test(key)).length;

function setup(opts: { count?: number; cache?: GitHubCache } = {}) {
  const files = Object.fromEntries(postPaths(opts.count ?? 3).map((path, i) => [path, textOf(`Post ${i}`)]));
  const fake = createFakeGitHub({ branches: { main: { 'cms/schema.json': SCHEMA, ...files } } });
  /** Every `LastCommits` request, in the order sent. */
  const queries: Query[] = [];
  /** Answers a `LastCommits` request instead of the fake; `undefined` lets the fake answer. */
  const hooks: { answer?: (q: Query, index: number) => Response | undefined } = {};
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Partial<Query>) : undefined;
    if (body?.query?.startsWith('query LastCommits')) {
      const q = body as Query;
      queries.push(q);
      const answer = hooks.answer?.(q, queries.length - 1);
      if (answer) return answer;
    }
    return fake.fetch(input, init);
  }) as typeof globalThis.fetch;
  const client = createGitHubClient({ token: 'tok', fetch });
  const cache = opts.cache ?? createMemoryCache();
  const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache });
  return { fake, source, cache, queries, hooks };
}

const timeout = () =>
  json({ data: null, errors: [{ message: 'Something went wrong while executing your query. It may be a timeout.' }] });
const badGateway = () => json({ message: 'Server Error' }, 502);

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
}

describe('GitHubSource.lastCommits', () => {
  it(`asks ${LAST_COMMIT_BATCH} paths per query, as variables`, async () => {
    const { source, queries } = setup({ count: 120 });
    const paths = postPaths(120);
    const result = await source.lastCommits(paths);

    expect([...result.keys()]).toEqual(paths);
    expect([...result.values()].every((event) => event !== null)).toBe(true);
    expect(queries.map(asked)).toEqual([50, 50, 20]);
    for (const q of queries) expect(q.query).not.toContain('cms/content');
    expect(queries.flatMap((q) => paths.filter((p) => Object.values(q.variables).includes(p)))).toEqual(paths);
  });

  it('answers what history() answers as updated, for each path its own last commit', async () => {
    const { fake, source } = setup();
    fake.commit('main', { [pathOf(1)]: textOf('Edited') }, 'Edit post 1');
    const result = await source.lastCommits([pathOf(0), pathOf(1)]);

    expect(result.get(pathOf(0))).toEqual((await source.history(pathOf(0))).updated);
    expect(result.get(pathOf(1))).toEqual((await source.history(pathOf(1))).updated);
    expect(result.get(pathOf(1))).toMatchObject({ message: 'Edit post 1', actor: { login: 'jane' } });
    expect(result.get(pathOf(0))?.message).toBe('Initial main');
  });

  it('asks a repeated path once', async () => {
    const { source, queries } = setup();
    const result = await source.lastCommits([pathOf(0), pathOf(0)]);
    expect(result.size).toBe(1);
    expect(queries.map(asked)).toEqual([1]);
  });

  it('asks nothing again while the shas stay', async () => {
    const { source, queries } = setup({ count: 60 });
    const first = await source.lastCommits(postPaths(60));
    queries.length = 0;
    expect(await source.lastCommits(postPaths(60))).toEqual(first);
    expect(queries).toHaveLength(0);
  });

  it('asks only the path whose sha changed', async () => {
    const { fake, source, queries } = setup({ count: 60 });
    await source.lastCommits(postPaths(60));
    queries.length = 0;
    fake.commit('main', { [pathOf(7)]: textOf('Edited') }, 'Edit post 7');
    await source.listFiles();

    const result = await source.lastCommits(postPaths(60));
    expect(queries.map(asked)).toEqual([1]);
    expect(queries[0]!.variables.p0).toBe(pathOf(7));
    expect(result.get(pathOf(7))?.message).toBe('Edit post 7');
    expect(result.get(pathOf(8))?.message).toBe('Initial main');
  });

  it('keeps each branch apart in the shared cache', async () => {
    const { fake, source, queries } = setup();
    fake.state.refs.set('editlet/x', fake.state.refs.get('main')!);
    await source.lastCommits(postPaths(3));
    queries.length = 0;
    await source.withBranch('editlet/x').lastCommits(postPaths(3));
    expect(queries.map(asked)).toEqual([3]);
  });

  it('keeps each repository apart in the shared cache', async () => {
    const { source, cache, queries } = setup();
    const first = await source.lastCommits(postPaths(3));
    queries.length = 0;
    // another repository on the same origin: the same branch, paths and blob shas
    const files = Object.fromEntries(postPaths(3).map((path, i) => [path, textOf(`Post ${i}`)]));
    const other = createFakeGitHub({
      owner: 'o2',
      repo: 'r2',
      branches: { main: { 'cms/schema.json': SCHEMA, ...files } },
    });
    const asks: Query[] = [];
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Partial<Query>) : undefined;
      if (body?.query?.startsWith('query LastCommits')) asks.push(body as Query);
      return other.fetch(input, init);
    }) as typeof globalThis.fetch;
    const sibling = createGitHubSource({
      owner: 'o2',
      repo: 'r2',
      branch: 'main',
      client: createGitHubClient({ token: 'tok', fetch }),
      cache,
    });

    expect((await sibling.lastCommits(postPaths(3))).size).toBe(3);
    expect(asks.map(asked)).toEqual([3]); // the first repository's rows did not answer for it
    expect(await source.lastCommits(postPaths(3))).toEqual(first);
    expect(queries).toHaveLength(0);
    await sibling.lastCommits(postPaths(3));
    expect(asks).toHaveLength(1); // its own rows answer now
  });

  it('asks again after the cache content is cleared', async () => {
    const { source, cache, queries } = setup();
    const first = await source.lastCommits(postPaths(3));
    await cache.clearContent();
    expect(await source.lastCommits(postPaths(3))).toEqual(first);
    expect(queries.map(asked)).toEqual([3, 3]);
  });

  it('answers null for a path no commit touched, and keeps that', async () => {
    const { fake, source, queries } = setup();
    const answer = fake.graphqlOps.LastCommits!;
    fake.graphqlOps.LastCommits = (variables, query) => {
      const result = answer(variables, query) as { data: { repository: { object: Record<string, unknown> } } };
      result.data.repository.object.p1 = { nodes: [] };
      return result;
    };
    const result = await source.lastCommits(postPaths(3));
    expect(result.get(pathOf(1))).toBeNull();
    expect(result.get(pathOf(0))).not.toBeNull();

    expect((await source.lastCommits(postPaths(3))).get(pathOf(1))).toBeNull();
    expect(queries).toHaveLength(1);
  });

  it('rejects a path that is not in the snapshot, before any query', async () => {
    const { source, queries } = setup();
    const error = await rejection(source.lastCommits([pathOf(0), 'cms/content/post/nope.md']));
    expect(error).toBeInstanceOf(EditletError);
    expect((error as EditletError).issues).toEqual([
      { file: 'cms/content/post/nope.md', path: '', message: 'File not found: cms/content/post/nope.md' },
    ]);
    expect(queries).toHaveLength(0);
  });

  it('asks at the listed head when the branch has moved since', async () => {
    const { fake, source, queries } = setup({ count: 60 });
    await source.listFiles();
    const listed = fake.state.refs.get('main')!;
    fake.commit('main', { [pathOf(0)]: textOf('Later') }, 'Later edit');

    const result = await source.lastCommits(postPaths(60));
    expect(queries.map((q) => q.variables.oid)).toEqual([listed, listed]);
    expect(result.get(pathOf(0))?.message).toBe('Initial main');
  });

  it.each([
    ['a 502', badGateway],
    ['a 504', () => json({ message: 'Gateway Timeout' }, 504)],
    ['a GraphQL timeout', timeout],
    [
      'a GraphQL "in time" error',
      () => json({ errors: [{ message: "We couldn't respond to your request in time." }] }),
    ],
  ])('splits a batch in halves after %s', async (_name, failure) => {
    const { source, queries, hooks } = setup({ count: 50 });
    hooks.answer = (_q, index) => (index === 0 ? failure() : undefined);
    const result = await source.lastCommits(postPaths(50));

    expect(queries.map(asked)).toEqual([50, 25, 25]);
    expect([...result.values()].filter((event) => event !== null)).toHaveLength(50);
  });

  it('answers null for a path that times out alone, and asks it again next time', async () => {
    const { source, queries, hooks } = setup({ count: 4 });
    const slow = pathOf(2);
    hooks.answer = (q) => (Object.values(q.variables).includes(slow) ? badGateway() : undefined);
    const result = await source.lastCommits(postPaths(4));

    expect(result.get(slow)).toBeNull();
    expect([...result.values()].filter((event) => event !== null)).toHaveLength(3);
    expect(queries.map(asked).toSorted()).toEqual([1, 1, 2, 2, 4]);

    hooks.answer = undefined;
    queries.length = 0;
    expect((await source.lastCommits(postPaths(4))).get(slow)).not.toBeNull();
    expect(queries.map(asked)).toEqual([1]);
    expect(queries[0]!.variables.p0).toBe(slow);
  });

  it.each([
    ['a 401', () => json({ message: 'Bad credentials' }, 401), AuthError],
    ['a 500', () => json({ message: 'Server Error' }, 500), GitHubError],
    ['another GraphQL error', () => json({ errors: [{ message: 'Something is wrong' }] }), GitHubError],
    [
      'a rate limit',
      () => new Response('{"message":"rate limit"}', { status: 429, headers: { 'retry-after': '3600' } }),
      GitHubError,
    ],
  ])('rejects on %s without splitting', async (_name, failure, type) => {
    const { source, queries, hooks } = setup({ count: 50 });
    hooks.answer = () => failure();
    expect(await rejection(source.lastCommits(postPaths(50)))).toBeInstanceOf(type);
    expect(queries).toHaveLength(1);
  });

  it('rejects on a network error', async () => {
    const { source, hooks } = setup();
    hooks.answer = () => {
      throw new TypeError('offline');
    };
    expect(await rejection(source.lastCommits(postPaths(3)))).toMatchObject({ code: 'network_error' });
  });

  it('keeps the batches that answered when another one fails', async () => {
    const { source, queries, hooks } = setup({ count: 60 });
    hooks.answer = (q) => (asked(q) === 10 ? json({ message: 'Server Error' }, 500) : undefined);
    await rejection(source.lastCommits(postPaths(60)));
    // The rejection does not wait for the other batch: let it land.
    await new Promise((resolve) => setTimeout(resolve, 10));

    hooks.answer = undefined;
    queries.length = 0;
    await source.lastCommits(postPaths(60));
    expect(queries.map(asked)).toEqual([10]);
  });

  it('asks 2,000 paths in 40 queries', async () => {
    const { source, queries } = setup({ count: 2000 });
    const result = await source.lastCommits(postPaths(2000));
    expect(queries).toHaveLength(40);
    expect([...result.values()].filter((event) => event !== null)).toHaveLength(2000);
  });
});
