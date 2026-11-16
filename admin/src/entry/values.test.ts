import { describe, expect, it } from 'vitest';

import { author, post } from './testSchema';
import { entryToForm, formToEntry, isEntryChanged, serializeEntry, type FormValues } from './values';

import { parseEntryFile } from '../../../core/entryFile';
import { normalizeData } from '../../../core/validate';

const emptyPost = () => entryToForm(post, { data: {}, body: '' });

function toEntry(patch: FormValues) {
  return formToEntry(post, { ...emptyPost(), ...patch });
}

describe('entryToForm', () => {
  it('maps absent values to empty UI values', () => {
    expect(emptyPost()).toEqual({
      title: '',
      summary: '',
      tags: [],
      published: undefined,
      category: '',
      kinds: [],
      rating: '',
      publishedAt: '',
      meta: '',
      link: '',
      accent: '',
      cover: { src: '', alt: '' },
      author: '',
      related: [],
      draft: false,
      __body: '',
      __extra: {},
    });
  });

  it('maps present values to UI values', () => {
    const values = entryToForm(post, {
      data: {
        title: 'Hi',
        tags: ['a'],
        published: false,
        rating: 4.5,
        meta: { a: 1 },
        cover: { src: 'hi/c.png', alt: 'C' },
        related: ['post/x'],
        draft: true,
        legacy: 'x',
      },
      body: 'Body\n',
    });
    expect(values).toMatchObject({
      title: 'Hi',
      tags: ['a'],
      published: false,
      rating: '4.5',
      meta: '{\n  "a": 1\n}',
      cover: { src: 'hi/c.png', alt: 'C' },
      related: ['post/x'],
      draft: true,
      __body: 'Body\n',
      __extra: { legacy: 'x' },
    });
  });

  it('keeps raw non-string values so validation reports them', () => {
    const values = entryToForm(post, { data: { title: 5, tags: 'x' }, body: '' });
    expect(values.title).toBe(5);
    expect(values.tags).toBe('x');
    expect(formToEntry(post, values).data).toMatchObject({ title: 5, tags: 'x' });
  });

  it('omits __body for a collection without a markdown field and an empty body', () => {
    expect(entryToForm(author, { data: { name: 'Jane' }, body: '' })).toEqual({
      name: 'Jane',
      draft: false,
      __extra: {},
    });
  });

  it('carries a stray body through for a collection without a markdown field', () => {
    const values = entryToForm(author, { data: { name: 'Jane' }, body: 'stray' });
    expect(formToEntry(author, values).body).toBe('stray');
  });
});

describe('formToEntry', () => {
  it('number: empty is absent, numeric text is a number, other text stays text', () => {
    expect(toEntry({ rating: '' }).data).not.toHaveProperty('rating');
    expect(toEntry({ rating: ' 12 ' }).data.rating).toBe(12);
    expect(toEntry({ rating: 'abc' }).data.rating).toBe('abc');
  });

  it('json: parsed, or an Invalid JSON issue', () => {
    expect(toEntry({ meta: '{"a":1}' })).toMatchObject({ data: { meta: { a: 1 } }, issues: [] });
    const bad = toEntry({ meta: '{' });
    expect(bad.issues).toEqual([{ path: 'meta', message: 'Invalid JSON' }]);
    expect(bad.data).not.toHaveProperty('meta');
    expect(toEntry({ meta: '' }).data).not.toHaveProperty('meta');
  });

  it('image: both empty is absent', () => {
    expect(toEntry({ cover: { src: '', alt: '' } }).data).not.toHaveProperty('cover');
    expect(toEntry({ cover: { src: 'a/b.png', alt: '' } }).data.cover).toEqual({ src: 'a/b.png', alt: '' });
  });

  it('draft: false removes the key, true sets it', () => {
    expect(toEntry({ draft: false }).data).not.toHaveProperty('draft');
    expect(toEntry({ draft: true }).data.draft).toBe(true);
  });

  it('lists: an empty list is absent', () => {
    const { data } = toEntry({ tags: [], kinds: [], related: [] });
    expect(data).not.toHaveProperty('tags');
    expect(data).not.toHaveProperty('kinds');
    expect(data).not.toHaveProperty('related');
    expect(toEntry({ related: ['post/a'] }).data.related).toEqual(['post/a']);
  });

  it('strings: empty is absent (normalizeData), text is kept as is', () => {
    const { data } = toEntry({ title: ' Hi ', summary: '', author: 'author/jane' });
    expect(data).toEqual({ title: ' Hi ', author: 'author/jane' });
  });

  it('boolean: undefined is absent, false is kept', () => {
    expect(toEntry({ published: undefined }).data).not.toHaveProperty('published');
    expect(toEntry({ published: false }).data.published).toBe(false);
  });

  it('body comes from __body; __extra keys are merged back', () => {
    const { data, body } = toEntry({ title: 'T', __body: 'Hello', __extra: { legacy: 1, gone: null } });
    expect(body).toBe('Hello');
    expect(data).toEqual({ title: 'T', legacy: 1, gone: null });
  });

  it('keeps a null unknown key: not dirty on open, written back as null', () => {
    const original = parseEntryFile('---\ntitle: Hello\nlegacy: ~\n---\n');
    const baseline = formToEntry(post, entryToForm(post, original));
    expect(baseline.data).toEqual({ title: 'Hello', legacy: null });
    expect(isEntryChanged(formToEntry(post, entryToForm(post, original)), baseline)).toBe(false);
    expect(serializeEntry(post, baseline.data, baseline.body, Object.keys(original.data))).toContain('legacy: null');
  });

  it('round-trips every field type', () => {
    const data = {
      title: 'T',
      summary: 'S',
      tags: ['a', 'b'],
      published: true,
      category: 'news',
      kinds: ['a'],
      rating: 3,
      publishedAt: '2026-01-15T09:00:00Z',
      meta: [1, { b: 'x' }],
      link: 'https://example.com',
      accent: '#a1b2c3',
      cover: { src: 'hi/c.png', alt: 'C' },
      author: 'author/jane',
      related: ['post/x'],
      draft: true,
    };
    const out = formToEntry(post, entryToForm(post, { data, body: 'B' }));
    expect(out).toEqual({ data, body: 'B', issues: [] });
  });
});

describe('isEntryChanged', () => {
  it('isEntryChanged ignores formatting', () => {
    const original = parseEntryFile('---\ntitle: "Hello"\nauthor: author/jane\n---\nHi\n');
    const saved = { data: normalizeData(post, original.data), body: original.body };
    const edited = formToEntry(post, entryToForm(post, original));
    expect(isEntryChanged(saved, edited)).toBe(false);
  });

  it('isEntryChanged ignores non-schema key order', () => {
    const original = parseEntryFile('---\nauthor: author/jane\ntitle: Hello\nrating: 2\n---\n');
    const saved = { data: normalizeData(post, original.data), body: original.body };
    expect(isEntryChanged(saved, formToEntry(post, entryToForm(post, original)))).toBe(false);
  });

  it('detects data and body changes; key order does not matter', () => {
    const a = { data: { a: 1, b: { c: [1, 2] } }, body: 'x' };
    expect(isEntryChanged(a, { data: { b: { c: [1, 2] }, a: 1 }, body: 'x' })).toBe(false);
    expect(isEntryChanged(a, { data: { a: 1, b: { c: [2, 1] } }, body: 'x' })).toBe(true);
    expect(isEntryChanged(a, { data: { a: 1, b: { c: [1, 2] } }, body: 'y' })).toBe(true);
    expect(isEntryChanged(a, { data: { a: 1 }, body: 'x' })).toBe(true);
    expect(isEntryChanged({ data: {}, body: 'x\r\n' }, { data: {}, body: 'x\n' })).toBe(false);
  });
});

describe('serializeEntry', () => {
  it('keeps the original key order, then schema order, then draft', () => {
    const text = serializeEntry(post, { b: 1, a: 2, title: 'T', rating: 1, draft: true }, 'Hi\n', ['b', 'a', 'gone']);
    expect(text).toBe('---\nb: 1\na: 2\ntitle: T\nrating: 1\ndraft: true\n---\n\nHi\n');
  });

  it('keeps an original draft position', () => {
    expect(serializeEntry(author, { name: 'J', draft: true }, '', ['draft', 'name'])).toBe(
      '---\ndraft: true\nname: J\n---\n',
    );
  });
});
