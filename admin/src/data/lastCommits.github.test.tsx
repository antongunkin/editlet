import { render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FileEvent } from '../../../core/source';
import { openGitHubCache, type GitHubCache } from '../../../github/cache';
import type { GitHubSourceOptions } from '../../../github/source';
import type { FakeHistoryCommit } from '../../../github/test/fakeGitHub';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, siteFetch } from '../test/liveApp';
import { createTestQueryClient } from '../test/render';

// The whole collection screen over a GitHub source (a fake GitHub behind it) on a large site: the list asks the last
// commits of 2,000 entries in 40 queries and no file history, and the next page load asks none (docs/github).

/** The IndexedDB of the test's browser profile: it stays over a "reload" (a new App, source and QueryClient). */
const disk = vi.hoisted(() => ({ indexedDB: undefined as IDBFactory | undefined, opened: [] as GitHubCache[] }));

// The workspace makes its source without a cache option, and jsdom has no IndexedDB (the source would keep a memory
// cache, gone with it). So each source gets its own connection to the one fake database.
vi.mock('../../../github', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../github')>();
  return {
    ...original,
    createGitHubSource: (options: GitHubSourceOptions) => {
      const cache = openGitHubCache({ indexedDB: disk.indexedDB, IDBKeyRange });
      disk.opened.push(cache);
      return original.createGitHubSource({ ...options, cache });
    },
  };
});

const COUNT = 2000;
/** Under the CI-less full run (coverage, a busy machine) the cold load takes longer than `waitFor`'s default. */
const LOAD_MS = 30_000;

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', titleField: 'title', fields: { title: { type: 'string', label: 'Title' } } } },
});

const id = (i: number) => String(i).padStart(4, '0');
const pathOf = (i: number) => `cms/content/post/post-${id(i)}.md`;
const post = (i: number, body = '') => `---\ntitle: Post ${id(i)}\n---\n${body}`;

/** The date the fake gives a file of its first commit. */
const FIRST = '2025-11-19T14:48:00Z';
const ANN = '2026-01-10T08:00:00Z';
const BOB = '2026-02-20T08:00:00Z';
const CY = '2026-03-30T08:00:00Z';
const DEE = '2026-04-15T08:00:00Z';

const commitOf = (name: string, date: string, posts: number[]): FakeHistoryCommit => ({
  message: `Edit by ${name}`,
  author: { name, email: `${name.slice(0, 3).toLowerCase()}@example.test` },
  date,
  files: Object.fromEntries(posts.map((i) => [pathOf(i), post(i, `${name}\n`)])),
});

/** Every fourth post (some in every batch), then two posts far apart, then the last one. */
const HISTORY: FakeHistoryCommit[] = [
  commitOf(
    'Ann Lee',
    ANN,
    Array.from({ length: COUNT / 4 }, (_, i) => i * 4),
  ),
  commitOf('Bob Stone', BOB, [777, 1234]),
  commitOf('Cy Young', CY, [1999]),
];

const dateAfterHistory = (i: number) => (i === 1999 ? CY : i === 777 || i === 1234 ? BOB : i % 4 === 0 ? ANN : FIRST);

/** Every post's path with the date `dateOf` gives it, in the shape `datesOf` returns. */
const expectedDates = (dateOf: (i: number) => string) =>
  Object.fromEntries(Array.from({ length: COUNT }, (_, i) => [pathOf(i), dateOf(i)]));

/** The fake with 2,000 posts, and the paths each `LastCommits` query asked (one array per query). */
function largeSite() {
  const files: Record<string, string> = { 'cms/schema.json': SCHEMA };
  for (let i = 0; i < COUNT; i++) files[pathOf(i)] = post(i);
  const fake = createAdminFakeGitHub({ files, history: HISTORY });
  const asked: string[][] = [];
  const answer = fake.graphqlOps.LastCommits!;
  fake.graphqlOps.LastCommits = (variables, query) => {
    asked.push(
      Object.keys(variables)
        .filter((key) => /^p\d+$/.test(key))
        .map((key) => String(variables[key])),
    );
    return answer(variables, query);
  };
  return { fake, asked };
}

/**
 * One page load of the admin on the `post` list: a new App, source and QueryClient. Resolves when the dates of all the
 * posts are there and the first row shows `newest`.
 */
async function openList(fake: AdminFakeGitHub, newest: RegExp) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  const client = createTestQueryClient();
  const view = render(<App fetch={siteFetch(LIVE_CONFIG, fake)} storage={window.localStorage} queryClient={client} />);
  // The query of the rows once they are there (before that, a disabled one for no rows holds no data).
  const answers = () =>
    client
      .getQueriesData<Map<string, FileEvent | null>>({ queryKey: ['last-commits'] })
      .flatMap(([, data]) => (data ? [data] : []));
  await waitFor(() => expect(answers()[0]?.size).toBe(COUNT), { timeout: LOAD_MS });
  const list = within(screen.getByRole('main')).getByRole('list', { name: /entries$/ });
  const rows = () => within(list).getAllByRole('button');
  await waitFor(() => expect(rows()[0]!.textContent).toMatch(newest), { timeout: LOAD_MS });
  expect(answers()).toHaveLength(1);
  return {
    dates: Object.fromEntries([...answers()[0]!].map(([path, event]) => [path, event?.date])),
    rows: rows().map((row) => row.textContent),
    close: async () => {
      view.unmount();
      client.clear();
      await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
    },
  };
}

/** What the list asked about history: `LastCommits` queries, and every per-file way (GraphQL and REST). */
const historyCalls = (fake: AdminFakeGitHub) => ({
  lastCommits: fake.calls.filter((c) => c.operation === 'LastCommits').length,
  history: fake.calls.filter((c) => c.operation === 'History').length,
  restCommits: fake.calls.filter((c) => new URL(c.url).pathname.endsWith('/commits')).length,
});

const width = window.innerWidth;

afterEach(async () => {
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  window.innerWidth = width;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the collection list of 2,000 entries in GitHub mode', () => {
  it('asks the last commits in 40 queries, none after a reload, and one for the one changed file', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, asked } = largeSite();

    // Cold: an empty cache.
    const cold = await openList(fake, /^Post 1999Published · .* · Cy Y$/);
    expect(historyCalls(fake)).toEqual({ lastCommits: 40, history: 0, restCommits: 0 });
    expect(asked.map((paths) => paths.length)).toEqual(Array.from({ length: 40 }, () => 50));
    expect(new Set(asked.flat()).size).toBe(COUNT);
    expect(cold.dates).toEqual(expectedDates(dateAfterHistory));
    expect(cold.rows.slice(1, 3).toSorted()).toEqual([
      expect.stringMatching(/^Post 0777Published · .* · Bob S$/),
      expect.stringMatching(/^Post 1234Published · .* · Bob S$/),
    ]);
    await cold.close();

    // A reload: the same branch and blob shas, so every date comes from IndexedDB.
    fake.calls.length = 0;
    asked.length = 0;
    const warm = await openList(fake, /^Post 1999Published · .* · Cy Y$/);
    expect(historyCalls(fake)).toEqual({ lastCommits: 0, history: 0, restCommits: 0 });
    expect(warm.dates).toEqual(cold.dates);
    expect(warm.rows).toEqual(cold.rows);
    await warm.close();

    // One file changes on `main`: only its sha is new.
    const oid = fake.commit('main', { [pathOf(501)]: post(501, 'Dee\n') }, 'Edit by Dee');
    Object.assign(fake.state.commits.get(oid)!, { date: DEE, author: { name: 'Dee Fox', user: null } });
    fake.calls.length = 0;
    const changed = await openList(fake, /^Post 0501Published · .* · Dee F$/);
    expect(historyCalls(fake)).toEqual({ lastCommits: 1, history: 0, restCommits: 0 });
    expect(asked).toEqual([[pathOf(501)]]);
    expect(changed.dates).toEqual(expectedDates((i) => (i === 501 ? DEE : dateAfterHistory(i))));
    await changed.close();
  }, 120_000);
});
