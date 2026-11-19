import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { fixtureFiles, HOME_LOADED, renderApp } from '../test/render';

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
  window.history.replaceState(null, '', '/');
});

async function home(extraPosts = 0) {
  renderApp({ files: files(extraPosts) });
  await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
}

async function openSearch() {
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const sheet = await screen.findByRole('dialog', { name: 'Search' });
  return { sheet, field: within(sheet).getByRole('textbox', { name: 'Search entries' }) as HTMLInputElement };
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
    expect(within(sheet).getByText(/Type a title or an address\. 4 entries\./)).toBeDefined();
  });

  it('lists the entries of every collection that match a title word or the address, the top result first', async () => {
    await home();
    const { sheet, field } = await openSearch();
    type(field, 'tir');
    const list = await within(sheet).findByRole('list', { name: 'Entries' });
    const rows = within(list).getAllByRole('link');
    // The title starts with it, then a word of a title; the address of the third is only a substring.
    expect(rows.map((r) => r.textContent)).toEqual(['Tires for a rigid bikePost · Draft', 'Jane TireAuthor']);
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
    expect(await within(sheet).findByText('No entry matches “zzz”.')).toBeDefined();
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
    const field = within(sheet).getByRole('textbox', { name: 'Search entries' });
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
    const field = within(sheet).getByRole('textbox', { name: 'Search entries' });
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
