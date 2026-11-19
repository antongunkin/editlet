// *Your changes* across entries (changes-across-entries T6): the tray over the buffer, Home's row, the status chip.
import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { localScope, setLocalChangesCache } from './store';

import { createMemorySource } from '../../../core/source';
import { openGitHubCache, type GitHubCache } from '../../../github';
import { pendingNewEntries } from '../entry/pending';
import type { SourceChange } from '../source/local';
import {
  createTestQueryClient,
  fixtureFiles,
  openEntryDiff,
  renderApp,
  reviewSheet,
  saveReview,
  sheet,
} from '../test/render';

const POST = 'cms/content/post/hello-world.md';
const AUTHOR = 'cms/content/author/jane.md';
const IMAGE = 'cms/content/post/hello-world/new.png';
const SCOPE = localScope('default', null);
/** Home's *Unsaved* row (not the status line's *Unsaved changes (n)*). */
const UNSAVED_ROW = /^Unsaved(?! changes)/;

afterEach(() => {
  vi.restoreAllMocks();
  pendingNewEntries.clear();
  window.history.replaceState(null, '', '/');
});

function setup() {
  const client: QueryClient = createTestQueryClient();
  const cache: GitHubCache = openGitHubCache({ indexedDB: new IDBFactory(), IDBKeyRange });
  setLocalChangesCache(client, cache);
  const source = createMemorySource(fixtureFiles());
  const commit = vi.spyOn(source, 'commit');
  return { client, cache, source, commit };
}

/** Buffers an edit of the saved file at `path`, as a form that left it would have (`edit` maps its text). */
async function buffer(
  cache: GitHubCache,
  source: ReturnType<typeof createMemorySource>,
  path: string,
  edit: (text: string) => string,
  sha?: string,
) {
  const text = new TextDecoder().decode(await source.readFile(path));
  const listed = (await source.listFiles()).find((f) => f.path === path)!.sha;
  await cache.pending(SCOPE).put({ path, content: edit(text), sha: sha ?? listed, base: text, v: 1 });
}

const editPost = (t: string) => t.replace('title: Hello world', 'title: Hello again');
const editAuthor = (t: string) => t.replace('name: Jane', 'name: Jane Doe');

const rowsOf = (cache: GitHubCache) => cache.pending(SCOPE).list();

async function openFromHome(client: QueryClient, source: ReturnType<typeof createMemorySource>) {
  renderApp({ source, queryClient: client });
  fireEvent.click(await screen.findByRole('button', { name: UNSAVED_ROW }, { timeout: 8000 }));
  return reviewSheet();
}

describe('Home and the status line', () => {
  it('Home lists Unsaved with the field count and a Review & save CTA; the status line counts every entry', async () => {
    const { client, cache, source } = setup();
    await buffer(cache, source, POST, editPost);
    await buffer(cache, source, AUTHOR, editAuthor);
    renderApp({ source, queryClient: client });
    const row = await screen.findByRole('button', { name: UNSAVED_ROW }, { timeout: 8000 });
    expect(row.textContent).toContain('2 entries, not saved yet');
    expect(row.textContent).toContain('2');
    expect(screen.getByRole('button', { name: 'Review & save' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Unsaved changes (2)' })).toBeDefined();
  });

  it('Home shows no Unsaved row without changes', async () => {
    const { client, source } = setup();
    renderApp({ source, queryClient: client });
    await screen.findByRole('link', { name: /^All content/ }, { timeout: 8000 });
    expect(screen.queryByRole('button', { name: UNSAVED_ROW })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review & save' })).toBeNull();
  });
});

describe('Your changes across entries', () => {
  it('lists every buffered entry and saves them as one commit; the rows leave the buffer', async () => {
    const { client, cache, source, commit } = setup();
    await buffer(cache, source, POST, editPost);
    await buffer(cache, source, AUTHOR, editAuthor);
    const review = await openFromHome(client, source);
    expect(review.getByRole('heading', { name: '2 entries, 2 fields' })).toBeDefined();
    const list = within(review.getByRole('list', { name: 'Changed entries' }));
    expect(list.getAllByRole('listitem')).toHaveLength(2);

    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const [changes, message] = commit.mock.calls[0] as [SourceChange[], string];
    expect(changes.map((c) => c.path).toSorted()).toEqual([AUTHOR, POST]);
    expect(String(changes.find((c) => c.path === POST)!.content)).toContain('title: Hello again');
    expect(String(changes.find((c) => c.path === AUTHOR)!.content)).toContain('name: Jane Doe');
    expect(message).toContain('+1');
    await waitFor(async () => expect(await rowsOf(cache)).toEqual([]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
    expect(new TextDecoder().decode(await source.readFile(AUTHOR))).toContain('Jane Doe');
  });

  it('commits an image only when an entry references it', async () => {
    const { client, cache, source, commit } = setup();
    const png = new Uint8Array([1, 2, 3]);
    const withImage = (t: string) =>
      t.replace('src: hello-world/cover.webp', 'src: hello-world/new.png').replace('title: Hello world', 'title: Pic');
    await buffer(cache, source, POST, withImage);
    await cache.pending(SCOPE).putMany([
      { path: IMAGE, content: png, sha: null },
      { path: 'cms/content/post/hello-world/unused.png', content: png, sha: null },
    ]);
    const review = await openFromHome(client, source);
    expect(review.getByText(`New file · ${IMAGE}`)).toBeDefined();
    expect(review.queryByText(/unused\.png/)).toBeNull();
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const [changes] = commit.mock.calls[0] as [SourceChange[], string];
    expect(changes.map((c) => c.path).toSorted()).toEqual([POST, IMAGE]);
    // The referenced image left the buffer with its entry; the unreferenced one was pruned.
    await waitFor(async () => expect(await rowsOf(cache)).toEqual([]));
  });

  it('a file changed since: Changed elsewhere, the CTA Resolves and opens that entry', async () => {
    const { client, cache, source, commit } = setup();
    await buffer(cache, source, POST, editPost, 'a'.repeat(40));
    await buffer(cache, source, AUTHOR, editAuthor);
    const review = await openFromHome(client, source);
    expect(review.getByText('Changed elsewhere')).toBeDefined();
    const cta = review.getByRole('button', { name: 'Resolve 1 conflict' });
    fireEvent.click(cta);
    expect(commit).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: /^Title/ });
    expect(new URLSearchParams(window.location.search).get('editlet')).toBe('post/hello-world');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
  });

  it('an entry that is not valid: 1 problem, the CTA is Fix 1 entry', async () => {
    const { client, cache, source } = setup();
    await buffer(cache, source, POST, (t) => t.replace('title: Hello world', 'title: ""'));
    const review = await openFromHome(client, source);
    expect(review.getByText('1 problem')).toBeDefined();
    expect(review.getByRole('button', { name: 'Fix 1 entry' })).toBeDefined();
  });

  it('a new entry alone keeps the CTA Save', async () => {
    const { client, cache, source } = setup();
    await cache.pending(SCOPE).put({
      path: 'cms/content/author/dana.md',
      content: '---\nname: Dana\n---\n',
      sha: null,
      base: null,
      v: 1,
    });
    const review = await openFromHome(client, source);
    expect(within(review.getByRole('list', { name: 'Changed entries' })).getAllByRole('listitem')).toHaveLength(1);
    expect(review.getByRole('button', { name: 'Save' })).toBeDefined();
  });

  it('Discard changes to this entry drops one row; the other stays', async () => {
    const { client, cache, source } = setup();
    await buffer(cache, source, POST, editPost);
    await buffer(cache, source, AUTHOR, editAuthor);
    await openFromHome(client, source);
    // (jsdom has no 600 px window: the diff opens one level down, with the two buttons under it.)
    const diff = await openEntryDiff('Jane Doe');
    fireEvent.click(diff.getByRole('button', { name: 'Discard changes to this entry' }));
    await waitFor(async () => expect(await rowsOf(cache)).toHaveLength(1));
  });

  it('Discard all asks, then clears the buffer and closes the tray', async () => {
    const { client, cache, source } = setup();
    await buffer(cache, source, POST, editPost);
    await buffer(cache, source, AUTHOR, editAuthor);
    const review = await openFromHome(client, source);
    fireEvent.click(review.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard all changes' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Discard changes to 2 entries?')).toBeDefined();
    expect(within(confirm).getByText('They cannot be brought back.')).toBeDefined();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }));
    await waitFor(async () => expect(await rowsOf(cache)).toEqual([]));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
  });

  it('Revert this change on an entry that is not open rewrites its row; the last one removes it', async () => {
    const { client, cache, source } = setup();
    await buffer(cache, source, AUTHOR, editAuthor);
    await openFromHome(client, source);
    const diff = await openEntryDiff('Jane Doe');
    fireEvent.click(diff.getByRole('button', { name: 'Revert this change: Name' }));
    await waitFor(async () => expect(await rowsOf(cache)).toEqual([]));
  });

  it('a save the source refuses keeps every row', async () => {
    const { client, cache, source, commit } = setup();
    commit.mockResolvedValueOnce({ issues: [{ path: '', file: POST, message: 'File changed since it was read' }] });
    await buffer(cache, source, POST, editPost);
    await buffer(cache, source, AUTHOR, editAuthor);
    await openFromHome(client, source);
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Not saved')).toBeDefined();
    expect(await rowsOf(cache)).toHaveLength(2);
  });

  it('the open entry saves with the others: one commit, its form clean', async () => {
    const { client, cache, source, commit } = setup();
    await buffer(cache, source, AUTHOR, editAuthor);
    renderApp({ source, queryClient: client, route: 'post/hello-world' });
    const row = await screen.findByRole('button', { name: /^Title/ }, { timeout: 8000 });
    fireEvent.click(row);
    const modal = await sheet('Title');
    fireEvent.change(modal.getByLabelText(/^Title/), { target: { value: 'Hello again' } });
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Title' })).getByRole('button', { name: 'Done' }));
    // The CTA counts the other entry's field too.
    fireEvent.click(await screen.findByRole('button', { name: 'Save 2 changes' }));
    const review = await reviewSheet();
    expect(review.getByRole('heading', { name: '2 entries, 2 fields' })).toBeDefined();
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const [changes] = commit.mock.calls[0] as [SourceChange[], string];
    expect(changes.map((c) => c.path).toSorted()).toEqual([AUTHOR, POST]);
    await waitFor(async () => expect(await rowsOf(cache)).toEqual([]));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull());
  });
});
