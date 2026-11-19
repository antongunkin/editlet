import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute } from '../../../loader/protocol';
import { fixtureFiles, renderApp } from '../test/render';

const main = () => screen.getByRole('main');
const row = (name: string | RegExp) => within(main()).getByRole('button', { name });

async function openModel(opts: Parameters<typeof renderApp>[0] = {}) {
  const utils = renderApp({ route: 'schema', ...opts });
  await within(main()).findByRole('heading', { name: 'Content model', level: 1 });
  await within(main()).findByRole('button', { name: /^Post/ });
  return utils;
}

/** Opens a collection's sheet from its row. */
async function openCollection(title: string) {
  fireEvent.click(row(new RegExp(`^${title}`)));
  return within(await screen.findByRole('dialog', { name: title }));
}

/** The CTA of the bottom bar opens the sheet of prompts for the whole model. */
async function openAsk(cta: string | RegExp = 'Ask Claude Code') {
  fireEvent.click(await within(main()).findByRole('button', { name: cta }));
  return within(await screen.findByRole('dialog', { name: 'Ask Claude Code' }));
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
  it('lists a row per collection with its counts and opens its fields in a sheet', async () => {
    await openModel();
    expect(within(main()).getByRole('heading', { name: /^Collections · \d+$/ })).toBeDefined();
    expect(row(/^Post/).textContent).toMatch(/post · 1 entry · \d+ fields/);
    expect(row(/^Home page/).textContent).toContain('Singleton');

    const post = await openCollection('Post');
    const fields = post.getByRole('list', { name: 'Post fields' });
    const authorRow = within(fields)
      .getByText(/^author · reference → author/)
      .closest('li')!;
    expect(authorRow.textContent).toContain('Author');
    expect(authorRow.textContent).not.toContain('Required');
    const titleRow = within(fields)
      .getByText(/^title · string/)
      .closest('li')!;
    expect(within(titleRow).getByText('Required', { exact: false })).toBeDefined();
    expect(within(titleRow).getByText('Title')).toBeDefined();
    expect(post.getByRole('link', { name: /^Open 1 entry/ }).getAttribute('href')).toContain('editlet=post');
  });

  it('shows who points at a collection and opens that one in the same sheet', async () => {
    await openModel();
    const author = await openCollection('Author');
    const referenced = author.getByRole('list', { name: 'Collections that point at Author' });
    expect(within(referenced).getByText('.author · one')).toBeDefined();
    fireEvent.click(within(referenced).getByRole('button', { name: /^Post/ }));
    expect(await screen.findByRole('dialog', { name: 'Post' })).toBeDefined();
  });

  it('lists the collections a collection points at and opens one in the same sheet', async () => {
    await openModel();
    const post = await openCollection('Post');
    const references = post.getByRole('list', { name: 'Collections that Post points at' });
    fireEvent.click(within(references).getByRole('button', { name: /^Author/ }));
    expect(await screen.findByRole('dialog', { name: 'Author' })).toBeDefined();
  });

  it('shows the field hint, and the directory next to Updated after a change', async () => {
    const { source, queryClient } = await openModel();
    const schema = JSON.parse(fixtureFiles()['cms/schema.json'] as string);
    schema.collections.post.fields.subtitle = { type: 'string', label: 'Subtitle', hint: 'Under the title.' };
    await source.commit([{ path: 'cms/schema.json', content: JSON.stringify(schema) }], 'm');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));
    await waitFor(() => expect(row(/^Post/).textContent).toContain('Changed'));
    const post = await openCollection('Post');
    expect(post.getByText('Under the title.')).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Post' }).textContent).toMatch(/post · cms\/content\/post\/ · Updated /);
  });

  it('reports no problems for the fixture', async () => {
    await openModel();
    expect(await within(main()).findByText('No problems')).toBeDefined();
    expect(within(main()).queryByRole('region', { name: 'Problems' })).toBeNull();
    expect(within(main()).getByRole('button', { name: 'Ask Claude Code' })).toBeDefined();
  });

  it('lists entry problems with a link to the entry and counts them', async () => {
    await openModel({
      files: { ...fixtureFiles(), 'cms/content/post/broken.md': '---\nauthor: author/nobody\n---\n' },
    });
    const link = await within(main()).findByRole('link', { name: 'cms/content/post/broken.md' });
    expect(link.getAttribute('href')).toContain('editlet=post/broken');
    expect(within(main()).getByText('title — Required')).toBeDefined();
    expect(within(main()).getByText('author — Referenced entry not found: author/nobody')).toBeDefined();
    expect(within(main()).getByText('2 problems')).toBeDefined();
    expect(within(main()).getByRole('button', { name: 'Fix with Claude Code' })).toBeDefined();
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
    expect(within(main()).queryByText(/Updated/)).toBeNull();
    const schema = JSON.parse(fixtureFiles()['cms/schema.json'] as string);
    schema.collections.post.fields.subtitle = { type: 'string', label: 'Subtitle' };
    await source.commit([{ path: 'cms/schema.json', content: JSON.stringify(schema) }], 'm');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    await waitFor(() => expect(row(/^Post/).textContent).toContain('Changed'));
    expect(within(main()).getByText(/Updated/)).toBeDefined();
    const post = await openCollection('Post');
    const subtitle = (await post.findByText(/^subtitle · string/)).closest('li')!;
    expect(within(subtitle).getByText('New')).toBeDefined();
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
    expect(row(/^Post/)).toBeDefined();
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

  it('copies a collection prompt and says Copied', async () => {
    const write = stubClipboard(() => Promise.resolve());
    await openModel();
    const post = await openCollection('Post');
    fireEvent.click(post.getByRole('button', { name: /^Change Post with Claude Code/ }));
    const ask = within(await screen.findByRole('dialog', { name: 'Ask Claude Code' }));
    fireEvent.click(ask.getByRole('button', { name: 'Copy', description: 'Add a field' }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'Add an optional string field "subtitle" (label "Subtitle") to the "post" collection in cms/schema.json.',
      ),
    );
    expect(await ask.findByRole('button', { name: 'Copied' })).toBeDefined();
  });

  it('says Copy failed when the clipboard rejects', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await openModel();
    const ask = await openAsk();
    fireEvent.click(ask.getByRole('button', { name: 'Copy', description: 'Add a collection' }));
    expect(await screen.findByText('Copy failed')).toBeDefined();
  });

  it('offers prompts for the whole model, the fix prompt first when there are problems', async () => {
    await openModel({
      files: { ...fixtureFiles(), 'cms/content/post/broken.md': '---\nauthor: author/nobody\n---\n' },
    });
    const ask = await openAsk('Fix with Claude Code');
    const titles = ask
      .getAllByRole('listitem')
      .map((li) => li.querySelector('[data-slot="prompt-row"] > span > span')!.textContent);
    expect(titles).toEqual(['Fix the problems', 'Add a collection', 'Review the schema']);
  });

  it('copies the schema from the ⋯ actions', async () => {
    const write = stubClipboard(() => Promise.resolve());
    await openModel();
    fireEvent.click(within(main()).getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy schema' }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const arg = (write.mock.calls[0] as unknown as [string])[0];
    expect(JSON.parse(arg).collections.post.label).toBe('Post');
    expect(await screen.findByText('Schema copied')).toBeDefined();
  });

  it('renders an empty schema', async () => {
    const schema = JSON.stringify({ contentDir: 'cms/content', git: { baseBranch: 'main' }, collections: {} });
    renderApp({ route: 'schema', files: { 'cms/schema.json': schema } });
    expect(await within(main()).findByText('No collections')).toBeDefined();
  });

  it('links to it from All content', async () => {
    renderApp();
    fireEvent.click(await within(main()).findByRole('link', { name: /^All content/ }));
    const link = await within(main()).findByRole('link', { name: /^Content model/ });
    fireEvent.click(link);
    expect(readEditletRoute(window.location.href)).toBe('schema');
    expect(await within(main()).findByRole('heading', { name: 'Content model', level: 1 })).toBeDefined();
  });
});
