import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute } from '../../../loader/protocol';
import { pendingNewEntries } from '../entry/pending';
import type { SourceChange } from '../source/local';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { entryActions, fixtureFiles, renderApp } from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';

const main = () => screen.getByRole('main');
const editletRoute = () => readEditletRoute(window.location.href);
const saveButton = () => entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;

async function openEntry(opts: Parameters<typeof renderApp>[0] = {}) {
  const source = opts.source ?? createMemorySource(opts.files ?? fixtureFiles());
  const commit = vi.spyOn(source, 'commit');
  const utils = renderApp({ route: 'post/hello-world', ...opts, source });
  const title = (await within(main()).findByLabelText(/^Title/)) as HTMLInputElement;
  return { ...utils, source, commit, title };
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
  it('shows the file and its git history in a collapsed block', async () => {
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
    const meta = within(main()).getByText('Meta').closest('details')!;
    expect(meta.open).toBe(false);
    expect(within(meta).getByText(ENTRY)).toBeDefined();
    expect(await within(meta).findByText('Ann')).toBeDefined();
    expect(within(meta).getByText('Bob')).toBeDefined();
    expect(within(meta).getByText('2')).toBeDefined();
  });
});

describe('Entry', () => {
  it('opens post/hello-world with its title and Save disabled', async () => {
    const { title } = await openEntry();
    expect(title.value).toBe('Hello world');
    expect(saveButton().disabled).toBe(true);
  });

  it('shows unsaved changes in the status bar as a link that opens the review', async () => {
    const { fake, init } = embedded('post/hello-world');
    const { title } = await openEntry({ win: fake.win });
    init();
    const bar = () => within(screen.getByRole('contentinfo'));
    expect(bar().queryByRole('button', { name: 'Unsaved changes (1)' })).toBeNull();
    expect(bar().queryByText('Published')).toBeNull();
    fireEvent.change(title, { target: { value: 'Hello there' } });
    fireEvent.click(await bar().findByRole('button', { name: 'Unsaved changes (1)' }));
    expect(await screen.findByRole('dialog')).toBeDefined();
  });

  it('Discard restores the saved values after confirmation', async () => {
    const { title } = await openEntry();
    const discard = () =>
      entryActions().getByRole('button', { name: 'Discard changes', hidden: true }) as HTMLButtonElement;
    expect(discard().disabled).toBe(true);
    fireEvent.change(title, { target: { value: 'Hello there' } });
    expect(discard().disabled).toBe(false);
    fireEvent.click(discard());
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Discard unsaved changes?' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(title.value).toBe('Hello world'));
    expect(saveButton().disabled).toBe(true);
  });

  it('edits the title, reviews the diff and commits the update, then sends refresh', async () => {
    const { fake, init, sent } = embedded('post/hello-world');
    const { title, commit, source } = await openEntry({ win: fake.win });
    init();
    const sha = await listedSha(source, ENTRY);

    fireEvent.change(title, { target: { value: 'Hello there' } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Review changes' })).toBeDefined();
    const row = within(dialog).getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello there')).toBeDefined();
    expect(row.querySelector('.editlet-diff-hunk__line--del')?.textContent).toContain('Hello world');
    expect(row.querySelector('.editlet-diff-hunk__line--add')?.textContent).toContain('Hello there');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes, message } = commitArgs(commit);
    expect(message).toBe('Update post/hello-world');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.path).toBe(ENTRY);
    expect(changes[0]!.content).toContain('title: Hello there');
    expect(changes[0]!.sha).toBe(sha);

    await waitFor(() => expect(sent().some((m) => m.type === 'refresh')).toBe(true));
    // The saved file replaces the form: clean again.
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(((await within(main()).findByLabelText(/^Title/)) as HTMLInputElement).value).toBe('Hello there');
    expect(sent()).toContainEqual(expect.objectContaining({ type: 'highlight', entry: 'post/hello-world' }));
  });

  it('required title blocks save', async () => {
    const { title, commit } = await openEntry();
    fireEvent.change(title, { target: { value: '' } });
    fireEvent.click(saveButton());

    const field = title.closest('.editlet-field')!;
    expect(within(field as HTMLElement).getByRole('alert').textContent).toContain('Required');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commit).not.toHaveBeenCalled();
  });

  it('shows the draft status as text, not a control', async () => {
    await openEntry();
    expect(within(main()).queryByRole('checkbox', { name: 'Draft' })).toBeNull();
  });

  it('deletes after confirmation and navigates to the collection', async () => {
    const { commit, source } = await openEntry();
    const sha = await listedSha(source, ENTRY);
    fireEvent.click(entryActions().getByRole('button', { name: 'Delete', hidden: true }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Delete post/hello-world?' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit).toHaveBeenCalledWith([{ path: ENTRY, content: null, sha }], 'Delete post/hello-world');
    await waitFor(() => expect(editletRoute()).toBe('post'));
    expect(await within(main()).findByRole('heading', { name: 'Post' })).toBeDefined();
  });

  it('embedded, a delete moves the site to the collection before it asks for a refresh', async () => {
    // The loader reloads the page on `refresh`; posted first, the reload would reopen the deleted entry's route.
    const { fake, init, sent } = embedded('post/hello-world');
    await openEntry({ win: fake.win });
    init();
    fireEvent.click(entryActions().getByRole('button', { name: 'Delete', hidden: true }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(sent().some((m) => m.type === 'refresh')).toBe(true));
    const types = sent().map((m) => (m.type === 'navigate' ? `navigate ${String(m.route)}` : m.type));
    expect(types.indexOf('navigate post')).toBeGreaterThan(-1);
    expect(types.indexOf('navigate post')).toBeLessThan(types.indexOf('refresh'));
  });

  it('upload staged into same commit', async () => {
    const { commit } = await openEntry();
    const input = screen.getByTestId('featuredImage-file') as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2, 3])], 'Cover.webp', { type: 'image/webp' });
    fireEvent.change(input, { target: { files: [file] } });

    // The field shows the file name; its title is the stored src.
    await waitFor(() => expect(within(main()).getByTitle('hello-world/cover-2.webp').textContent).toBe('cover-2.webp'));
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('+ cms/content/post/hello-world/cover-2.webp')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes } = commitArgs(commit);
    const image = changes.find((c) => c.path === 'cms/content/post/hello-world/cover-2.webp');
    expect(image).toBeDefined();
    expect(image!.content).toBeInstanceOf(Uint8Array);
    expect(image!.sha).toBeNull();
    const entry = changes.find((c) => c.path === ENTRY)!;
    expect(entry.content).toContain('src: hello-world/cover-2.webp');
  });

  it('rejects a non-image upload', async () => {
    await openEntry();
    const input = screen.getByTestId('featuredImage-file') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } });
    expect(await within(main()).findByText('notes.txt: only image files can be uploaded')).toBeDefined();
  });

  it('a new entry saves with sha null and the Create message', async () => {
    pendingNewEntries.set('post/my-post', { title: 'My Post' });
    const source = createMemorySource(fixtureFiles());
    const { commit, title } = await openEntry({ source, route: 'post/my-post' });
    expect(title.value).toBe('My Post');
    expect(saveButton().disabled).toBe(false);
    expect(entryActions().queryByRole('button', { name: 'Delete', hidden: true })).toBeNull();

    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const { changes, message } = commitArgs(commit);
    expect(message).toBe('Create post/my-post');
    expect(changes).toEqual([expect.objectContaining({ path: 'cms/content/post/my-post.md', sha: null })]);
    expect(changes[0]!.content).toContain('title: My Post');
    expect(changes[0]!.content).toContain('draft: true');
    // Saved: the form now edits the existing file.
    expect(await entryActions().findByRole('button', { name: 'Delete', hidden: true })).toBeDefined();
  });

  it('409 shows reload', async () => {
    const { commit, title } = await openEntry();
    commit.mockResolvedValue({ issues: [{ file: ENTRY, path: '', message: 'File changed since it was read' }] });
    fireEvent.change(title, { target: { value: 'Hello there' } });
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(main()).findByText('File changed since it was read')).toBeDefined();
    const reload = within(main()).getByRole('button', { name: 'Reload' });
    fireEvent.click(reload);
    await waitFor(() =>
      expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Hello world'),
    );
    expect(within(main()).queryByText('File changed since it was read')).toBeNull();
  });

  it('shows "changed on disk" for a dirty form when the file changes', async () => {
    const source = createMemorySource(fixtureFiles());
    const { title, queryClient } = await openEntry({ source });
    fireEvent.change(title, { target: { value: 'Mine' } });
    await source.commit([{ path: ENTRY, content: '---\ntitle: Theirs\n---\nHello!\n' }], 'External edit');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await within(main()).findByText('This file changed on disk')).toBeDefined();
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Mine');
    fireEvent.click(within(main()).getByRole('button', { name: 'Reload' }));
    await waitFor(() => expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Theirs'));
  });

  it('keeps a dirty form and shows a banner when the file poll fails', async () => {
    const source = createMemorySource(fixtureFiles());
    const { title, queryClient } = await openEntry({ source });
    fireEvent.change(title, { target: { value: 'Mine' } });
    const list = vi.spyOn(source, 'listFiles').mockRejectedValue(new Error('offline'));
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));

    expect(await screen.findByText("Can't reach the dev server: offline")).toBeDefined();
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Mine');

    list.mockRestore();
    await act(() => queryClient.refetchQueries({ queryKey: ['files'] }));
    await waitFor(() => expect(screen.queryByText("Can't reach the dev server: offline")).toBeNull());
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Mine');
  });

  it('keeps a dirty form when the schema changes on disk, with a Reload banner', async () => {
    const source = createMemorySource(fixtureFiles());
    const { title, queryClient } = await openEntry({ source });
    fireEvent.change(title, { target: { value: 'Mine' } });
    const schemaText = fixtureFiles()['cms/schema.json'] as string;
    await source.commit(
      [{ path: 'cms/schema.json', content: schemaText.replace('"label": "Title"', '"label": "Title 2"') }],
      'Schema edit',
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await within(main()).findByText('The schema changed on disk')).toBeDefined();
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Mine');
    fireEvent.click(within(main()).getByRole('button', { name: 'Reload' }));
    await waitFor(() =>
      expect((within(main()).getByLabelText(/^Title 2/) as HTMLInputElement).value).toBe('Hello world'),
    );
    expect(within(main()).queryByText('The schema changed on disk')).toBeNull();
  });

  it('keeps a dirty form and shows the issues when the schema breaks on disk', async () => {
    const source = createMemorySource(fixtureFiles());
    const { title, queryClient } = await openEntry({ source });
    fireEvent.change(title, { target: { value: 'Mine' } });
    // The memory source refuses a broken schema, so change its sha and serve broken bytes on read.
    const schemaText = fixtureFiles()['cms/schema.json'] as string;
    await source.commit([{ path: 'cms/schema.json', content: `${schemaText}\n` }], 'Touch schema');
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation((p) =>
      p === 'cms/schema.json' ? Promise.resolve(new TextEncoder().encode('{')) : read(p),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(await screen.findByText('The schema has errors')).toBeDefined();
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Mine');
  });

  it('a saved embedded form is clean at once: no confirm, no beforeunload prompt', async () => {
    const { fake, init, sent } = embedded('post/hello-world');
    const { title, source } = await openEntry({ win: fake.win });
    init();
    fireEvent.change(title, { target: { value: 'Hello there' } });
    fireEvent.click(saveButton());
    const dialog = await screen.findByRole('dialog');
    // The saved file never finishes loading, so the form is not replaced by it.
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation((p) => (p === ENTRY ? new Promise(() => {}) : read(p)));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
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
    const { title } = await openEntry({ win: fake.win });
    init();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    fireEvent.change(title, { target: { value: 'Hello there' } });
    act(() => fake.fromSite({ type: 'close-request' }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(sent().some((m) => m.type === 'close')).toBe(false);

    confirm.mockReturnValue(true);
    act(() => fake.fromSite({ type: 'close-request' }));
    // After the page preview drops the discarded edits (see docs/admin/preview.md).
    await waitFor(() => expect(sent().some((m) => m.type === 'close')).toBe(true));
  });

  it('in-app navigation with a dirty form asks first', async () => {
    const { title } = await openEntry();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.change(title, { target: { value: 'Hello there' } });
    fireEvent.click(screen.getByRole('link', { name: 'Home', hidden: true }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(editletRoute()).toBe('post/hello-world');
  });
});
