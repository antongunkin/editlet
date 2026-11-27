import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { fixtureFiles, HOME_LOADED, renderApp, setField } from '../test/render';
import { resetThemeChoice } from '../window/settings';

// The search sheet (docs/admin/search.md): the header's button, the shortcut, matching and opening an entry.

/** The fixture site with titles on post and author, a few more posts (one a draft) and a singleton. */
function files(extraPosts = 0) {
  const out = fixtureFiles();
  const schema = JSON.parse(out['cms/schema.json'] as string);
  schema.collections.post.titleField = 'title';
  schema.collections.author.titleField = 'name';
  out['cms/schema.json'] = JSON.stringify(schema, null, 2);
  out['cms/content/post/tires.md'] = '---\ntitle: Tires for a rigid bike\ndraft: true\n---\nBody\n';
  out['cms/content/author/jane.md'] = '---\nname: Jane Tire\n---\n';
  for (let i = 0; i < extraPosts; i++) out[`cms/content/post/spare-${i}.md`] = `---\ntitle: Spare part ${i}\n---\n`;
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  resetThemeChoice();
  delete document.documentElement.dataset.editletTheme;
});

async function home(extraPosts = 0) {
  renderApp({ files: files(extraPosts) });
  await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
}

async function openSearch() {
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const sheet = await screen.findByRole('dialog', { name: 'Search' });
  return {
    sheet,
    field: within(sheet).getByRole('textbox', { name: 'Search entries and actions' }) as HTMLInputElement,
  };
}

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const shortcut = (init: KeyboardEventInit = { key: 'k', metaKey: true }) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true }));
  });

describe('Search', () => {
  it('opens from Home’s header with the field focused and says what to type', async () => {
    await home();
    const { sheet, field } = await openSearch();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(within(sheet).getByText(/Type a title, an address or an action\. 4 entries\./)).toBeDefined();
  });

  it('lists the entries of every collection that match a title word or the address, the top result first', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'tir');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    // The title starts with it, then a word of a title; the address of the third is only a substring.
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('link')
          .map((r) => r.textContent),
      ).toEqual(['Tires for a rigid bikePost · Draft', 'Jane TireAuthor · 1 post']),
    );
    const rows = within(list).getAllByRole('link');
    expect(rows[0]!.hasAttribute('data-selected')).toBe(true);
    type(field, 'jane');
    await waitFor(() => expect(within(list).getAllByRole('link')).toHaveLength(1));
  });

  it('names a singleton by its collection and says when nothing matches', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'home');
    expect((await within(sheet).findByRole('list', { name: 'Entries' })).textContent).toContain('Home page');
    type(field, 'zzz');
    expect(await within(sheet).findByText('Nothing matches “zzz”.')).toBeDefined();
  });

  it('Enter opens the top result and closes the search; a result link opens its entry', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'tires');
    await within(sheet).findByRole('list', { name: 'Entries' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByRole('heading', { name: 'Tires for a rigid bike' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
  });

  it('closes when the chosen entry is the one already open (no route change does it)', async () => {
    renderApp({ files: files(), route: 'post/tires' });
    await screen.findByRole('heading', { name: 'Tires for a rigid bike' });
    shortcut();
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const field = within(sheet).getByRole('textbox', { name: 'Search entries and actions' });
    type(field, 'tires');
    await within(sheet).findByRole('list', { name: 'Entries' });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
  });

  it('shows the first 20 of many and says so', async () => {
    await home(24);
    const { sheet, field } = await openSearch();
    type(field, 'spare');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    expect(within(list).getAllByRole('link')).toHaveLength(20);
    expect(within(sheet).getByText('Showing 20 of 24: keep typing to narrow them.')).toBeDefined();
  });

  it('clears the field with ×, and forgets the query when it closes', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'tires');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clear search' }));
    expect(field.value).toBe('');
    type(field, 'tires');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
    expect((await openSearch()).field.value).toBe('');
  });
});

describe('the shortcut', () => {
  it('⌘K and Ctrl+K open the search, a second press focuses the field; other keys do nothing', async () => {
    await home();
    shortcut({ key: 'j', metaKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
    shortcut({ key: 'K', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
    shortcut();
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const field = within(sheet).getByRole('textbox', { name: 'Search entries and actions' });
    field.blur();
    shortcut({ key: 'k', ctrlKey: true });
    expect(document.activeElement).toBe(field);
  });

  it('also answers on a layout where the K key reports another letter', async () => {
    await home();
    shortcut({ key: 'л', code: 'KeyK', ctrlKey: true });
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeDefined();
  });

  it('works on All content too, and the button is there', async () => {
    await home();
    fireEvent.click(await screen.findByRole('link', { name: HOME_LOADED }));
    await screen.findByRole('heading', { name: 'All content' });
    expect(screen.getByRole('button', { name: 'Search' })).toBeDefined();
    shortcut();
    expect(await screen.findByRole('dialog', { name: 'Search' })).toBeDefined();
  });

  it('does not open over another modal (a field’s sheet)', async () => {
    await home();
    fireEvent.click(await screen.findByRole('link', { name: HOME_LOADED }));
    fireEvent.click(await screen.findByRole('link', { name: /^Post/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Tires for a rigid bike/ }));
    fireEvent.click(await screen.findByRole('button', { name: /^Title/ }));
    await screen.findByRole('dialog', { name: 'Title' });
    shortcut();
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });
});

describe('Actions', () => {
  const actionsList = (sheet: HTMLElement) => within(sheet).findByRole('list', { name: 'Actions' });
  const names = (list: HTMLElement) =>
    within(list)
      .getAllByRole('button')
      .map((b) => b.textContent);

  it('typed new: New post; Enter opens the New dialog over the screen and the search closes', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'new');
    const list = await actionsList(sheet);
    expect(names(list)).toEqual(['New postPost', 'New authorAuthor']);
    expect(within(list).getAllByRole('button')[0]!.hasAttribute('data-selected')).toBe(true);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByRole('dialog', { name: 'New post' })).toBeDefined();
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });

  it('closing that dialog gives the focus back to what had it before the search', async () => {
    await home();
    const button = screen.getByRole('button', { name: 'Search' });
    button.focus();
    const { sheet, field } = await openSearch();
    type(field, 'new post');
    await actionsList(sheet);
    fireEvent.keyDown(field, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'New post' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New post' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Search' })));
  });

  it('typed dark: only Actions; Enter switches the theme and the search stays, the rows follow', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'dark');
    const list = await actionsList(sheet);
    expect(within(sheet).queryByRole('list', { name: 'Entries' })).toBeNull();
    expect(names(list)).toEqual(['Use dark appearance']);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(document.documentElement.dataset.editletTheme).toBe('dark');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeDefined();
    type(field, 'appearance');
    await waitFor(() =>
      expect(names(within(sheet).getByRole('list', { name: 'Actions' }))).toEqual([
        'Use light appearance',
        'Use system appearance',
      ]),
    );
  });

  it('says both counts and orders the groups by the top result', async () => {
    renderApp({ files: { ...files(), 'cms/content/post/media-kit.md': '---\ntitle: Media kit\n---\n' } });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'media');
    await actionsList(sheet);
    await within(sheet).findByRole('list', { name: 'Entries' });
    // *Media* is an action word (rank 0); *Media kit* only starts with it.
    const headings = within(sheet)
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    // The first is the sheet's own name (visually hidden).
    expect(headings).toEqual(['Search', 'Actions', 'Entries']);
    expect(sheet.querySelector('output')!.textContent).toBe('1 entry, 1 action');
  });

  it('↓ walks from the field through both groups, ↑ back; Home and End jump', async () => {
    renderApp({ files: { ...files(), 'cms/content/post/media-kit.md': '---\ntitle: Media kit\n---\n' } });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'media');
    await within(sheet).findByRole('list', { name: 'Entries' });
    const action = within(await actionsList(sheet)).getByRole('button', { name: /^Media/ });
    const entry = within(within(sheet).getByRole('list', { name: 'Entries' })).getByRole('link');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(entry);
    fireEvent.keyDown(entry, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(entry);
    fireEvent.keyDown(entry, { key: 'Home' });
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'End' });
    expect(document.activeElement).toBe(entry);
    fireEvent.keyDown(entry, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(field);
  });

  it('Go to opens the place', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'go media');
    fireEvent.click(within(await actionsList(sheet)).getByRole('button', { name: /^Media/ }));
    expect(await screen.findByRole('heading', { name: 'Media' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull());
  });

  it('the empty field on Home lists no actions in dev mode, just the line', async () => {
    await home();
    const { sheet } = await openSearch();
    expect(within(sheet).queryByRole('list', { name: 'Actions' })).toBeNull();
  });
});

describe('Duplicate from the search', () => {
  async function onPost() {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('heading', { level: 1, name: 'Hello world' });
    shortcut();
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    return { sheet, field: within(sheet).getByRole('textbox', { name: 'Search entries and actions' }) };
  }

  it('the empty field over an entry: Duplicate this entry, then New post; Duplicate opens the copy', async () => {
    const { sheet } = await onPost();
    const list = await within(sheet).findByRole('list', { name: 'Actions' });
    await waitFor(() =>
      expect(
        within(list)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Duplicate this entryHello world', 'New postPost']),
    );
    fireEvent.click(within(list).getByRole('button', { name: /^Duplicate this entry/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello world (copy)' })).toBeDefined();
    expect(window.location.href).toContain('post/hello-world-copy');
    expect(await screen.findByText('Duplicated')).toBeDefined();
  });

  it('is off with Save first while the entry has unsaved edits: Enter and a click do nothing', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('heading', { level: 1, name: 'Hello world' });
    await setField('Title', 'Hello there');
    shortcut();
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    const field = within(sheet).getByRole('textbox', { name: 'Search entries and actions' });
    type(field, 'duplicate');
    const row = within(await within(sheet).findByRole('list', { name: 'Actions' })).getByRole('button', {
      name: /^Duplicate this entry/,
    });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toBe('Duplicate this entrySave first');
    expect(row.hasAttribute('data-selected')).toBe(false);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.click(row);
    expect(window.location.href).not.toContain('hello-world-copy');
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeDefined();
  });

  it('is not offered on a singleton', async () => {
    renderApp({ files: files(), route: 'homePage' });
    await screen.findByRole('button', { name: /^Title/ });
    shortcut();
    const sheet = await screen.findByRole('dialog', { name: 'Search' });
    type(within(sheet).getByRole('textbox', { name: 'Search entries and actions' }), 'duplicate');
    expect(await within(sheet).findByText('Nothing matches “duplicate”.')).toBeDefined();
  });
});

describe('counts on rows', () => {
  it('says how many entries point at an entry, nothing at zero', async () => {
    renderApp({
      files: { ...files(), 'cms/content/post/second.md': '---\ntitle: Second\nauthor: author/jane\n---\n' },
    });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'jane');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('Jane TireAuthor · 2 posts'));
    // Posts can be pointed at by nothing: no count.
    type(field, 'second');
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('SecondPost'));
  });

  it('names the referring collection when its labels have a plural: Tag · 4 posts', async () => {
    const out = files();
    const schema = JSON.parse(out['cms/schema.json'] as string);
    schema.collections.post.pluralLabel = 'Posts';
    out['cms/schema.json'] = JSON.stringify(schema, null, 2);
    out['cms/content/post/second.md'] = '---\ntitle: Second\nauthor: author/jane\n---\n';
    renderApp({ files: out });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'jane');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('Jane TireAuthor · 2 posts'));
  });

  it('a failed file counts nothing and does not hide the counts of the others', async () => {
    const source = createMemorySource(files());
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation(async (path) => {
      if (path.endsWith('post/tires.md')) throw new Error('Network request failed');
      return read(path);
    });
    renderApp({ source });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'jane');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    // One post failed to load; the other still counts, and the count is not stuck waiting for the failed one.
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('Jane TireAuthor · 1 post'));
  });

  it('shows no count while a file of a referring collection is still loading', async () => {
    const source = createMemorySource(files());
    const read = source.readFile.bind(source);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(source, 'readFile').mockImplementation(async (path) => {
      if (path.endsWith('post/tires.md')) await held;
      return read(path);
    });
    renderApp({ source });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'jane');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('Jane TireAuthor'));
    release();
    await waitFor(() => expect(within(list).getByRole('link').textContent).toBe('Jane TireAuthor · 1 post'));
  });
});

describe('the loading line', () => {
  it('reads no title on opening; from the first character typed counts them up, also with the field cleared', async () => {
    const source = createMemorySource(files());
    const read = source.readFile.bind(source);
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const reads = vi.spyOn(source, 'readFile').mockImplementation(async (path) => {
      if (path.endsWith('post/tires.md')) await held;
      return read(path);
    });
    renderApp({ source });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    reads.mockClear();
    const { sheet, field } = await openSearch();
    expect(await within(sheet).findByText(/^Type a title, an address or an action\. 4 entries\./)).toBeDefined();
    // Time for the fingerprints and a batch, had one been asked for.
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(reads).not.toHaveBeenCalled();
    type(field, 't');
    type(field, '');
    expect(await within(sheet).findByText('Loading titles: 3 of 4.', { selector: 'p' })).toBeDefined();
    expect(sheet.querySelector('output')!.textContent).toBe('Loading titles: 3 of 4.');
    release();
    expect(await within(sheet).findByText(/^Type a title, an address or an action\. 4 entries\./)).toBeDefined();
  });

  it('says some titles did not load when a read fails; the row keeps its address', async () => {
    const source = createMemorySource(files());
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation(async (path) => {
      if (path.endsWith('post/tires.md')) throw new Error('Network request failed');
      return read(path);
    });
    renderApp({ source });
    await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
    const { sheet, field } = await openSearch();
    type(field, 'tires');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    expect(within(list).getByRole('link').textContent).toBe('tiresPost');
    await waitFor(() => expect(sheet.querySelector('output')!.textContent).toBe('1 entry. Some titles did not load.'));
    type(field, '');
    expect(await within(sheet).findByText('Some titles did not load.', { selector: 'p' })).toBeDefined();
  });
});
