import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fixtureFiles, HOME_LOADED, renderApp } from '../test/render';

// The status words on a search row (docs/admin/search.md#what-it-shows): `Post · Draft · Unsaved`, `Post · Changed`.

const state = vi.hoisted(() => ({
  unsaved: [] as string[],
  review: [] as string[],
  changed: [] as string[],
}));

vi.mock('../status/useFileStatus', async (importOriginal) => {
  const original = await importOriginal<typeof import('../status/useFileStatus')>();
  return {
    ...original,
    useFileStatuses: () =>
      original.fileStatuses({ unsaved: state.unsaved, review: state.review, changed: state.changed, ready: true }),
  };
});

function files() {
  const out = fixtureFiles();
  const schema = JSON.parse(out['cms/schema.json'] as string);
  schema.collections.post.titleField = 'title';
  out['cms/schema.json'] = JSON.stringify(schema, null, 2);
  out['cms/content/post/tires.md'] = '---\ntitle: Tires for a rigid bike\ndraft: true\n---\nBody\n';
  return out;
}

afterEach(() => {
  state.unsaved = [];
  state.review = [];
  state.changed = [];
  window.history.replaceState(null, '', '/');
});

async function rowOf(query: string) {
  renderApp({ files: files() });
  await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  const sheet = await screen.findByRole('dialog', { name: 'Search' });
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Search entries and actions' }), {
    target: { value: query },
  });
  const list = await within(sheet).findByRole('list', { name: 'Entries' });
  return within(list).getAllByRole('link')[0]!;
}

describe('status words on rows', () => {
  it('has none for a file with no status', async () => {
    expect((await rowOf('hello')).textContent).toBe('Hello worldPost');
  });

  it('says Changed, In review or Unsaved after Draft; Unsaved wins over Changed', async () => {
    state.changed = ['cms/content/post/hello-world.md', 'cms/content/post/tires.md'];
    state.unsaved = ['cms/content/post/tires.md'];
    expect((await rowOf('tires')).textContent).toBe('Tires for a rigid bikePost · Draft · Unsaved');
  });

  it('In review and Changed', async () => {
    state.review = ['cms/content/post/hello-world.md'];
    state.changed = ['cms/content/post/hello-world.md'];
    const row = await rowOf('hello');
    await waitFor(() => expect(row.textContent).toBe('Hello worldPost · In review'));
  });
});
