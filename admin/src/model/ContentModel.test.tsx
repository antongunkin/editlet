import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute } from '../../../loader/protocol';
import { fixtureFiles, renderApp } from '../test/render';

const main = () => screen.getByRole('main');
const section = (name: string) => within(main()).getByRole('region', { name });

async function openModel(opts: Parameters<typeof renderApp>[0] = {}) {
  const utils = renderApp({ route: 'schema', ...opts });
  await within(main()).findByRole('heading', { name: 'Content model' });
  await within(main()).findByRole('region', { name: 'Post' });
  return utils;
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
function stubClipboard(writeText: () => Promise<void>) {
  const fn = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: fn }, configurable: true });
  return fn;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
  window.history.replaceState(null, '', '/');
});

describe('ContentModel', () => {
  it('shows a section per collection with fields and references', async () => {
    await openModel();
    expect(within(main()).getByRole('heading', { name: 'Content model' })).toBeDefined();
    const post = section('Post');
    const table = within(post).getByRole('table');
    const authorRow = within(table).getByText('author').closest('tr')!;
    expect(authorRow.textContent).toContain('reference → Author');
    expect(within(section('Author')).getByText('.author').closest('li')!.textContent).toContain('Post.author');
    expect(section('Home page')).toBeDefined();
    expect(within(authorRow).getByText('Optional')).toBeDefined();
    const titleRow = within(table).getByText('title').closest('tr')!;
    expect(within(titleRow).getByLabelText('Required')).toBeDefined();
  });

  it('reports no problems for the fixture', async () => {
    await openModel();
    expect(await within(main()).findByText('No problems')).toBeDefined();
  });

  it('lists entry problems with a link to the entry', async () => {
    await openModel({
      files: { ...fixtureFiles(), 'cms/content/post/broken.md': '---\nauthor: author/nobody\n---\n' },
    });
    const link = await within(main()).findByRole('link', { name: 'cms/content/post/broken.md' });
    expect(link.getAttribute('href')).toContain('editlet=post/broken');
    expect(within(main()).getByText('title — Required')).toBeDefined();
    expect(within(main()).getByText('author — Referenced entry not found: author/nobody')).toBeDefined();
  });

  it('lists several non-entry files without duplicate-query warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await openModel({
      files: { ...fixtureFiles(), 'cms/content/post/a.txt': 'a', 'cms/content/post/b.txt': 'b' },
    });
    expect(await within(main()).findByText('cms/content/post/a.txt')).toBeDefined();
    expect(within(main()).getByText('cms/content/post/b.txt')).toBeDefined();
    expect(within(main()).getAllByText('Not an entry file')).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('lists an entry that fails to parse', async () => {
    await openModel({ files: { ...fixtureFiles(), 'cms/content/post/bad.md': '---\ntitle: [\n---\n' } });
    const link = await within(main()).findByRole('link', { name: 'cms/content/post/bad.md' });
    const item = link.parentElement!;
    expect(within(item).getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('marks a new field after the schema file changes', async () => {
    const { source, queryClient } = await openModel();
    expect(within(main()).queryByText(/^Updated/)).toBeNull();
    const schema = JSON.parse(fixtureFiles()['cms/schema.json'] as string);
    schema.collections.post.fields.subtitle = { type: 'string', label: 'Subtitle' };
    await source.commit([{ path: 'cms/schema.json', content: JSON.stringify(schema) }], 'm');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    const row = (await within(section('Post')).findByText('subtitle')).closest('tr')!;
    expect(within(row).getByText('New')).toBeDefined();
    expect(within(section('Post')).getByText('Changed')).toBeDefined();
    expect(within(main()).getByText(/^Updated/)).toBeDefined();
  });

  it('shows schema errors and keeps the last valid schema', async () => {
    const { source, queryClient } = await openModel();
    const text = fixtureFiles()['cms/schema.json'] as string;
    await source.commit([{ path: 'cms/schema.json', content: `${text}\n` }], 'touch');
    const read = source.readFile.bind(source);
    vi.spyOn(source, 'readFile').mockImplementation((p) =>
      p === 'cms/schema.json' ? Promise.resolve(new TextEncoder().encode('{')) : read(p),
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    expect(
      await within(main()).findByText('The schema file has errors. Showing the last valid version.'),
    ).toBeDefined();
    expect(section('Post')).toBeDefined();
  });

  it('polls the file list every 30 s in GitHub mode', async () => {
    const memory = createMemorySource(fixtureFiles());
    const listFiles = vi.fn(() => memory.listFiles());
    const source = { ...memory, kind: 'github' as const, listFiles };
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openModel({ source });
    const before = listFiles.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(listFiles.mock.calls.length).toBeGreaterThan(before);
  });

  it('adds no poll in local mode', async () => {
    const memory = createMemorySource(fixtureFiles());
    const listFiles = vi.fn(() => memory.listFiles());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openModel({ source: { ...memory, listFiles } });
    const before = listFiles.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    // local mode polls only through useFiles (every 2 s), not through the model screen's own interval
    expect(listFiles.mock.calls.length - before).toBeLessThanOrEqual(15);
  });

  it('copies a prompt and shows Copied', async () => {
    const write = stubClipboard(() => Promise.resolve());
    await openModel();
    const card = within(main()).getByRole('region', { name: 'Ask Claude Code' });
    const prompt = within(card).getByText('Add a field').closest('li')!;
    fireEvent.click(within(prompt).getByRole('button', { name: 'Copy' }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'Add an optional string field "subtitle" (label "Subtitle") to the "post" collection in cms/schema.json.',
      ),
    );
    expect(await within(prompt).findByRole('button', { name: 'Copied' })).toBeDefined();
  });

  it('says Copy failed when the clipboard rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await openModel();
    const card = within(main()).getByRole('region', { name: 'Ask Claude Code' });
    const prompt = within(card).getByText('Add a field').closest('li')!;
    fireEvent.click(within(prompt).getByRole('button', { name: 'Copy' }));
    expect(await within(prompt).findByRole('button', { name: 'Copy failed' })).toBeDefined();
  });

  it('copies the schema', async () => {
    const write = stubClipboard(() => Promise.resolve());
    await openModel();
    fireEvent.click(within(main()).getByRole('button', { name: 'Copy schema' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const arg = (write.mock.calls[0] as unknown as [string])[0];
    expect(JSON.parse(arg).collections.post.label).toBe('Post');
  });

  it('renders an empty schema', async () => {
    const schema = JSON.stringify({ contentDir: 'cms/content', git: { baseBranch: 'main' }, collections: {} });
    renderApp({ route: 'schema', files: { 'cms/schema.json': schema } });
    expect(await within(main()).findByText('No collections')).toBeDefined();
  });

  it('links to it from the navigation menu', async () => {
    renderApp();
    const link = await screen.findByRole('link', { name: 'Content model', hidden: true });
    fireEvent.click(link);
    expect(readEditletRoute(window.location.href)).toBe('schema');
    expect(await within(main()).findByRole('heading', { name: 'Content model' })).toBeDefined();
  });
});

describe('ContentModel ids and focus', () => {
  it('keeps ids unique when a collection is keyed like a fixed block', async () => {
    const schema = JSON.stringify({
      contentDir: 'cms/content',
      git: { baseBranch: 'main' },
      collections: { problems: { label: 'Problems things', fields: { name: { type: 'string', label: 'Name' } } } },
    });
    renderApp({ route: 'schema', files: { 'cms/schema.json': schema } });
    await within(main()).findByRole('region', { name: 'Problems things' });
    expect(document.querySelectorAll('[id="editlet-model-c-problems"]')).toHaveLength(1);
    expect(document.querySelectorAll('[id="editlet-model-problems"]')).toHaveLength(1);
  });

  it('moves focus into the target card on a jump', async () => {
    Element.prototype.scrollIntoView = vi.fn();
    await openModel();
    const table = within(main()).getAllByRole('table')[0]!;
    fireEvent.click(within(table).getByRole('button', { name: 'Author' }));
    expect(section('Author').contains(document.activeElement)).toBe(true);
  });
});
