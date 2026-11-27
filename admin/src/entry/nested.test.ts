// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryToForm, formToEntry, ITEM_KEY, newItem, serializeEntry } from './values';

import { parseEntryFile } from '../../../core/entryFile';
import { parseSchemaText } from '../../../core/schema';
import { summarizeEntry } from '../../../core/summary';
import { entryEdits } from '../media/edits';
import { buildMediaIndex } from '../media/mediaIndex';

const root = join(import.meta.dirname, '../../../__fixtures__/survey');
const schema = parseSchemaText(readFileSync(join(root, 'cms/schema.json'), 'utf8'), 'cms/schema.json');
const page = schema.collections.page!;
const PATH = 'cms/content/page/landing.md';
const text = readFileSync(join(root, PATH), 'utf8');
const file = parseEntryFile(text);

describe('form values of object and blocks', () => {
  it('round-trips the landing page unchanged, and the file bytes too', () => {
    const values = entryToForm(page, file);
    const back = formToEntry(page, values);
    expect(back.issues).toEqual([]);
    expect(back.data).toEqual(file.data);
    expect(serializeEntry(page, back.data, back.body, Object.keys(file.data))).toBe(text);
  });

  it('gives list items a UI key that never reaches the data', () => {
    const values = entryToForm(page, file);
    const blocks = values.content as Record<string, unknown>[];
    expect(blocks.every((b) => typeof b[ITEM_KEY] === 'string')).toBe(true);
    expect(new Set(blocks.map((b) => b[ITEM_KEY])).size).toBe(blocks.length);
    expect(JSON.stringify(formToEntry(page, values).data)).not.toContain(ITEM_KEY);
  });

  it('shows an absent object as empty fields and writes nothing for it', () => {
    const values = entryToForm(page, { data: { title: 'x' }, body: '' });
    expect(values.seo).toEqual({ title: '', description: '' });
    expect(values.content).toEqual([]);
    expect(formToEntry(page, values).data).toEqual({ title: 'x' });
  });

  it('adds a block of a kind, and drops empty values inside it', () => {
    const values = entryToForm(page, { data: { title: 'x' }, body: '' });
    const field = page.fields.content!;
    const quote = newItem(field, 'quote');
    expect(quote).toMatchObject({ block: 'quote', text: '', by: { name: '', role: '' } });
    values.content = [{ ...quote, text: 'Hi', by: { name: 'Jo', role: '' } }];
    expect(formToEntry(page, values).data).toEqual({
      title: 'x',
      content: [{ block: 'quote', text: 'Hi', by: { name: 'Jo' } }],
    });
  });

  it('keeps an invalid JSON message on its nested path', () => {
    const withJson = parseSchemaText(
      JSON.stringify({
        contentDir: 'c',
        git: { baseBranch: 'main' },
        collections: {
          p: { label: 'P', fields: { o: { type: 'object', label: 'O', fields: { j: { type: 'json', label: 'J' } } } } },
        },
      }),
      's.json',
    ).collections.p!;
    expect(formToEntry(withJson, { o: { j: '{nope' } }).issues).toEqual([{ path: 'o.j', message: 'Invalid JSON' }]);
  });
});

describe('media edits inside object and blocks', () => {
  const files = [
    { path: PATH, sha: 'a' },
    { path: 'cms/content/page/landing/hero.webp', sha: 'h' },
    { path: 'cms/content/page/landing/chart.webp', sha: 'c' },
  ];
  const read = new Map([[PATH, { file, sha: 'a', keyOrder: Object.keys(file.data) }]]);
  const index = buildMediaIndex(schema, files, new Map([[PATH, summarizeEntry(schema, 'page', file)]]));

  it('lists nested uses with their labels', () => {
    const hero = index.images.find((i) => i.name === 'hero.webp')!;
    expect(hero.uses.map((u) => [u.field, u.label])).toEqual([['content.0.image', 'Image (content.0)']]);
  });

  it('changes alt and src in a nested image field and in a nested Markdown string, nothing else', () => {
    const hero = index.images.find((i) => i.name === 'hero.webp')!.uses[0]!;
    const chart = index.images.find((i) => i.name === 'chart.webp')!.uses[0]!;
    const [change] = entryEdits(
      schema,
      index,
      [
        { use: hero, alt: 'A crowd' },
        { use: chart, src: 'landing/chart-2.webp', alt: 'Chart' },
      ],
      read,
    );
    const after = change!.content as string;
    expect(after).toBe(
      text
        .replace('alt: People talking', 'alt: A crowd')
        .replace('![Chart of answers](landing/chart.webp)', '![Chart](landing/chart-2.webp)'),
    );
  });
});
