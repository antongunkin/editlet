import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { pendingNewEntries } from '../entry/pending';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { createTestQueryClient, fixtureFiles, renderApp } from '../test/render';

/** The fixture site with `titleField: 'title'` on post and one extra draft post. */
function variantFiles(): Record<string, string | Uint8Array> {
  const files = fixtureFiles();
  const schema = JSON.parse(files['cms/schema.json'] as string) as {
    collections: Record<string, Record<string, unknown>>;
  };
  schema.collections.post!.titleField = 'title';
  files['cms/schema.json'] = JSON.stringify(schema, null, 2);
  files['cms/content/post/second-post.md'] = '---\ntitle: Second post\ndraft: true\n---\nDraft body\n';
  return files;
}

const main = () => screen.getByRole('main');
const editletRoute = () => readEditletRoute(window.location.href);

afterEach(() => {
  pendingNewEntries.clear();
  window.history.replaceState(null, '', '/');
});

describe('Home', () => {
  it('lists collections with counts and navigates to a collection', async () => {
    renderApp();
    const post = await within(main()).findByRole('link', { name: 'Post (1)' });
    expect(within(main()).getByRole('link', { name: 'Author (1)' })).toBeDefined();
    expect(within(main()).getByRole('link', { name: 'Home page' })).toBeDefined();

    fireEvent.click(post);
    expect(editletRoute()).toBe('post');
    expect(await within(main()).findByRole('heading', { name: 'Post' })).toBeDefined();
  });
});

describe('Collection', () => {
  const rowOf = (link: HTMLElement) => link.closest('tr')!;
  const titles = () =>
    within(main())
      .getAllByRole('row')
      .slice(1)
      .map((tr) => tr.querySelector('a')?.textContent);
  function mockHistory(byPath: (path: string) => object | null) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const body = url.pathname.endsWith('/history') ? byPath(url.searchParams.get('path')!) : null;
      return new Response(body ? JSON.stringify(body) : '{}', { status: body ? 200 : 404 });
    });
  }
  afterEach(() => vi.restoreAllMocks());

  it('a row: title and slug, a status dot, a dash without history; the count in the header', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const hello = rowOf(await within(main()).findByRole('link', { name: 'Hello world' }));
    expect(within(hello).getByText('hello-world')).toBeDefined();
    expect(within(hello).getByRole('img', { name: 'Published' })).toBeDefined();
    expect(within(hello).getAllByLabelText('Unknown')).toHaveLength(2);
    const draft = rowOf(within(main()).getByRole('link', { name: 'Second post' }));
    expect(within(draft).getByRole('img', { name: 'Draft' })).toBeDefined();
    expect(within(main()).getByText('2 entries')).toBeDefined();
  });

  it('Updated and By come from the git history; newest first by default', async () => {
    mockHistory((path) => ({
      updated: path.endsWith('second-post.md')
        ? { actor: { name: 'Ann Lee' }, date: '2025-11-19T14:48:00Z', message: 'm' }
        : { actor: { name: 'Bob Stone' }, date: '2025-10-02T09:00:00Z', message: 'm' },
      created: null,
      commits: 1,
    }));
    renderApp({ files: variantFiles(), route: 'post' });
    const second = rowOf(await within(main()).findByRole('link', { name: 'Second post' }));
    expect(await within(second).findByRole('img', { name: 'Ann Lee' })).toBeDefined();
    expect(within(second).getByText('Nov 19, 2025')).toBeDefined();
    expect(titles()).toEqual(['Second post', 'Hello world']);
  });

  it('a column header sorts, and a second click reverses', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('link', { name: 'Hello world' });
    const title = within(main()).getByRole('button', { name: 'Title' });
    fireEvent.click(title);
    expect(titles()).toEqual(['Hello world', 'Second post']);
    expect(title.closest('th')!.getAttribute('aria-sort')).toBe('ascending');
    fireEvent.click(title);
    expect(titles()).toEqual(['Second post', 'Hello world']);
    expect(title.closest('th')!.getAttribute('aria-sort')).toBe('descending');
  });

  it('shows 20 rows per page with a pager', async () => {
    const files = variantFiles();
    for (let i = 10; i < 33; i++) files[`cms/content/post/p${i}.md`] = `---\ntitle: Post ${i}\n---\n`;
    renderApp({ files, route: 'post' });
    await within(main()).findByRole('link', { name: 'Hello world' });
    fireEvent.click(within(main()).getByRole('button', { name: 'Title' }));
    expect(within(main()).getAllByRole('row')).toHaveLength(21);
    const pager = within(main()).getByRole('navigation', { name: 'Pages' });
    expect(within(pager).getByText('1–20 of 25')).toBeDefined();
    fireEvent.click(within(pager).getByRole('button', { name: 'Next page' }));
    expect(within(main()).getAllByRole('row')).toHaveLength(6);
    expect(within(pager).getByText('21–25 of 25')).toBeDefined();
    expect((within(pager).getByRole('button', { name: 'Next page' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a row click opens the entry route', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const hello = rowOf(await within(main()).findByRole('link', { name: 'Hello world' }));
    fireEvent.click(within(hello).getByText('hello-world'));
    expect(editletRoute()).toBe('post/hello-world');
    expect(await within(main()).findByText('Meta')).toBeDefined();
  });

  it('a singleton route renders the entry screen', async () => {
    renderApp({ route: 'homePage' });
    expect(await within(main()).findByText('Meta')).toBeDefined();
  });
});

describe('NewEntryDialog', () => {
  it('auto-fills the slug from the title and navigates on Confirm', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    fireEvent.click(await within(main()).findByRole('button', { name: 'New entry' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'My Post' } });
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('my-post');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(editletRoute()).toBe('post/my-post');
    expect(pendingNewEntries.get('post/my-post')).toEqual({ title: 'My Post' });
    expect(await within(main()).findByText('Meta')).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('rejects an existing or invalid slug', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    fireEvent.click(await within(main()).findByRole('button', { name: 'New entry' }));
    const dialog = await screen.findByRole('dialog');
    const slug = within(dialog).getByLabelText('Slug');
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' }) as HTMLButtonElement;

    fireEvent.change(slug, { target: { value: 'hello-world' } });
    expect(within(dialog).getByText('Slug already exists')).toBeDefined();
    expect(confirm.disabled).toBe(true);

    fireEvent.change(slug, { target: { value: 'Not A Slug' } });
    expect(within(dialog).getByText('Invalid slug')).toBeDefined();
    expect(confirm.disabled).toBe(true);

    // An edited slug no longer follows the title.
    fireEvent.change(slug, { target: { value: 'kept' } });
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Other title' } });
    expect((slug as HTMLInputElement).value).toBe('kept');
    expect(confirm.disabled).toBe(false);
  });
});

describe('other routes', () => {
  it('schema renders the content model', async () => {
    renderApp({ route: 'schema' });
    expect(await within(main()).findByRole('heading', { name: 'Content model' })).toBeDefined();
    expect(await within(main()).findByRole('region', { name: 'Post' })).toBeDefined();
  });

  it('branch:x renders the branch placeholder', async () => {
    renderApp({ route: 'branch:x' });
    expect(await within(main()).findByText('Branch preview is available in production mode')).toBeDefined();
  });

  it('a/b/c and an unknown collection render not found', async () => {
    const { unmount } = renderApp({ route: 'a/b/c' });
    expect(await within(main()).findByRole('heading', { name: 'Not found' })).toBeDefined();
    unmount();
    renderApp({ route: 'nope' });
    expect(await within(main()).findByRole('heading', { name: 'Not found' })).toBeDefined();
  });
});

describe('App', () => {
  it('shows the not-configured screen when the dev API and config.json answer 404', async () => {
    const fetch = (async () => new Response('Not found', { status: 404 })) as unknown as typeof globalThis.fetch;
    render(<App fetch={fetch} queryClient={createTestQueryClient()} />);
    expect(await screen.findByRole('heading', { name: 'Editing is not set up' })).toBeDefined();
  });

  it('shows the schema issues when the dev API reports a broken schema', async () => {
    const body = JSON.stringify({ issues: [{ file: 'cms/schema.json', path: '', message: 'Invalid JSON' }] });
    const fetch = (async () => new Response(body, { status: 500 })) as unknown as typeof globalThis.fetch;
    render(<App fetch={fetch} queryClient={createTestQueryClient()} />);
    expect(await screen.findByText('cms/schema.json: Invalid JSON')).toBeDefined();
  });
});

describe('Shell embedded', () => {
  it('Escape outside a dialog collapses the window into the pill; the pill’s × posts close', async () => {
    const fake = createFakeWindow();
    render(<App source={createMemorySource(fixtureFiles())} win={fake.win} queryClient={createTestQueryClient()} />);
    act(() => fake.fromSite({ type: 'init', route: '', site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
    await within(main()).findByRole('link', { name: 'Post (1)' });

    expect(screen.getByRole('button', { name: /^Switch to (light|dark) theme$/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeDefined();
    const sent = () => fake.parent.postMessage.mock.calls.map(([m]) => (m as { type: string }).type);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sent()).not.toContain('close');
    fireEvent.click(screen.getByRole('button', { name: 'Close Editlet' }));
    expect(sent()).toContain('close');
  });
});
