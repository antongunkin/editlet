import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LAZY_THRESHOLD } from './collectionSort';

import { gitBlobSha } from '../../../core/sha';
import { openGitHubCache, type GitHubCache } from '../../../github/cache';
import type { GitHubSourceOptions } from '../../../github/source';
import type { FakeHistoryCommit } from '../../../github/test/fakeGitHub';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, siteFetch } from '../test/liveApp';
import { createTestQueryClient } from '../test/render';

// The list of a large collection reads entry summaries only for the rows on screen: the whole collection screen over a
// GitHub source (a fake GitHub behind it) with a real IndexedDB cache (docs/admin/collection.md).

/** The IndexedDB of the test's browser profile: it stays over a "reload" (a new App, source and QueryClient). */
const disk = vi.hoisted(() => ({ indexedDB: undefined as IDBFactory | undefined, opened: [] as GitHubCache[] }));

// The workspace makes its source without a cache option, and jsdom has no IndexedDB: each source gets its own
// connection to the one fake database.
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
/** Under a full run (coverage, a busy machine) 2,000 entries take longer than `waitFor`'s default. */
const LOAD_MS = 30_000;

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      titleField: 'title',
      fields: { title: { type: 'string', label: 'Title' } },
    },
  },
});

const id = (i: number) => String(i).padStart(4, '0');
const pathOf = (i: number) => `cms/content/post/post-${id(i)}.md`;
/** Titles run against the addresses (post-0000 is *Title 1999*), so an order by title is told from one by address. */
const titleOf = (i: number, count: number) => `Title ${id(count - 1 - i)}`;
/** Every hundredth post is a draft: 20 of 2,000. */
const isDraft = (i: number) => i % 100 === 5;
const post = (i: number, count: number, body = '') =>
  `---\ntitle: ${titleOf(i, count)}\n${isDraft(i) ? 'draft: true\n' : ''}---\n${body}`;

const commitOf = (name: string, date: string, posts: number[], count: number): FakeHistoryCommit => ({
  message: `Edit by ${name}`,
  author: { name, email: 'e@example.test' },
  date,
  files: Object.fromEntries(posts.map((i) => [pathOf(i), post(i, count, `${name}\n`)])),
});

/** The fake with `count` posts, three of them changed after the first commit, and what it was asked. */
async function site(count: number) {
  const files: Record<string, string> = { 'cms/schema.json': SCHEMA };
  for (let i = 0; i < count; i++) files[pathOf(i)] = post(i, count);
  const history = [
    commitOf('Ann Lee', '2026-01-10T08:00:00Z', [77, 123], count),
    commitOf('Bob Stone', '2026-02-20T08:00:00Z', [count - 1], count),
  ];
  const fake = createAdminFakeGitHub({ files, history });
  /** The entry blobs fetched from GitHub (the schema is not an entry). */
  const blobs: string[] = [];
  const schema = await gitBlobSha(SCHEMA);
  const answer = fake.graphqlOps.Blobs!;
  fake.graphqlOps.Blobs = (variables, query) => {
    for (const [, sha] of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) if (sha !== schema) blobs.push(sha!);
    return answer(variables, query);
  };
  /** While closed, entry blobs are not answered. */
  let gate = Promise.resolve();
  const hold = () => {
    let open!: () => void;
    gate = new Promise<void>((resolve) => (open = resolve));
    return open;
  };
  const gated: AdminFakeGitHub = {
    ...fake,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('query Blobs') && !body.includes(schema)) await gate;
      return fake.fetch(input, init);
    }) as typeof fetch,
  };
  const lastCommits = () => fake.calls.filter((c) => c.operation === 'LastCommits').length;
  return { fake: gated, blobs, hold, lastCommits };
}

const main = () => screen.getByRole('main');
const list = () => within(main()).getByRole('list', { name: /entries$/ });
/** The rows of entries (not *Show 20 more*), once the list is there. */
const rows = () =>
  within(list())
    .queryAllByRole('button')
    .filter((b) => !/^Show \d+ more/.test(b.textContent ?? ''));
const titles = () => rows().map((b) => b.querySelector('span > span')?.textContent ?? '');
const busyRows = () => rows().filter((b) => b.getAttribute('aria-busy') === 'true');
const chip = (name: RegExp) =>
  within(within(main()).getByRole('group', { name: 'Show' })).getByRole('button', { name });
const loadingLine = () => within(main()).queryByText(/^Loading titles:/);

/** 20 rows (or `n`), each with its title and when it was changed. */
const loaded = (n = 20) =>
  waitFor(
    () => {
      expect(rows()).toHaveLength(n);
      expect(titles().filter((t) => t.startsWith('Title '))).toHaveLength(n);
      expect(busyRows()).toEqual([]);
    },
    { timeout: LOAD_MS },
  );

async function sortBy(order: string) {
  fireEvent.click(within(main()).getByRole('button', { name: 'Sort' }));
  fireEvent.click(within(await screen.findByRole('dialog', { name: 'Sort' })).getByRole('radio', { name: order }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** One page load of the admin on the `post` list: a new App, source and QueryClient on the same IndexedDB. */
function openList(fake: AdminFakeGitHub) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  const client = createTestQueryClient();
  const view = render(<App fetch={siteFetch(LIVE_CONFIG, fake)} storage={window.localStorage} queryClient={client} />);
  const close = async () => {
    view.unmount();
    client.clear();
    await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  };
  return { client, close };
}

/** The titles *Newest first* shows first: the three changed posts, then the rest by address. */
const newest = (count: number, n: number) =>
  [count - 1, 77, 123, ...Array.from({ length: n }, (_, i) => i)].slice(0, n).map((i) => titleOf(i, count));

const width = window.innerWidth;

afterEach(async () => {
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  window.innerWidth = width;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('the list of a large collection in GitHub mode', () => {
  it('reads the 20 rows on screen, 20 more on Show 20 more, and none after a reload', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, blobs, lastCommits } = await site(COUNT);

    const cold = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    expect(blobs).toHaveLength(20);
    expect(lastCommits()).toBe(COUNT / 50);
    expect(titles()).toEqual(newest(COUNT, 20));
    expect(chip(/^All/).textContent).toBe(`All${COUNT}`);
    expect(chip(/^Drafts/).textContent).toBe('Drafts…');
    expect(loadingLine()).toBeNull();

    fireEvent.click(within(list()).getByRole('button', { name: /^Show 20 more/ }));
    await loaded(40);
    expect(blobs).toHaveLength(40);
    expect(new Set(blobs).size).toBe(40);
    expect(titles()).toEqual(newest(COUNT, 40));
    await cold.close();

    blobs.length = 0;
    const warm = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    expect(blobs).toEqual([]);
    expect(titles()).toEqual(newest(COUNT, 20));
    await warm.close();
  }, 120_000);

  it('Title A–Z reads every entry under the loading line; Newest first then reads nothing', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, blobs, hold } = await site(COUNT);

    const page = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    const open = hold();
    await sortBy('Title A–Z');
    await waitFor(() => expect(loadingLine()?.textContent).toBe('Loading titles: 20 of 2,000.'));
    open();
    await waitFor(() => expect(loadingLine()).toBeNull(), { timeout: LOAD_MS });
    await loaded();
    expect(blobs).toHaveLength(COUNT);
    expect(titles()).toEqual(Array.from({ length: 20 }, (_, i) => `Title ${id(i)}`));
    expect(chip(/^Drafts/).textContent).toBe('Drafts20');

    await sortBy('Newest first');
    await loaded();
    expect(titles()).toEqual(newest(COUNT, 20));
    expect(chip(/^Drafts/).textContent).toBe('Drafts20');
    expect(loadingLine()).toBeNull();
    expect(blobs).toHaveLength(COUNT);

    // The screen opened again: the session holds every summary, so the count is there without asking.
    fireEvent.click(within(main()).getByRole('link', { name: 'Back' }));
    fireEvent.click(await within(main()).findByRole('link', { name: /^Posts?\s*[\d,]+ entries/ }));
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    expect(chip(/^Drafts/).textContent).toBe('Drafts20');
    expect(blobs).toHaveLength(COUNT);
    await page.close();
  }, 120_000);

  it('the Drafts chip counts … until it is picked, then reads every entry', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, blobs, hold } = await site(COUNT);

    const page = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    expect(chip(/^Drafts/).textContent).toBe('Drafts…');
    const open = hold();
    fireEvent.click(chip(/^Drafts/));
    // Placeholder rows, not the empty text, while it reads.
    await waitFor(() => expect(loadingLine()).not.toBeNull());
    expect(list().getAttribute('aria-busy')).toBe('true');
    expect(chip(/^Drafts/).textContent).toBe('Drafts…');
    // A screen reader hears that titles are loading, once.
    expect(within(main()).getByText('Loading titles…').getAttribute('aria-live')).toBe('polite');
    open();
    await waitFor(() => expect(chip(/^Drafts/).textContent).toBe('Drafts20'), { timeout: LOAD_MS });
    await loaded();
    expect(blobs).toHaveLength(COUNT);
    expect(loadingLine()).toBeNull();
    expect(rows().every((row) => row.textContent?.includes('Draft'))).toBe(true);
    await page.close();
  }, 120_000);

  it('shows a row under its address until its title is there, and a late title moves no row', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, hold } = await site(LAZY_THRESHOLD);
    const open = hold();

    const page = openList(fake);
    await waitFor(() => expect(busyRows()).toHaveLength(20), { timeout: LOAD_MS });
    const before = rows();
    const slugs = titles();
    expect(slugs.slice(0, 4)).toEqual(['post-0199', 'post-0077', 'post-0123', 'post-0000']);
    expect(before[0]!.textContent).toBe('post-0199Loading…');
    open();
    await loaded();
    // The same rows (the same nodes) in the same places, now under their titles.
    expect(rows()).toEqual(before);
    expect(titles()).toEqual(slugs.map((slug) => titleOf(Number(slug.slice(5)), LAZY_THRESHOLD)));
    expect(before[0]!.textContent).toMatch(/^Title 0000Published · .* · Bob S$/);
    // A row opens its entry before its title is there too: it is a button throughout.
    expect(before.every((row) => row.tagName === 'BUTTON')).toBe(true);
    await page.close();
  }, 60_000);

  it('under the threshold reads every entry at once and counts the drafts', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, blobs } = await site(150);

    const page = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await loaded();
    expect(blobs).toHaveLength(150);
    expect(chip(/^Drafts/).textContent).toBe('Drafts2');
    expect(chip(/^All/).textContent).toBe('All150');
    expect(loadingLine()).toBeNull();
    await page.close();
  }, 60_000);

  it('the Changed chip reads only the rows it shows', async () => {
    window.innerWidth = 375;
    disk.indexedDB = new IDBFactory();
    const { fake, blobs } = await site(LAZY_THRESHOLD);
    fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
    fake.commit('editlet/a', { [pathOf(150)]: post(150, LAZY_THRESHOLD, 'On A\n') }, 'Edit on A');
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');

    const page = openList(fake);
    await screen.findByRole('list', { name: /entries$/ }, { timeout: LOAD_MS });
    await waitFor(() => expect(chip(/^Changed/).textContent).toBe('Changed1'), { timeout: LOAD_MS });
    await loaded();
    const before = blobs.length;
    fireEvent.click(chip(/^Changed/));
    await loaded(1);
    expect(titles()).toEqual([titleOf(150, LAZY_THRESHOLD)]);
    // The changed post is the newest, so it was on the first screen: nothing more to read.
    expect(blobs).toHaveLength(before);
    // 20 rows (the changed post is one), and the base version of the changed file, which the branch's diff reads.
    expect(blobs).toHaveLength(22);
    expect(chip(/^Drafts/).textContent).toBe('Drafts…');
    await page.close();
  }, 60_000);
});
