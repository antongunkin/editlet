import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FakeHistoryCommit } from '../../../github/test/fakeGitHub';
import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { askedPaths, historiesResponse, sourceWithDevHistory } from '../test/devHistory';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { fixtureFiles, renderApp } from '../test/render';

const main = () => screen.getByRole('main');
const list = () => within(main()).getByRole('list', { name: /entries$/ });
/** The title of each row, in list order (the row's first two spans: the title, then the status). */
const titles = () =>
  within(list())
    .getAllByRole('button')
    .map((b) => b.querySelector('span > span')?.textContent);

/** The fixture site with `post`'s title read from the `title` field (the fixture shows the slug). */
function siteFiles(): Record<string, string | Uint8Array> {
  const files = fixtureFiles();
  const schema = JSON.parse(files['cms/schema.json'] as string) as {
    collections: Record<string, Record<string, unknown>>;
  };
  schema.collections.post!.titleField = 'title';
  files['cms/schema.json'] = JSON.stringify(schema, null, 2);
  return files;
}

/** The fixture site (its `hello-world` post) and `count` more posts `Post 1`… with the title in the front matter. */
function withPosts(count: number): Record<string, string | Uint8Array> {
  const files = siteFiles();
  for (let i = 1; i <= count; i++) {
    files[`cms/content/post/post-${String(i).padStart(3, '0')}.md`] = `---\ntitle: Post ${i}\n---\nBody ${i}\n`;
  }
  return files;
}

const AUTHOR = { name: 'Ann Lee', email: 'ann@example.test' };
/** `alpha` is edited last (2026-02-01), `beta` added in 2026-01-05; `hello-world` keeps the fixture's commit date. */
const HISTORY: FakeHistoryCommit[] = [
  {
    message: 'Add alpha',
    author: AUTHOR,
    date: '2024-03-01T08:00:00Z',
    files: { 'cms/content/post/alpha.md': '---\ntitle: Alpha\n---\n' },
  },
  {
    message: 'Add beta',
    author: AUTHOR,
    date: '2026-01-05T08:00:00Z',
    files: { 'cms/content/post/beta.md': '---\ntitle: Beta\n---\n' },
  },
  {
    message: 'Edit alpha',
    author: AUTHOR,
    date: '2026-02-01T08:00:00Z',
    files: { 'cms/content/post/alpha.md': '---\ntitle: Alpha\n---\nEdited\n' },
  },
];

/**
 * The fake's `LastCommits` answer for `path` with no commit (the alias's `nodes` emptied), which a real repository can
 * give only through a path it does not know; the fake always has one.
 */
function withoutLastCommit(fake: AdminFakeGitHub, path: string): void {
  const answer = fake.fetch;
  fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await answer(input, init);
    if (typeof init?.body !== 'string' || !init.body.includes('LastCommits')) return response;
    const { variables } = JSON.parse(init.body) as { variables: Record<string, string> };
    const alias = Object.keys(variables).find((key) => /^p\d+$/.test(key) && variables[key] === path);
    if (!alias) return response;
    const body = (await response.json()) as { data: { repository: { object: Record<string, { nodes: unknown[] }> } } };
    body.data.repository.object[alias]!.nodes = [];
    return Response.json(body);
  }) as typeof fetch;
}

/** The admin on the live site (GitHub, the fake's `main`), opened on `route`. */
function renderGitHub(fake: AdminFakeGitHub, route = 'post') {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  return renderLiveApp(siteFetch(LIVE_CONFIG, fake));
}

/** The calls the fake answered for one GraphQL operation. */
const calls = (fake: AdminFakeGitHub, operation: string) => fake.calls.filter((c) => c.operation === operation);

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('Collection in GitHub mode: the dates come from lastCommits', () => {
  const width = window.innerWidth;
  afterEach(() => {
    window.innerWidth = width;
  });

  it('120 entries: their dates come in three batches of 50 paths and no file history is read', async () => {
    window.innerWidth = 375;
    const fake = createAdminFakeGitHub({ files: withPosts(119) });
    renderGitHub(fake);
    const first = await screen.findByRole('button', { name: /^Post 1(?!\d)/ });
    await waitFor(() => expect(first.textContent).toMatch(/ · /));
    expect(calls(fake, 'LastCommits')).toHaveLength(3);
    expect(calls(fake, 'History')).toHaveLength(0);
  });

  it('Newest first follows the dates of the last commits', async () => {
    window.innerWidth = 375;
    const fake = createAdminFakeGitHub({ files: siteFiles(), history: HISTORY });
    renderGitHub(fake);
    await screen.findByRole('button', { name: /^Alpha/ });
    await waitFor(() => expect(titles()).toEqual(['Alpha', 'Beta', 'Hello world']));
    expect(within(list()).getAllByRole('button')[0]!.textContent).toMatch(/^AlphaPublished · .* · Ann L$/);
    expect(calls(fake, 'History')).toHaveLength(0);
  });

  it('an entry with no commit has no date and sorts last', async () => {
    window.innerWidth = 375;
    const fake = createAdminFakeGitHub({ files: siteFiles(), history: HISTORY });
    withoutLastCommit(fake, 'cms/content/post/alpha.md');
    renderGitHub(fake);
    await screen.findByRole('button', { name: /^Beta/ });
    await waitFor(() => expect(titles()).toEqual(['Beta', 'Hello world', 'Alpha']));
    const alpha = within(list()).getByRole('button', { name: /^Alpha/ });
    expect(alpha.textContent).toBe('AlphaPublished');
  });
});

describe('Collection in dev mode: the dates come from one batch', () => {
  it('asks /__editlet/history once for every entry of the collection, and never per file', async () => {
    window.innerWidth = 375;
    const asked: { method: string; paths: string[] }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      if (!url.pathname.endsWith('/history')) return new Response('{}', { status: 404 });
      const paths = init?.method === 'POST' ? askedPaths(init) : [url.searchParams.get('path')!];
      asked.push({ method: init?.method ?? 'GET', paths });
      return historiesResponse(paths, () => ({
        actor: { name: 'Bob Stone' },
        date: '2025-10-02T09:00:00Z',
        message: 'm',
      }));
    });
    renderApp({ source: sourceWithDevHistory(withPosts(29)), route: 'post' });
    const first = await screen.findByRole('button', { name: /^Post 1(?!\d)/ });
    await waitFor(() => expect(first.textContent).toBe('Post 1Published · Oct 2, 2025 · Bob S'));
    expect(asked).toHaveLength(1);
    expect(asked[0]!.method).toBe('POST');
    expect(new Set(asked[0]!.paths)).toEqual(
      new Set([
        'cms/content/post/hello-world.md',
        ...Array.from({ length: 29 }, (_, i) => `cms/content/post/post-${String(i + 1).padStart(3, '0')}.md`),
      ]),
    );
  });
});
