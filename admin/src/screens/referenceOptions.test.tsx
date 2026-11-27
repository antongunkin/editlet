// What an entry form reads for its reference fields (docs/admin/entry-form.md): the chosen entries with the form, a
// target collection when its picker opens.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { openField, renderApp, rowText, sheet } from '../test/render';

const ref = (label: string, collection: string, extra = {}) => ({
  type: 'reference',
  label,
  collections: [collection],
  ...extra,
});
const named = (label: string) => ({
  label,
  titleField: 'name',
  fields: { name: { type: 'string', label: 'Name', required: true } },
});

const SCHEMA = {
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    author: named('Author'),
    tag: named('Tag'),
    post: {
      label: 'Post',
      titleField: 'title',
      fields: {
        title: { type: 'string', label: 'Title', required: true },
        author: ref('Author', 'author'),
        tags: ref('Tags', 'tag', { multiple: true }),
        meta: { type: 'object', label: 'Meta', fields: { editor: ref('Editor', 'author') } },
        content: {
          type: 'blocks',
          label: 'Content',
          blocks: { quote: { label: 'Quote', fields: { by: ref('Quoted', 'author') } } },
        },
      },
    },
  },
};

const entry = (...lines: string[]) => `---\n${lines.join('\n')}\n---\n`;
const FILES: Record<string, string> = {
  'cms/schema.json': JSON.stringify(SCHEMA),
  ...Object.fromEntries(
    ['ada', 'bo', 'cy', 'dee', 'eve'].map((s) => [`cms/content/author/${s}.md`, entry(`name: Writer ${s}`)]),
  ),
  ...Object.fromEntries(['one', 'two'].map((s) => [`cms/content/tag/${s}.md`, entry(`name: Label ${s}`)])),
  'cms/content/post/a.md': entry(
    'title: A',
    'author: author/ada',
    'tags: [tag/one]',
    'meta:\n  editor: author/bo',
    'content:\n  - block: quote\n    by: author/cy',
  ),
  'cms/content/post/broken.md': entry('title: Broken', 'author: author/gone', 'tags: [tag/gone]'),
};

/** The site in memory, counting the entry files read; `hold` keeps the next reads waiting until `release`. */
function countingSource() {
  const source = createMemorySource(FILES, 'cms/schema.json', { batch: true });
  const read = new Set<string>();
  let gate: Promise<void> | undefined;
  let open = () => {};
  const readFiles = source.readFiles.bind(source);
  const readFile = source.readFile.bind(source);
  const note = (path: string) => {
    if (path.endsWith('.md')) read.add(path.slice('cms/content/'.length, -'.md'.length));
  };
  source.readFiles = async (paths) => {
    paths.forEach(note);
    await gate;
    return readFiles(paths);
  };
  source.readFile = (path) => {
    note(path);
    return readFile(path);
  };
  return {
    source,
    read: () => [...read].toSorted(),
    hold: () => {
      gate = new Promise((resolve) => (open = resolve));
    },
    release: async () => {
      await act(async () => open());
    },
  };
}

async function openPost(slug = 'a') {
  const site = countingSource();
  renderApp({ source: site.source, route: `post/${slug}` });
  await screen.findByRole('button', { name: /^Author/ });
  return site;
}

const CHOSEN = ['author/ada', 'author/bo', 'author/cy', 'post/a', 'tag/one'];

describe('reference options of an entry form', () => {
  it('reads the entry and the entries its values name, at every depth, and titles them', async () => {
    const site = await openPost();
    await waitFor(() => expect(rowText('Author')).toContain('Writer ada'));
    expect(rowText('Tags')).toContain('Label one');
    expect(site.read()).toEqual(CHOSEN);
  });

  it('reads a target collection when its picker opens', async () => {
    const site = await openPost();
    await waitFor(() => expect(rowText('Author')).toContain('Writer ada'));
    const picker = await openField('Author');
    await picker.findByRole('radio', { name: /^Writer dee/ });
    expect(site.read()).toEqual([...CHOSEN, 'author/dee', 'author/eve'].toSorted());
  });

  it('lists by address while the options load, with a loading row where nothing matches yet', async () => {
    const site = await openPost();
    await waitFor(() => expect(rowText('Author')).toContain('Writer ada'));
    site.hold();
    const picker = await openField('Author');
    // A chosen entry has its title; the rest are their slugs until read.
    expect(picker.getByRole('radio', { name: /^Writer ada/ })).toBeDefined();
    expect(picker.getByRole('radio', { name: /^dee/ })).toBeDefined();
    expect(picker.queryByText(/^Not found/)).toBeNull();
    const search = picker.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'author/ev' } });
    expect(picker.getAllByRole('radio')).toHaveLength(1);
    // A word of a title still unread: not "No entries match" yet.
    fireEvent.change(search, { target: { value: 'writer eve' } });
    expect(picker.getByText('Loading…')).toBeDefined();
    expect(picker.queryByText('No entries match')).toBeNull();
    await site.release();
    await picker.findByRole('radio', { name: /^Writer eve/ });
    expect(picker.queryByText('Loading…')).toBeNull();
  });

  it('says Not found for a broken reference only once the options have loaded', async () => {
    const site = await openPost('broken');
    // The file list alone says so in the row.
    expect(rowText('Author')).toContain('Not found: author/gone');
    site.hold();
    const picker = await openField('Author');
    expect(picker.queryByText('Not found: author/gone')).toBeNull();
    await site.release();
    expect(await picker.findByText('Not found: author/gone')).toBeDefined();
  });

  it('the same for a list of references', async () => {
    const site = await openPost('broken');
    site.hold();
    const chosen = within((await openField('Tags')).getByRole('list', { name: 'Tags selected' }));
    expect(chosen.getAllByText('tag/gone').length).toBeGreaterThan(0);
    expect(chosen.queryByText('Not found: tag/gone')).toBeNull();
    await site.release();
    expect(await chosen.findByText('Not found: tag/gone')).toBeDefined();
    expect(site.read()).toEqual(['post/broken', 'tag/one', 'tag/two']);
  });

  it('works in a picker inside an object and inside a block', async () => {
    const site = await openPost();
    const meta = await openField('Meta');
    await waitFor(() => expect(rowText('Editor', meta)).toContain('Writer bo'));
    expect(site.read()).toEqual(CHOSEN);
    const editor = await openField('Editor', meta);
    expect(await editor.findByRole('radio', { name: /^Writer dee/ })).toBeDefined();

    fireEvent.click(editor.getByRole('radio', { name: /^Writer eve/ }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull());
    expect(rowText('Editor', meta)).toContain('Writer eve');
    fireEvent.click(meta.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Meta' })).toBeNull());

    const content = await openField('Content');
    fireEvent.click(content.getByRole('button', { name: /^Quote/ }));
    const quote = await sheet(/^Quote/);
    expect(rowText('Quoted', quote)).toContain('Writer cy');
    const quoted = await openField('Quoted', quote);
    expect(quoted.getByRole('radio', { name: /^Writer cy/, checked: true })).toBeDefined();
    expect(quoted.getByRole('radio', { name: /^Writer dee/ })).toBeDefined();
  });
});
