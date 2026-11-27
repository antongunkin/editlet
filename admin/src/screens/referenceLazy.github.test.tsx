import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitBlobSha } from '../../../core/sha';
import { openGitHubCache, type GitHubCache } from '../../../github/cache';
import type { GitHubSourceOptions } from '../../../github/source';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, siteFetch } from '../test/liveApp';
import { createTestQueryClient, openField, sheet } from '../test/render';

// A reference picker over 200 entries or more reads the summaries of the options it shows, and every one once someone
// types: the whole entry form over a GitHub source (a fake GitHub behind it) with a real IndexedDB cache
// (docs/admin/entry-form.md). The setup is the lazy collection list's (collectionLazy.github.test.tsx).

const disk = vi.hoisted(() => ({ indexedDB: undefined as IDBFactory | undefined, opened: [] as GitHubCache[] }));

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

/** Under a full run (coverage, a busy machine) hundreds of entries take longer than `waitFor`'s default. */
const LOAD_MS = 30_000;

const ref = (label: string, collections: string[], multiple = false) => ({
  type: 'reference',
  label,
  collections,
  ...(multiple ? { multiple } : {}),
});
const named = (label: string) => ({
  label,
  titleField: 'title',
  fields: { title: { type: 'string', label: 'Title' } },
});

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: named('Post'),
    author: named('Author'),
    page: {
      label: 'Page',
      titleField: 'title',
      fields: {
        title: { type: 'string', label: 'Title' },
        posts: ref('Posts', ['post'], true),
        lead: ref('Lead', ['post']),
        writer: ref('Writer', ['author']),
        any: ref('Anything', ['author', 'post']),
      },
    },
  },
});

const id = (i: number) => String(i).padStart(4, '0');
const slugOf = (i: number) => `post-${id(i)}`;
/** Titles run against the addresses (post-0000 is the last title), so an order by title is told from one by address. */
const titleOf = (i: number, count: number) => `Title ${id(count - 1 - i)}`;
const entry = (title: string, ...lines: string[]) => `---\n${[`title: ${title}`, ...lines].join('\n')}\n---\n`;

/**
 * A site with `count` posts (`titles` renames or adds some, by slug), two authors whose titles run against their
 * addresses, and a page whose *Lead* is one post. `blobs` are the post files fetched from GitHub.
 */
async function site(count: number, titles: Record<string, string> = {}) {
  const files: Record<string, string> = {
    'cms/schema.json': SCHEMA,
    'cms/content/page/home.md': entry('Home', `lead: post/${slugOf(120)}`),
    'cms/content/author/ann.md': entry('Zed Ann'),
    'cms/content/author/bob.md': entry('Amy Bob'),
  };
  const posts: Record<string, string> = {};
  for (let i = 0; i < count; i++) posts[slugOf(i)] = titleOf(i, count);
  for (const [slug, title] of Object.entries({ ...posts, ...titles })) {
    files[`cms/content/post/${slug}.md`] = entry(title);
  }
  const fake = createAdminFakeGitHub({ files });
  const postShas = new Set(
    await Promise.all(
      Object.entries(files)
        .filter(([path]) => path.startsWith('cms/content/post/'))
        .map(([, text]) => gitBlobSha(text)),
    ),
  );
  const blobs: string[] = [];
  const answer = fake.graphqlOps.Blobs!;
  fake.graphqlOps.Blobs = (variables, query) => {
    for (const [, sha] of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) if (postShas.has(sha!)) blobs.push(sha!);
    return answer(variables, query);
  };
  /** While closed, no blob is answered. */
  let gate = Promise.resolve();
  const hold = () => {
    let open!: () => void;
    gate = new Promise<void>((resolve) => (open = resolve));
    return () => act(async () => open());
  };
  const gated: AdminFakeGitHub = {
    ...fake,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body === 'string' && init.body.includes('query Blobs')) await gate;
      return fake.fetch(input, init);
    }) as typeof fetch,
  };
  return { fake: gated, blobs, hold };
}

/** The admin on the page's entry, once its *Lead* row has the chosen post's title. */
async function openPage(fake: AdminFakeGitHub, count: number) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'page/home'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  const client = createTestQueryClient();
  const view = render(<App fetch={siteFetch(LIVE_CONFIG, fake)} storage={window.localStorage} queryClient={client} />);
  await screen.findByRole('button', { name: new RegExp(`^Lead.*${titleOf(120, count)}`) }, { timeout: LOAD_MS });
  return async () => {
    view.unmount();
    client.clear();
    await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  };
}

type Picker = Awaited<ReturnType<typeof sheet>>;

/** *Add posts*, over the *Posts* modal. */
async function addPosts() {
  const posts = await openField('Posts');
  fireEvent.click(posts.getByRole('button', { name: 'Add posts' }));
  return sheet('Add posts');
}

const options = (picker: Picker, role: 'checkbox' | 'radio' = 'checkbox') => picker.queryAllByRole(role);
const firstLine = (option: HTMLElement) => option.querySelector('span > span')?.textContent ?? '';
const shownTitles = (picker: Picker, role?: 'checkbox' | 'radio') => options(picker, role).map(firstLine);
const busy = (picker: Picker) => options(picker).filter((o) => o.getAttribute('aria-busy') === 'true');
const loadingLine = (picker: Picker) => picker.queryByText(/^Loading titles:/)?.textContent;
const type = (picker: Picker, value: string) => fireEvent.change(picker.getByRole('searchbox'), { target: { value } });

/** `n` checkboxes, none still loading. */
const loaded = (picker: Picker, n = 20) =>
  waitFor(
    () => {
      expect(options(picker)).toHaveLength(n);
      expect(busy(picker)).toEqual([]);
    },
    { timeout: LOAD_MS },
  );

const range = (n: number, count: number) => Array.from({ length: n }, (_, i) => titleOf(i, count));

afterEach(async () => {
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('a reference picker over 200 entries or more in GitHub mode', () => {
  it('reads the 20 options it shows, by address, and 20 more on Show 20 more', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, blobs, hold } = await site(250);
    const close = await openPage(fake, 250);
    // The form reads the chosen post only.
    expect(blobs).toHaveLength(1);

    const release = hold();
    const add = await addPosts();
    // Under their addresses until their titles are there; no loading line, as nothing asked for every title.
    expect(busy(add)).toHaveLength(20);
    expect(options(add)[0]!.textContent).toBe('post-0000Loading…');
    const before = options(add);
    expect(loadingLine(add)).toBeUndefined();
    // An option can be picked before its title is there.
    fireEvent.click(before[1]!);
    expect(before[1]!.getAttribute('aria-checked')).toBe('true');
    expect(add.getByRole('button', { name: 'Add 1 entry' })).toBeDefined();
    await release();
    await loaded(add);
    expect(options(add)).toEqual(before);
    expect(before[1]!.getAttribute('aria-checked')).toBe('true');
    expect(shownTitles(add)).toEqual(range(20, 250));
    expect(options(add)[0]!.textContent).toContain('post/post-0000');
    expect(blobs).toHaveLength(21);

    fireEvent.click(add.getByRole('button', { name: 'Show 20 more' }));
    await loaded(add, 40);
    expect(shownTitles(add)).toEqual(range(40, 250));
    expect(blobs).toHaveLength(41);
    expect(new Set(blobs).size).toBe(41);
    await close();
  }, 60_000);

  it('reads every title at the first character typed, and a title match joins in its place', async () => {
    disk.indexedDB = new IDBFactory();
    // Two entries the word matches by address, one past the first page it matches by title only, between them by slug.
    const { fake, blobs, hold } = await site(250, {
      'a-zebra': 'First',
      'post-0100': 'A zebra crossing',
      'z-zebra': 'Last',
    });
    const close = await openPage(fake, 250);
    const add = await addPosts();
    await loaded(add);
    const first = () => options(add)[0]!;

    const release = hold();
    type(add, 'zebra');
    // The addresses match at once.
    expect(shownTitles(add)).toEqual(['First', 'z-zebra']);
    expect(loadingLine(add)).toMatch(/^Loading titles: \d+ of 252\.$/);
    // The line stands between the search field and the options.
    const line = add.getByText(/^Loading titles:/);
    const after = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(add.getByRole('searchbox'), line)).toBe(true);
    expect(after(line, first())).toBe(true);
    expect(add.getByText('Loading titles…').getAttribute('aria-live')).toBe('polite');
    // A word only a title has: a loading row, not *No entries to add*, until the titles are there.
    type(add, 'crossing');
    expect(options(add)).toEqual([]);
    expect(add.getByText('Loading…')).toBeDefined();
    expect(add.queryByText('No entries to add')).toBeNull();
    // Clearing the search does not take the ask back.
    type(add, '');
    expect(loadingLine(add)).toBeDefined();
    type(add, 'zebra');
    const [head, last] = options(add);

    await release();
    await waitFor(() => expect(loadingLine(add)).toBeUndefined(), { timeout: LOAD_MS });
    expect(blobs).toHaveLength(252);
    expect(new Set(blobs).size).toBe(252);
    expect(shownTitles(add)).toEqual(['First', 'A zebra crossing', 'Last']);
    // The rows that showed before the match: the same nodes, in the same order around it.
    expect(options(add)).toHaveLength(3);
    expect(options(add)[0]).toBe(head);
    expect(options(add)[2]).toBe(last);
    expect(add.queryByText('Loading titles…')).toBeNull();
    type(add, 'no such entry');
    expect(add.getByText('No entries to add')).toBeDefined();
    await close();
  }, 60_000);

  it('keeps the order by collection then address, and a small picker of the same form reads by title', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, blobs } = await site(250);
    const close = await openPage(fake, 250);

    const lead = await openField('Lead');
    await waitFor(() => expect(shownTitles(lead, 'radio')).toEqual([titleOf(120, 250), ...range(19, 250)]), {
      timeout: LOAD_MS,
    });
    // The chosen post and the first 19 by address.
    expect(blobs).toHaveLength(20);
    fireEvent.click(lead.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Two authors, under the threshold, though the form now holds 250 posts: sorted by title, none under its address.
    const writer = await openField('Writer');
    await waitFor(() => expect(shownTitles(writer, 'radio')).toEqual(['Amy Bob', 'Zed Ann']), { timeout: LOAD_MS });
    fireEvent.click(writer.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Authors and posts together: the field's order of collections, then the addresses.
    const any = await openField('Anything');
    await waitFor(
      () =>
        expect(shownTitles(any, 'radio').slice(0, 4)).toEqual(['Zed Ann', 'Amy Bob', titleOf(0, 250), titleOf(1, 250)]),
      { timeout: LOAD_MS },
    );
    expect(blobs).toHaveLength(20);
    await close();
  }, 60_000);
});

describe('a reference picker under 200 entries in GitHub mode', () => {
  it('reads every entry as it opens and sorts by title', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, blobs } = await site(150);
    const close = await openPage(fake, 150);

    const add = await addPosts();
    await waitFor(() => expect(shownTitles(add)).toEqual(Array.from({ length: 20 }, (_, i) => `Title ${id(i)}`)), {
      timeout: LOAD_MS,
    });
    await waitFor(() => expect(blobs).toHaveLength(150), { timeout: LOAD_MS });
    expect(new Set(blobs).size).toBe(150);
    expect(busy(add)).toEqual([]);
    type(add, 'title 0149');
    expect(shownTitles(add)).toEqual(['Title 0149']);
    expect(loadingLine(add)).toBeUndefined();
    await close();
  }, 60_000);
});
