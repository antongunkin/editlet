import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { fixtureFiles, renderApp } from '../test/render';

const main = () => screen.getByRole('main');
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

const POST = 'cms/content/post/hello-world.md';
const COVER = 'cms/content/post/hello-world/cover.webp';
const OLD = 'cms/content/post/hello-world/old.png';

function files(extra: Record<string, string | Uint8Array> = {}) {
  const base = fixtureFiles();
  return { ...base, [OLD]: new Uint8Array([9, 9]), ...extra };
}

async function openMedia(extra?: Record<string, string | Uint8Array>) {
  const source = createMemorySource(files(extra));
  const commit = vi.spyOn(source, 'commit');
  renderApp({ route: 'media', source });
  await within(main()).findByRole('heading', { name: 'Media' });
  await within(main()).findByTitle(COVER);
  return { source, commit };
}

const card = (path: string) => within(main()).getByTitle(path);
const chip = (name: RegExp) => within(main()).getByRole('button', { name });

/** The ⋯ action sheet of the screen, opened. */
async function more() {
  fireEvent.click(within(main()).getByRole('button', { name: 'More actions' }));
  return within(await screen.findByRole('dialog'));
}

/** Search is a header action: it opens the search field in place of the title. */
function search(text: string) {
  if (!screen.queryByRole('searchbox', { name: 'Search images' }))
    fireEvent.click(within(main()).getByRole('button', { name: 'Search images' }));
  fireEvent.change(within(main()).getByRole('searchbox', { name: 'Search images' }), { target: { value: text } });
}

/** Opens the image's page from the grid. */
async function openImage(path: string, name: string) {
  fireEvent.click(card(path));
  await within(main()).findByRole('heading', { level: 1, name });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('MediaScreen', () => {
  it('lists images with their folder, Used and Unused, and filters them', async () => {
    await openMedia();
    expect(card(COVER).getAttribute('aria-label')).toBe('cover.webp, post/hello-world, Used in 1');
    expect(within(card(COVER)).queryByText('Unused')).toBeNull();
    await waitFor(() => expect(card(OLD).getAttribute('aria-label')).toContain('Unused'));
    expect(within(card(OLD)).getByText('Unused')).toBeDefined();
    fireEvent.click(chip(/^Unused\s*1$/));
    expect(within(main()).queryByTitle(COVER)).toBeNull();
    expect(card(OLD)).toBeDefined();
    fireEvent.click(chip(/^All\s*2$/));
    search('cover');
    expect(within(main()).queryByTitle(OLD)).toBeNull();
    // The search header keeps the page's h1 and the window's own actions.
    expect(within(main()).getByRole('heading', { level: 1, name: 'Media' })).toBeDefined();
    expect(within(main()).getByRole('button', { name: 'Minimize' })).toBeDefined();
    // Back from the search field clears it.
    fireEvent.click(within(main()).getByRole('button', { name: 'Close search' }));
    expect(card(OLD)).toBeDefined();
  });

  it('opens an image with its uses and saves alt text to the entry in one commit', async () => {
    const { source, commit } = await openMedia();
    await openImage(COVER, 'cover.webp');
    expect(within(main()).getByRole('heading', { name: 'Used in 1 place' })).toBeDefined();
    expect(within(main()).getByRole('link', { name: /hello-world/ })).toBeDefined();
    const alt = within(main()).getByLabelText('Alt text in hello-world, Featured image') as HTMLInputElement;
    expect(alt.value).toBe('Cover');
    const save = within(main()).getByRole('button', { name: 'Save alt text' });
    expect(save).toHaveProperty('disabled', true);
    fireEvent.change(alt, { target: { value: 'A laptop' } });
    fireEvent.click(save);
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [changes, message] = commit.mock.calls[0]!;
    expect(message).toBe('Update post/hello-world');
    expect(changes.map((c) => c.path)).toEqual([POST]);
    expect(decode(await source.readFile(POST))).toContain('alt: A laptop');
    // Delete is in ⋯ and is off while an entry uses the image.
    const actions = await more();
    expect(actions.getByRole('button', { name: /^Delete…/ })).toHaveProperty('disabled', true);
  });

  it('uploads several files at once into the media folder, renaming on collision', async () => {
    const { source, commit } = await openMedia({ 'cms/content/media/photo.png': new Uint8Array([1]) });
    const input = screen.getByTestId('media-upload-file') as HTMLInputElement;
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array([2])], 'Photo.png'),
          new File(['x'], 'notes.txt'),
          new File([new Uint8Array([3])], 'b.jpg'),
        ],
      },
    });
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [changes, message] = commit.mock.calls[0]!;
    expect(message).toBe('Upload 2 images');
    expect(changes.map((c) => c.path)).toEqual(['cms/content/media/photo-2.png', 'cms/content/media/b.jpg']);
    expect([...(await source.readFile('cms/content/media/photo-2.png'))]).toEqual([2]);
    expect(await within(main()).findByText(/Skipped notes.txt: only image files can be uploaded/)).toBeDefined();
    expect(await within(main()).findByTitle('cms/content/media/b.jpg')).toBeDefined();
  });

  it('deletes only unused images, after asking', async () => {
    const { source, commit } = await openMedia();
    fireEvent.click((await more()).getByRole('button', { name: 'Select images' }));
    await waitFor(() => expect(card(OLD)).toHaveProperty('disabled', false));
    expect(within(main()).getByText('Only unused images can be selected.')).toBeDefined();
    // Where two files can share a name, the tile says which one: its name and folder are under the picture.
    expect(within(card(OLD)).getByText('old.png')).toBeDefined();
    expect(within(card(OLD)).getByText('post/hello-world')).toBeDefined();
    expect(within(main()).getByTitle(`Used by ${POST}`)).toHaveProperty('disabled', true);
    expect(within(main()).getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true);
    fireEvent.click(card(OLD));
    fireEvent.click(within(main()).getByRole('button', { name: 'Delete 1 image' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete 1 image?')).toBeDefined();
    expect(within(dialog).getByText(/old\.png is not used by any entry/)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete image' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]![0]).toEqual([{ path: OLD, content: null, sha: expect.any(String) }]);
    await expect(source.readFile(OLD)).rejects.toThrow();
    await waitFor(() => expect(within(main()).queryByTitle(OLD)).toBeNull());
  });

  it('replaces a file in place (same extension) with the sha it was read at', async () => {
    const { source, commit } = await openMedia();
    await openImage(OLD, 'old.png');
    fireEvent.change(screen.getByTestId('media-replace-file'), {
      target: { files: [new File([new Uint8Array([4, 4])], 'new.png')] },
    });
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [changes, message] = commit.mock.calls[0]!;
    expect(message).toBe('Update post/old.png');
    expect(changes).toEqual([{ path: OLD, content: new Uint8Array([4, 4]), sha: expect.any(String) }]);
    expect([...(await source.readFile(OLD))]).toEqual([4, 4]);
  });

  it('is reachable from All content', async () => {
    renderApp({ route: '' });
    fireEvent.click(await within(main()).findByRole('link', { name: /^All content/ }));
    const link = await within(main()).findByRole('link', { name: /^Media/ });
    fireEvent.click(link);
    expect(await within(main()).findByRole('heading', { name: 'Media' })).toBeDefined();
  });
});

const drag = (list: File[], types = ['Files']) => ({ dataTransfer: { types, files: list, dropEffect: 'none' } });

const section = () => main().querySelector<HTMLElement>('[data-editlet="screen"]')!;

const big = (name: string) => new File([new Uint8Array(6 * 1024 * 1024)], name);

describe('MediaScreen: drops, failures and several uses', () => {
  it('uploads files dropped on the screen to the media folder, and on a tile into that tile folder', async () => {
    const { commit } = await openMedia();
    const png = new File([new Uint8Array([5])], 'drop.png');

    fireEvent.dragEnter(section(), drag([png], ['text/plain']));
    expect(section().dataset.dragging).toBeUndefined();
    fireEvent.dragEnter(section(), drag([png]));
    expect(section().dataset.dragging).toBe('true');
    const over = drag([png]);
    fireEvent.dragOver(section(), over);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    fireEvent.dragLeave(section(), drag([png]));
    expect(section().dataset.dragging).toBeUndefined();
    fireEvent.drop(section(), drag([png], ['text/plain']));
    expect(commit).not.toHaveBeenCalled();

    fireEvent.dragEnter(section(), drag([png]));
    fireEvent.drop(section(), drag([png]));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect(commit.mock.calls[0]![0].map((c) => c.path)).toEqual(['cms/content/media/drop.png']);
    expect(commit.mock.calls[0]![1]).toBe('Upload media/drop.png');

    const target = card(COVER);
    fireEvent.dragEnter(target, drag([png]));
    expect(target.dataset.dragging).toBe('true');
    fireEvent.drop(target, drag([new File([new Uint8Array([6])], 'here.png')]));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    expect(commit.mock.calls[1]![0].map((c) => c.path)).toEqual(['cms/content/post/hello-world/here.png']);
  });

  it('uploads into the open image folder from the image’s ⋯', async () => {
    const { commit } = await openMedia();
    await openImage(OLD, 'old.png');
    const actions = await more();
    expect(actions.getByRole('button', { name: /^Upload to this folder…/ })).toBeDefined();
    fireEvent.change(screen.getByTestId('media-upload-file'), {
      target: { files: [new File([new Uint8Array([7])], 'next.png')] },
    });
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]![0].map((c) => c.path)).toEqual(['cms/content/post/hello-world/next.png']);
    expect(commit.mock.calls[0]![1]).toBe('Upload post/next.png');
  });

  it('notes large files and reports a series that stopped midway', async () => {
    const { commit } = await openMedia();
    commit.mockImplementationOnce(async () => ({ issues: [], sha: 'x' }) as never);
    commit.mockRejectedValueOnce(new Error('Network down'));
    fireEvent.change(screen.getByTestId('media-upload-file'), { target: { files: [big('a.png'), big('b.png')] } });
    const alert = await within(main()).findByRole('alert');
    await waitFor(() => expect(alert.textContent).toContain('1 of 2 commits went through. Network down'));
    expect(alert.textContent).toContain(
      "Large files stay in the repository's history for good: a.png (6.0 MB), b.png (6.0 MB).",
    );
    expect(commit.mock.calls.map(([changes, message]) => [changes.map((c) => c.path), message])).toEqual([
      [['cms/content/media/a.png'], 'Upload 2 images (1/2)'],
      [['cms/content/media/b.png'], 'Upload 2 images (2/2)'],
    ]);
  });

  it('shows the issues of a refused commit', async () => {
    const { commit } = await openMedia();
    commit.mockResolvedValueOnce({ issues: [{ file: 'x', path: '', message: 'Path not writable' }] } as never);
    fireEvent.change(screen.getByTestId('media-upload-file'), {
      target: { files: [new File([new Uint8Array([1])], 'one.png')] },
    });
    expect((await within(main()).findByRole('alert')).textContent).toContain('Path not writable');
  });

  it('refuses to replace with a file that is not an image', async () => {
    const { commit } = await openMedia();
    await openImage(OLD, 'old.png');
    fireEvent.change(screen.getByTestId('media-replace-file'), { target: { files: [new File(['x'], 'notes.txt')] } });
    expect((await within(main()).findByRole('alert')).textContent).toBe('notes.txt: only image files can be uploaded');
    expect(commit).not.toHaveBeenCalled();
    expect(within(main()).getByRole('heading', { name: 'Not used' })).toBeDefined();
    fireEvent.click(within(main()).getByRole('button', { name: 'All media' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Media' })).toBeDefined();
  });

  it('uses the first alt text for every use and saves both entries', async () => {
    const second = 'cms/content/post/second.md';
    const { commit } = await openMedia({
      [second]: '---\ntitle: Second\nfeaturedImage:\n  src: hello-world/cover.webp\n---\n',
    });
    await openImage(COVER, 'cover.webp');
    await waitFor(() => expect(within(main()).getByRole('heading', { name: 'Used in 2 places' })).toBeDefined());
    const alt = within(main()).getByLabelText('Alt text in second, Featured image') as HTMLInputElement;
    expect(alt.value).toBe('');
    fireEvent.click((await more()).getByRole('button', { name: 'Use the first alt text everywhere' }));
    await waitFor(() => expect(alt.value).toBe('Cover'));
    fireEvent.click(within(main()).getByRole('button', { name: 'Save alt text' }));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    expect(commit.mock.calls[0]![0].map((c) => c.path)).toEqual([second]);
  });

  it('filters by missing alt, says when nothing matches, and toggles a selection', async () => {
    await openMedia({
      'cms/content/post/second.md': '---\ntitle: Second\nfeaturedImage:\n  src: hello-world/old.png\n---\n',
    });
    await waitFor(() => expect(card(OLD).getAttribute('aria-label')).toContain('Used in 1'));
    expect(within(card(OLD)).getByText('No alt')).toBeDefined();
    fireEvent.click(chip(/^Missing alt\s*1$/));
    expect(within(main()).queryByTitle(COVER)).toBeNull();
    search('zzz');
    expect(within(main()).getByText('No images match.')).toBeDefined();
  });

  it('selecting a tile twice clears it; Done leaves select mode', async () => {
    await openMedia({ 'cms/content/media/free.png': new Uint8Array([1]) });
    fireEvent.click((await more()).getByRole('button', { name: 'Select images' }));
    const free = await within(main()).findByTitle('cms/content/media/free.png');
    await waitFor(() => expect(free).toHaveProperty('disabled', false));
    fireEvent.click(free);
    expect(free.getAttribute('aria-pressed')).toBe('true');
    expect(within(main()).getByRole('button', { name: 'Delete 1 image' })).toBeDefined();
    fireEvent.click(free);
    expect(free.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(within(main()).getByRole('button', { name: 'Done' }));
    expect(free.getAttribute('aria-pressed')).toBeNull();
    expect(within(main()).getByRole('button', { name: 'Upload' })).toBeDefined();
  });

  it('says where uploads go when there are no images', async () => {
    const empty = Object.fromEntries(Object.entries(fixtureFiles()).filter(([p]) => !p.endsWith('.webp')));
    renderApp({ route: 'media', source: createMemorySource(empty) });
    expect(
      await within(main()).findByText(
        'No images under cms/content/ yet. Upload or drop files here: they go to media/.',
      ),
    ).toBeDefined();
  });

  it('cancels a delete from its dialog', async () => {
    const { commit } = await openMedia();
    await waitFor(() => expect(card(OLD).getAttribute('aria-label')).toContain('Unused'));
    await openImage(OLD, 'old.png');
    const actions = await more();
    await waitFor(() => expect(actions.getByRole('button', { name: /^Delete…/ })).toHaveProperty('disabled', false));
    fireEvent.click(actions.getByRole('button', { name: /^Delete…/ }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(commit).not.toHaveBeenCalled();
  });
});
