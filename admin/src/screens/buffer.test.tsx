// The entry form on the changes buffer (changes across entries, T5): edits are kept in IndexedDB-backed rows, restored
// when the entry opens again, and leaving asks nothing while the store persists.
import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { openGitHubCache, type GitHubCache } from '../../../github';
import { CHANGES_CHANNEL, localScope, setLocalChangesCache, type ChangesMessage } from '../changes/store';
import { pendingNewEntries } from '../entry/pending';
import { createTestQueryClient, fixtureFiles, moreActions, renderApp, saveReview, setField } from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';
// Without the dev server (`GET /__editlet/git` fails in a test) the scope is the default project, no branch.
const SCOPE = localScope('default', null);

afterEach(() => {
  vi.restoreAllMocks();
  pendingNewEntries.clear();
  window.history.replaceState(null, '', '/');
});

/** A persistent (fake IndexedDB) buffer for one app run: pass its `client` to `renderApp`. */
function persistentBuffer(): { client: QueryClient; cache: GitHubCache } {
  const client = createTestQueryClient();
  const cache = openGitHubCache({ indexedDB: new IDBFactory(), IDBKeyRange });
  setLocalChangesCache(client, cache);
  return { client, cache };
}

const rows = (cache: GitHubCache) => cache.pending(SCOPE).list();
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 400))));

async function openPost(client: QueryClient, source = createMemorySource(fixtureFiles()), route = 'post/hello-world') {
  const utils = renderApp({ route, source, queryClient: client });
  await screen.findByRole('button', { name: /^Title/ }, { timeout: 8000 });
  return { ...utils, source };
}

const titleRow = () => screen.getByRole('button', { name: /^Title/ }).textContent ?? '';

describe('the entry form on the buffer', () => {
  it('writes its row 300 ms after the last change, with the base it was opened on', async () => {
    const { client, cache } = persistentBuffer();
    await openPost(client);
    await setField('Title', 'Kept title');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    const [row] = await rows(cache);
    expect(row!.path).toBe(ENTRY);
    expect(row!.content).toContain('Kept title');
    expect(row!.base).toContain('title: ');
    expect(row!.base).not.toContain('Kept title');
    expect(row!.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('leaving asks nothing, and the edit is back when the entry opens again (after a reload too)', async () => {
    const { client, cache } = persistentBuffer();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const first = await openPost(client);
    await setField('Title', 'Kept title');
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: /^Posts?$/ });
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));

    // Reopen from the list.
    fireEvent.click(await screen.findByRole('button', { name: /Kept title/ }));
    await screen.findByRole('button', { name: /^Title/ });
    expect(titleRow()).toContain('Kept title');
    expect(screen.getByText('Unsaved')).toBeDefined();

    // A reload: a new app on the same database.
    first.unmount();
    const reloaded = createTestQueryClient();
    setLocalChangesCache(reloaded, cache);
    await openPost(reloaded);
    expect(titleRow()).toContain('Kept title');
    expect(await screen.findByRole('button', { name: 'Save 1 change' })).toBeDefined();
  });

  it('a clean form removes its row: the last change reverted', async () => {
    const { client, cache } = persistentBuffer();
    await openPost(client);
    const original = titleRow()
      .replace(/^Title\s*\*?/, '')
      .trim();
    await setField('Title', 'Another');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    await setField('Title', original);
    await waitFor(async () => expect(await rows(cache)).toEqual([]));
  });

  it('a new entry writes its row on open; an untouched one leaves nothing', async () => {
    const { client, cache } = persistentBuffer();
    renderApp({ route: 'post/brand-new', source: createMemorySource(fixtureFiles()), queryClient: client });
    await screen.findByRole('button', { name: /^Title/ }, { timeout: 8000 });
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    expect((await rows(cache))[0]).toMatchObject({ path: 'cms/content/post/brand-new.md', sha: null, base: null });
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: /^Posts?$/ });
    await waitFor(async () => expect(await rows(cache)).toEqual([]));
  });

  it('a new entry with a typed title survives leaving and is listed first', async () => {
    const { client, cache } = persistentBuffer();
    renderApp({ route: 'post/brand-new', source: createMemorySource(fixtureFiles()), queryClient: client });
    await screen.findByRole('button', { name: /^Title/ }, { timeout: 8000 });
    await setField('Title', 'A fresh post');
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: /^Posts?$/ });
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    expect(await screen.findByRole('button', { name: /A fresh post/ })).toBeDefined();
  });

  it('a row whose file changed on disk opens in the conflict state and compares against its base', async () => {
    const { client, cache } = persistentBuffer();
    const source = createMemorySource(fixtureFiles());
    const first = await openPost(client, source);
    await setField('Title', 'Mine');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    first.unmount();
    // Someone else saved the file meanwhile.
    const text = new TextDecoder().decode(await source.readFile(ENTRY));
    await source.commit(
      [{ path: ENTRY, content: text.replace(/title: .*/, 'title: Theirs'), sha: undefined } as never],
      'Theirs',
    );
    const reloaded = createTestQueryClient();
    setLocalChangesCache(reloaded, cache);
    renderApp({ route: 'post/hello-world', source, queryClient: reloaded });
    expect(await screen.findByRole('button', { name: 'Compare changes' }, { timeout: 8000 })).toBeDefined();
    expect(titleRow()).toContain('Mine');
  });

  it('Delete and Rename stay off while the entry has a row', async () => {
    const { client } = persistentBuffer();
    await openPost(client);
    await setField('Title', 'Dirty');
    const actions = await moreActions();
    for (const name of ['Delete…', 'Rename…', 'Duplicate']) {
      const row = actions.getByRole('button', { name: new RegExp(`^${name}`) }) as HTMLButtonElement;
      expect(row.disabled).toBe(true);
      expect(row.textContent).toContain('Save or discard your changes first');
    }
  });

  it('Reload from the changed-on-disk banner discards the row', async () => {
    const { client, cache } = persistentBuffer();
    const source = createMemorySource(fixtureFiles());
    await openPost(client, source);
    await setField('Title', 'Mine');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    // The file is deleted on disk: today's banner with Reload (nothing to compare).
    await source.commit([{ path: ENTRY, content: null, sha: undefined } as never], 'Gone');
    await act(async () => void (await client.invalidateQueries()));
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }));
    await waitFor(async () => expect(await rows(cache)).toEqual([]));
  });

  it('another tab writing the entry shows Edited in another tab; Reload restarts from its row', async () => {
    const { client, cache } = persistentBuffer();
    await openPost(client);
    await setField('Title', 'Mine');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    // Another tab: writes the row, posts on the channel.
    const [row] = await rows(cache);
    await cache
      .pending(SCOPE)
      .put({ path: ENTRY, sha: row!.sha, base: row!.base, content: String(row!.content).replace('Mine', 'Theirs') });
    const other = new BroadcastChannel(CHANGES_CHANNEL);
    const message: ChangesMessage = { scope: SCOPE, paths: [ENTRY], tab: 'another-tab' };
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel has no target origin
    other.postMessage(message);
    other.close();
    expect(await screen.findByText(/Edited in another tab/)).toBeDefined();
    // This tab no longer writes: another edit here does not reach the row.
    await setField('Title', 'Ignored');
    await settle();
    expect(String((await rows(cache))[0]!.content)).toContain('Theirs');
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(titleRow()).toContain('Theirs'));
    expect(screen.queryByText(/Edited in another tab/)).toBeNull();
  });

  it('the memory store (no IndexedDB) keeps the leave confirm', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderApp({ route: 'post/hello-world', source: createMemorySource(fixtureFiles()) });
    await screen.findByRole('button', { name: /^Title/ }, { timeout: 8000 });
    await setField('Title', 'Dirty');
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(within(screen.getByRole('main')).getByRole('button', { name: /^Title/ })).toBeDefined();
  });

  it('a failed write shows the banner and turns the leave confirm back on', async () => {
    const { client, cache } = persistentBuffer();
    const queue = cache.pending(SCOPE);
    vi.spyOn(cache, 'pending').mockReturnValue({ ...queue, putMany: () => Promise.reject(new Error('quota')) });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openPost(client);
    await setField('Title', 'Dirty');
    expect(await screen.findByText(/could not be kept on this device/)).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(confirm).toHaveBeenCalled();
  });

  it('a save removes the row', async () => {
    const { client, cache } = persistentBuffer();
    await openPost(client);
    await setField('Title', 'Saved title');
    await waitFor(async () => expect(await rows(cache)).toHaveLength(1));
    fireEvent.click(await screen.findByRole('button', { name: 'Save 1 change' }));
    await saveReview();
    await waitFor(async () => expect(await rows(cache)).toEqual([]));
  });
});
