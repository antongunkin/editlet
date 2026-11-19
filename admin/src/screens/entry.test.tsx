import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute } from '../../../loader/protocol';
import { pendingNewEntries } from '../entry/pending';
import type { SourceChange } from '../source/local';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import {
  closeSheet,
  cta,
  doneField,
  entryBar,
  entryScreen,
  findCta,
  fixtureFiles,
  moreAction,
  moreActions,
  openEntryDiff,
  openField,
  renderApp,
  reviewCta,
  reviewSheet,
  rowText,
  saveReview,
  setField,
  sheet,
} from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';

const main = () => screen.getByRole('main');
/** The big title's status badge. */
const titleBadge = () =>
  within(main()).getByRole('heading', { level: 1 }).parentElement!.querySelector('[data-slot="badge"]');
const editletRoute = () => readEditletRoute(window.location.href);
const setTitle = (value: string) => setField('Title', value);

async function openEntry(opts: Parameters<typeof renderApp>[0] = {}) {
  const source = opts.source ?? createMemorySource(opts.files ?? fixtureFiles());
  const commit = vi.spyOn(source, 'commit');
  const utils = renderApp({ route: 'post/hello-world', ...opts, source });
  await screen.findByRole('button', { name: /^Title/ });
  return { ...utils, source, commit };
}

const discard = (actions: Awaited<ReturnType<typeof moreActions>>) =>
  actions.getByRole('button', { name: 'Discard changes' }) as HTMLButtonElement;

/** Closes the ⋯ action sheet with Cancel. */
async function cancelActions() {
  const popup = document.querySelector<HTMLElement>('[data-slot="action-sheet"]')!;
  fireEvent.click(within(popup).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.querySelector('[data-slot="action-sheet"]')).toBeNull());
}

async function listedSha(source: { listFiles(): Promise<{ path: string; sha: string }[]> }, path: string) {
  return (await source.listFiles()).find((f) => f.path === path)!.sha;
}

function commitArgs(commit: ReturnType<typeof vi.spyOn>, call = 0) {
  const [changes, message] = commit.mock.calls[call] as [SourceChange[], string];
  return { changes, message };
}

function embedded(route: string) {
  const fake = createFakeWindow();
  const init = () => act(() => fake.fromSite({ type: 'init', route, site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
  const sent = () => fake.parent.postMessage.mock.calls.map(([m]) => m as { type: string; [k: string]: unknown });
  return { fake, init, sent };
}

afterEach(() => {
  vi.restoreAllMocks();
  pendingNewEntries.clear();
  window.history.replaceState(null, '', '/');
});

describe('Entry meta', () => {
  it('shows the last change under the title and the file and its git history in Details', async () => {
    const history = {
      updated: { actor: { name: 'Ann' }, date: '2025-11-19T14:48:00Z', message: 'second' },
      created: { actor: { name: 'Bob' }, date: '2025-10-02T09:00:00Z', message: 'init' },
      commits: 2,
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) =>
        new Response(String(input).includes('/history') ? JSON.stringify(history) : '{}', {
          status: String(input).includes('/history') ? 200 : 404,
        }),
    );
    await openEntry();
    // The last change under the title; the rest in ⋯ → Details.
    await waitFor(() =>
      expect(within(entryScreen()).getByRole('heading', { level: 1 }).parentElement!.textContent).toMatch(
        /Updated .* by Ann/,
      ),
    );
    await moreAction('Details');
    const details = await sheet('Details');
    expect(details.getByText(ENTRY)).toBeDefined();
    expect(details.getByText('Ann')).toBeDefined();
    expect(details.getByText('Bob')).toBeDefined();
    expect(details.getByText('2')).toBeDefined();
  });
});

describe('Entry', () => {
  it('opens post/hello-world with its title and no Save', async () => {
    await openEntry();
    expect(rowText('Title')).toContain('Hello world');
    expect(cta()).toBeNull();
  });

  it('shows unsaved changes in the status line as a link that opens the review', async () => {
    const { fake, init } = embedded('post/hello-world');
    await openEntry({ win: fake.win });
    init();
    expect(entryBar().queryByRole('button', { name: 'Unsaved changes (1)' })).toBeNull();
    expect(entryBar().queryByText('Published')).toBeNull();
    await setTitle('Hello there');
    fireEvent.click(await entryBar().findByRole('button', { name: 'Unsaved changes (1)' }));
    expect(await screen.findByRole('dialog', { name: 'Your changes' })).toBeDefined();
  });

  it('the title badge: the file status of a clean form (Changed), Unsaved while edited', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).endsWith('/git')) return new Response('{}', { status: 404 });
      const files = [{ path: ENTRY, status: 'modified' }];
      return new Response(JSON.stringify({ branch: 'main', changes: 1, files, project: 'p' }));
    });
    await openEntry();
    await waitFor(() => expect(titleBadge()?.textContent).toBe('Changed'));
    await setTitle('Hello there');
    await waitFor(() => expect(titleBadge()?.textContent).toBe('Unsaved'));
    vi.restoreAllMocks();
  });

  it('Discard restores the saved values after confirmation', async () => {
    await openEntry();
    expect(discard(await moreActions()).disabled).toBe(true);
    await cancelActions();
    await setTitle('Hello there');
    const actions = await moreActions();
    expect(discard(actions).disabled).toBe(false);
    fireEvent.click(discard(actions));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Discard unsaved changes?' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(rowText('Title')).toContain('Hello world'));
    expect(cta()).toBeNull();
  });

  it('edits the title, reviews the diff and commits the update, then sends refresh', async () => {
    const { fake, init, sent } = embedded('post/hello-world');
    const { commit, source } = await openEntry({ win: fake.win });
    init();
    const sha = await listedSha(source, ENTRY);

    await setTitle('Hello there');
    fireEvent.click(await findCta('Save 1 change'));

    // Your changes counts what the one commit holds; the entry's row opens its field diffs.
    const review = await reviewSheet();
    expect(review.getByRole('heading', { name: '1 entry, 1 field' })).toBeDefined();
    expect(review.getByText('One commit')).toBeDefined();
    const entries = within(review.getByRole('list', { name: 'Changed entries' }));
    expect(entries.getByRole('button', { name: /^Hello there/ }).textContent).toContain('Post · Title');
    const diff = await openEntryDiff('Hello there');
    expect(diff.getByText('1 change')).toBeDefined();
    const row = diff.getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello there')).toBeDefined();
    expect(row.textContent).toContain('Before: Hello world');
    expect(row.textContent).toContain('After: Hello there');
    await closeSheet();

    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes, message } = commitArgs(commit);
    expect(message).toBe('Update post/hello-world');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe(ENTRY);
    expect(changes[0]!.content).toContain('title: Hello there');
    expect(changes[0]!.sha).toBe(sha);

    await waitFor(() => expect(sent().some((m) => m.type === 'refresh')).toBe(true));
    // The saved file replaces the form: clean again.
    await waitFor(() => expect(cta()).toBeNull());
    expect(rowText('Title')).toContain('Hello there');
    expect(sent()).toContainEqual(expect.objectContaining({ type: 'highlight', entry: 'post/hello-world' }));
  });

  it('required title blocks save', async () => {
    const { commit } = await openEntry();
    await setTitle('');
    fireEvent.click(await findCta('Save 1 change'));

    // The row says what is wrong, the CTA takes you to it, and its modal shows the message.
    await waitFor(() => expect(rowText('Title')).toContain('Required'));
    expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull();
    expect(commit).not.toHaveBeenCalled();
    fireEvent.click(await findCta('Fix 1 field'));
    const modal = await sheet('Title');
    expect(modal.getByRole('alert').textContent).toContain('Required');
  });

  it('shows the draft status as text, not a control', async () => {
    await openEntry();
    expect(within(main()).queryByRole('checkbox', { name: 'Draft' })).toBeNull();
    expect(within(main()).queryByRole('switch', { name: 'Draft' })).toBeNull();
  });

  it('deletes after confirmation and navigates to the collection', async () => {
    const { commit, source } = await openEntry();
    const sha = await listedSha(source, ENTRY);
    await moreAction('Delete…');
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete post/hello-world?' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith([{ path: ENTRY, content: null, sha }], 'Delete post/hello-world');
    await waitFor(() => expect(editletRoute()).toBe('post'));
    expect(await within(main()).findByRole('heading', { name: /^Posts?$/ })).toBeDefined();
  });

  it('embedded, a delete moves the site to the collection before it asks for a refresh', async () => {
    // The loader reloads the page on `refresh`; posted first, the reload would reopen the deleted entry's route.
    const { fake, init, sent } = embedded('post/hello-world');
    await openEntry({ win: fake.win });
    init();
    await moreAction('Delete…');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(sent().some((m) => m.type === 'refresh')).toBe(true));
    const types = sent().map((m) => (m.type === 'navigate' ? `navigate ${String(m.route)}` : m.type));
    expect(types.indexOf('navigate post')).toBeGreaterThan(-1);
    expect(types.indexOf('navigate post')).toBeLessThan(types.indexOf('refresh'));
  });

  it('embedded, Escape on an open confirm closes the confirm and leaves the window expanded', async () => {
    const { fake, init } = embedded('post/hello-world');
    await openEntry({ win: fake.win });
    init();
    await moreAction('Delete…');
    await screen.findByRole('alertdialog');
    // On the document, not the popup: with focus outside it, the popup's own key handler does not run first.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(main().closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeDefined();
    // Without a modal open, Escape collapses the window (the main area goes inert behind the pill).
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(main().closest('[inert]')).not.toBeNull());
  });

  it('upload staged into same commit', async () => {
    const { commit } = await openEntry();
    const modal = await openField('Featured image');
    const input = modal.getByTestId('featuredImage-file') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'Cover.webp', { type: 'image/webp' });
    fireEvent.change(input, { target: { files: [file] } });

    // The field shows the file name; its title is the stored src.
    await waitFor(() => expect(modal.getByText('cover-2.webp · uploads when you save')).toBeDefined());
    await doneField();
    expect(rowText('Featured image')).toContain('cover-2.webp');
    fireEvent.click(await findCta('Save 1 change'));
    const review = await reviewSheet();
    const commitList = within(review.getByRole('list', { name: 'Commit' }));
    expect(commitList.getByText('New file · cms/content/post/hello-world/cover-2.webp')).toBeDefined();
    await saveReview();

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes } = commitArgs(commit);
    const image = changes.find((c) => c.path === 'cms/content/post/hello-world/cover-2.webp');
    expect(image).toBeDefined();
    expect(image!.content).toBeInstanceOf(Uint8Array);
    expect(image!.sha).toBeNull();
    const entry = changes.find((c) => c.path === ENTRY)!;
    expect(entry.content).toContain('src: hello-world/cover-2.webp');
  });

  it('the Gallery is a second modal: Escape closes it and leaves the field modal open; a tap picks and closes it', async () => {
    await openEntry();
    const modal = await openField('Featured image');
    fireEvent.click(modal.getByRole('button', { name: 'Gallery' }));
    const gallery = await screen.findByRole('dialog', { name: 'Gallery' });
    fireEvent.keyDown(gallery, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gallery' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Featured image' })).toBeDefined();

    fireEvent.click(modal.getByRole('button', { name: 'Gallery' }));
    const again = within(await screen.findByRole('dialog', { name: 'Gallery' }));
    fireEvent.click(again.getByTitle('cms/content/post/hello-world/cover.webp'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gallery' })).toBeNull());
    await doneField();
    expect(rowText('Featured image')).toContain('cover.webp');
  });

  it('Discard drops a staged upload for good: a later upload does not bring it back into the Gallery', async () => {
    const { commit } = await openEntry();
    const upload = async (name: string) => {
      const modal = await openField('Featured image');
      const input = modal.getByTestId('featuredImage-file') as HTMLInputElement;
      fireEvent.change(input, {
        target: { files: [new File([new Uint8Array([1, 2, 3])], name, { type: 'image/webp' })] },
      });
      await waitFor(() => expect(modal.getByText(`${name.toLowerCase()} · uploads when you save`)).toBeDefined());
      await doneField();
    };
    await upload('Dropped.webp');
    await moreAction('Discard changes');
    const confirm = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(rowText('Featured image')).not.toContain('dropped.webp');

    await upload('Kept.webp');
    // The Gallery offers what is staged: the dropped file must not be back among it.
    const modal = await openField('Featured image');
    fireEvent.click(modal.getByRole('button', { name: 'Gallery' }));
    const gallery = await screen.findByRole('dialog', { name: 'Gallery' });
    expect(within(gallery).queryAllByTitle(/kept\.webp$/).length).toBeGreaterThan(0);
    expect(within(gallery).queryAllByTitle(/dropped\.webp$/)).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects a non-image upload', async () => {
    await openEntry();
    const modal = await openField('Featured image');
    const input = modal.getByTestId('featuredImage-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await modal.findByText('notes.txt: only image files can be uploaded')).toBeDefined();
  });

  it('a new entry saves with sha null and the Create message', async () => {
    pendingNewEntries.set('post/my-post', { title: 'My Post' });
    const source = createMemorySource(fixtureFiles());
    const { commit } = await openEntry({ source, route: 'post/my-post' });
    expect(rowText('Title')).toContain('My Post');
    expect((await findCta('Save')).disabled).toBe(false);
    // A new entry has nothing to delete, rename or discard: no ⋯.
    expect(within(entryScreen()).queryByRole('button', { name: 'More actions' })).toBeNull();

    fireEvent.click(await findCta('Save'));
    expect((await reviewCta()).textContent).toBe('Save');
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes, message } = commitArgs(commit);
    expect(message).toBe('Create post/my-post');
    expect(changes).toEqual([expect.objectContaining({ path: 'cms/content/post/my-post.md', sha: null })]);
    expect(changes[0]!.content).toContain('title: My Post');
    expect(changes[0]!.content).toContain('draft: true');
    // Saved: the form now edits the existing file.
    await waitFor(() => expect(within(entryScreen()).getByRole('button', { name: 'More actions' })).toBeDefined());
    await moreAction('Delete…');
    expect(await screen.findByRole('alertdialog')).toBeDefined();
  });

  it('409 shows reload', async () => {
    const { commit } = await openEntry();
    commit.mockResolvedValue({ issues: [{ file: ENTRY, path: '', message: 'File changed since it was read' }] });
    await setTitle('Hello there');
    fireEvent.click(await findCta('Save 1 change'));
    await saveReview();

    expect(await within(main()).findByText('File changed since it was read')).toBeDefined();
    const reload = within(main()).getByRole('button', { name: 'Reload' });
    fireEvent.click(reload);
    await waitFor(() => expect(rowText('Title')).toContain('Hello world'));
    expect(within(main()).queryByText('File changed since it was read')).toBeNull();
  });

  it('shows "changed on disk" for a dirty form when the file changes', async () => {
    const source = createMemorySource(fixtureFiles());
    const { queryClient } = await openEntry({ source });
    await setTitle('Mine');
    await source.commit([{ path: ENTRY, content: '---\ntitle: Theirs\n---\nHello!\n' }], 'External edit');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await within(main()).findByText('This file changed on disk. Your edits are kept.')).toBeDefined();
    expect(rowText('Title')).toContain('Mine');
    fireEvent.click(within(main()).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(rowText('Title')).toContain('Theirs'));
  });

  it('keeps a dirty form and shows a banner when the file poll fails', async () => {
    const source = createMemorySource(fixtureFiles());
    const { queryClient } = await openEntry({ source });
    await setTitle('Mine');
    const list = vi.spyOn(source, 'listFiles').mockRejectedValue(new Error('offline'));
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));

    expect(await screen.findByText("Can't reach the dev server: offline")).toBeDefined();
    expect(rowText('Title')).toContain('Mine');

    list.mockRestore();
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));
    await waitFor(() => expect(screen.queryByText("Can't reach the dev server: offline")).toBeNull());
    expect(rowText('Title')).toContain('Mine');
  });

  it('keeps a dirty form when the schema changes on disk, with a Reload banner', async () => {
    const source = createMemorySource(fixtureFiles());
    const { queryClient } = await openEntry({ source });
    await setTitle('Mine');
    const schemaText = fixtureFiles()['cms/schema.json'] as string;
    await source.commit(
      [{ path: 'cms/schema.json', content: schemaText.replace('"label": "Title"', '"label": "Title 2"') }],
      'Schema edit',
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await within(main()).findByText('The schema changed on disk')).toBeDefined();
    expect(rowText('Title')).toContain('Mine');
    fireEvent.click(within(main()).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect(rowText('Title 2')).toContain('Hello world'));
    expect(within(main()).queryByText('The schema changed on disk')).toBeNull();
  });

  it('keeps a dirty form and shows the issues when the schema breaks on disk', async () => {
    const source = createMemorySource(fixtureFiles());
    const { queryClient } = await openEntry({ source });
    await setTitle('Mine');
    // The memory source refuses a broken schema, so change its sha and serve broken bytes on read.
    const schemaText = fixtureFiles()['cms/schema.json'] as string;
    await source.commit([{ path: 'cms/schema.json', content: `${schemaText}\n` }], 'Touch schema');
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation((p) =>
      p === 'cms/schema.json' ? Promise.resolve(new TextEncoder().encode('{')) : read(p),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await screen.findByText('The schema has errors')).toBeDefined();
    expect(rowText('Title')).toContain('Mine');
  });

  it('a saved embedded form is clean at once: no confirm, no beforeunload prompt', async () => {
    const { fake, init, sent } = embedded('post/hello-world');
    const { source } = await openEntry({ win: fake.win });
    init();
    await setTitle('Hello there');
    fireEvent.click(await findCta('Save 1 change'));
    await reviewSheet();
    // The saved file never finishes loading, so the form is not replaced by it.
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation((p) => (p === ENTRY ? new Promise(() => {}) : read(p)));
    await saveReview();
    await waitFor(() => expect(sent().some((m) => m.type === 'refresh')).toBe(true));

    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    act(() => fake.fromSite({ type: 'close-request' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(sent().some((m) => m.type === 'close')).toBe(true);
  });

  it('close-request with dirty form asks', async () => {
    const { fake, init, sent } = embedded('post/hello-world');
    await openEntry({ win: fake.win });
    init();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await setTitle('Hello there');
    act(() => fake.fromSite({ type: 'close-request' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(sent().some((m) => m.type === 'close')).toBe(false);

    confirm.mockReturnValue(true);
    act(() => fake.fromSite({ type: 'close-request' }));
    // After the page preview drops the discarded edits (see docs/admin/preview.md).
    await waitFor(() => expect(sent().some((m) => m.type === 'close')).toBe(true));
  });

  it('in-app navigation with a dirty form asks first', async () => {
    await openEntry();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await setTitle('Hello there');
    fireEvent.click(within(entryScreen()).getByRole('link', { name: 'Back' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(editletRoute()).toBe('post/hello-world');
  });
});
