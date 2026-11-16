import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadSchema, type Schema } from './schema';
import { buildDataSchema, initialData, normalizeData, validateEntry, type Entry } from './validate';

function schema(): Schema {
  return loadSchema({
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: {
      post: {
        label: 'Post',
        fields: {
          title: { type: 'string', label: 'Title', required: true, default: 'Untitled' },
          body: { type: 'markdown', label: 'Body' },
          tags: { type: 'string', label: 'Tags', list: true },
          kind: {
            type: 'select',
            label: 'Kind',
            options: [
              { label: 'A', value: 'a' },
              { label: 'B', value: 'b' },
            ],
          },
          kinds: {
            type: 'select',
            label: 'Kinds',
            multiple: true,
            options: [
              { label: 'A', value: 'a' },
              { label: 'B', value: 'b' },
            ],
          },
          count: { type: 'number', label: 'Count', min: 1, max: 10, integer: true },
          publishedAt: { type: 'datetime', label: 'At' },
          day: { type: 'datetime', label: 'Day', dateOnly: true },
          createdAt: { type: 'datetime', label: 'Created', defaultNow: true },
          createdDay: { type: 'datetime', label: 'Created day', dateOnly: true, defaultNow: true },
          link: { type: 'url', label: 'Link' },
          tint: { type: 'color', label: 'Tint', default: '#ffffff' },
          extra: { type: 'json', label: 'Extra' },
          featured: { type: 'boolean', label: 'Featured', default: false },
          featuredImage: { type: 'image', label: 'Image' },
          author: { type: 'reference', label: 'Author', collections: ['author'] },
          related: { type: 'reference', label: 'Related', collections: ['author'], multiple: true, min: 1, max: 3 },
        },
      },
      post2: {
        label: 'Post2',
        fields: {
          extra: { type: 'json', label: 'Extra', required: true },
          items: { type: 'string', label: 'I', list: true, required: true },
        },
      },
      author: { label: 'Author', fields: { name: { type: 'string', label: 'Name' } } },
      homePage: {
        label: 'Home',
        singleton: true,
        fields: {
          headline: { type: 'string', label: 'Headline' },
          body: { type: 'markdown', label: 'B', required: true },
        },
      },
    },
  });
}

const s = schema();
const ok = { title: 'Hi', related: ['author/a'] };

function run(data: Record<string, unknown>, extra: Partial<Entry> = {}, ctx = {}) {
  return validateEntry(s, { collection: 'post', slug: 'hello', data: { ...ok, ...data }, body: '', ...extra }, ctx);
}
const paths = (data: Record<string, unknown>, ctx = {}) => run(data, {}, ctx).map((i) => i.path);

const post2Issues = (data: Record<string, unknown>) =>
  validateEntry(s, { collection: 'post2', slug: 'a', data, body: '' }).map((i) => `${i.path}:${i.message}`);

const home = (slug: string) => validateEntry(s, { collection: 'homePage', slug, data: {}, body: 'x' });

describe('validateEntry', () => {
  it('passes a valid entry and stamps file', () => {
    expect(run({})).toEqual([]);
    expect(run({ title: '' })[0].file).toBe('cms/content/post/hello.md');
  });
  it('required string missing -> Required; empty counts as missing', () => {
    expect(run({ title: undefined })).toEqual([
      { file: 'cms/content/post/hello.md', path: 'title', message: 'Required' },
    ]);
    expect(paths({ title: '' })).toEqual(['title']);
    expect(paths({ title: null })).toEqual(['title']);
  });
  it('optional null and empty string are absent', () => {
    expect(paths({ link: null, kind: '', publishedAt: '', tint: '', count: null, author: '' })).toEqual([]);
  });
  it('string list accepts array, rejects string', () => {
    expect(paths({ tags: ['a'] })).toEqual([]);
    expect(paths({ tags: 'a' })).toEqual(['tags']);
  });
  it('select rejects unknown option; multiple requires array', () => {
    expect(run({ kind: 'z' })[0].message).toBe('Expected one of: a, b');
    expect(paths({ kind: 'a' })).toEqual([]);
    expect(paths({ kinds: 'a' })).toEqual(['kinds']);
    expect(paths({ kinds: ['a', 'b'] })).toEqual([]);
    expect(paths({ kinds: ['a', 'q'] })).toEqual(['kinds.1']);
  });
  it('number respects min/max/integer and rejects strings', () => {
    expect(paths({ count: 5 })).toEqual([]);
    expect(paths({ count: 0 })).toEqual(['count']);
    expect(paths({ count: 11 })).toEqual(['count']);
    expect(paths({ count: 1.5 })).toEqual(['count']);
    expect(paths({ count: '5' })).toEqual(['count']);
  });
  it('datetime formats', () => {
    for (const v of ['2026-01-01T10:00:00Z', '2026-01-01T10:00:00+02:00', '2026-01-01T10:00']) {
      expect(paths({ publishedAt: v })).toEqual([]);
    }
    expect(run({ publishedAt: 'yesterday' })[0].message).toBe('Invalid date');
    expect(paths({ day: '2026-01-01' })).toEqual([]);
    expect(paths({ day: '2026-01-01T10:00:00Z' })).toEqual(['day']);
  });
  it('url', () => {
    expect(paths({ link: 'https://x.y' })).toEqual([]);
    expect(paths({ link: '/about' })).toEqual([]);
    expect(paths({ link: 'javascript:alert(1)' })).toEqual(['link']);
    expect(paths({ link: '//evil.com' })).toEqual(['link']);
  });
  it('color', () => {
    expect(paths({ tint: '#a1b2c3' })).toEqual([]);
    expect(paths({ tint: 'red' })).toEqual(['tint']);
  });
  it('json accepts any value', () => {
    for (const v of [{ a: 1 }, [1], 'x', 3, true]) expect(paths({ extra: v })).toEqual([]);
  });
  it('boolean', () => {
    expect(paths({ featured: 'true' })).toEqual(['featured']);
    expect(paths({ featured: false })).toEqual([]);
  });
  it('image needs src and non-empty alt', () => {
    expect(paths({ featuredImage: { src: './a.png', alt: 'A' } })).toEqual([]);
    expect(paths({ featuredImage: { src: './a.png', alt: ' ' } })).toEqual(['featuredImage.alt']);
    expect(paths({ featuredImage: { src: './a.png', alt: 'A', x: 1 } })).toEqual(['featuredImage.x']);
    expect(paths({ featuredImage: 'a.png' })).toEqual(['featuredImage']);
  });
  it('required json and required list', () => {
    expect(post2Issues({ items: ['a'] })).toEqual(['extra:Required']);
    expect(post2Issues({ extra: null, items: ['a'] })).toEqual(['extra:Required']);
    expect(post2Issues({ extra: { a: 1 }, items: [] })).toEqual(['items:Required']);
    expect(post2Issues({ extra: 0, items: ['a'] })).toEqual([]);
  });
  it('reference max, whitespace-only required, optional "" non-string, absolute image src, bad data', () => {
    expect(run({ related: ['author/a', 'author/b', 'author/c', 'author/d'] })[0].path).toBe('related');
    expect(paths({ title: '   ' })).toEqual(['title']);
    expect(run({ count: '' })[0].message).toBe('Expected a number');
    expect(paths({ featuredImage: { src: '/x.png', alt: 'A' } })).toEqual(['featuredImage.src']);
    const bad = validateEntry(s, { collection: 'post', slug: 'a', data: null as never, body: '' });
    expect(bad).toHaveLength(1);
    expect(bad[0].path).toBe('');
  });
  it('image src escaping contentDir / missing file', () => {
    const issues = run({ featuredImage: { src: '../../../x.png', alt: 'A' } });
    expect(issues[0].path).toBe('featuredImage.src');
    expect(issues[0].message).toContain('outside');
    const missing = run({ featuredImage: { src: './a.png', alt: 'A' } }, {}, { fileExists: () => false });
    expect(missing[0].path).toBe('featuredImage.src');
    expect(missing[0].message).toContain('not found');
    let seen = '';
    run({ featuredImage: { src: './a.png', alt: 'A' } }, {}, { fileExists: (p: string) => ((seen = p), true) });
    expect(seen).toBe('cms/content/post/a.png');
  });
  it('image src must be a visible image file', () => {
    const txt = run({ featuredImage: { src: './notes.txt', alt: 'A' } });
    expect(txt.map((i) => i.path)).toEqual(['featuredImage.src']);
    expect(txt[0].message).toContain('image');
    const hidden = run({ featuredImage: { src: '.hidden/a.png', alt: 'A' } });
    expect(hidden.map((i) => i.path)).toEqual(['featuredImage.src']);
    expect(hidden[0].message).toContain('hidden');
    expect(paths({ featuredImage: { src: './.a.png', alt: 'A' } })).toEqual(['featuredImage.src']);
  });
  it('reference shape rules', () => {
    expect(paths({ author: 'author/' })).toEqual(['author']);
    expect(paths({ author: 'post/x' })).toEqual(['author']);
    expect(paths({ author: 'author/a' })).toEqual([]);
    expect(paths({ related: [] })).toEqual(['related']);
    expect(paths({ related: ['author/a', 'nope'] })).toEqual(['related.1']);
  });
  it('reference lists reject repeats, at the index of each repeat', () => {
    const issues = run({ related: ['author/a', 'author/b', 'author/a'] });
    expect(issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: 'related.2', message: 'Duplicate reference: author/a' },
    ]);
    expect(paths({ related: ['author/a', 'author/b'] })).toEqual([]);
  });
  it('reference existence', () => {
    const issues = run({ author: 'author/a' }, {}, { entryExists: () => false });
    expect(issues.map((i) => i.path)).toEqual(['author', 'related.0']);
    expect(issues[0].message).toContain('not found');
    expect(paths({ author: 'author/a' }, { entryExists: () => true })).toEqual([]);
    expect(paths({ author: 'nope' }, { entryExists: () => false })).toEqual(['author', 'related.0']);
  });
  it('unknown key', () => {
    expect(run({ foo: 1 }).map(({ path, message }) => ({ path, message }))).toEqual([
      { path: 'foo', message: 'Unknown field' },
    ]);
  });
  it('draft', () => {
    expect(paths({ draft: 'yes' })).toEqual(['draft']);
    expect(paths({ draft: true })).toEqual([]);
  });
  it('slug rules', () => {
    expect(run({}, { slug: 'Bad Slug' }).map((i) => i.path)).toEqual(['']);
    expect(home('index')).toEqual([]);
    expect(home('other')[0].path).toBe('');
    expect(home('other')[0].file).toBe('cms/content/homePage/index.md');
  });
  it('unknown collection', () => {
    expect(validateEntry(s, { collection: 'nope', slug: 'a', data: {}, body: '' })).toEqual([
      { path: '', message: expect.stringContaining('Unknown collection') },
    ]);
    expect(validateEntry(s, { collection: 'toString', slug: 'a', data: {}, body: '' })).toHaveLength(1);
  });
  it('body rules', () => {
    const h = (body: string) => validateEntry(s, { collection: 'homePage', slug: 'index', data: {}, body });
    expect(h('  \n')[0]).toMatchObject({ path: 'body', message: 'Required' });
    expect(h('hi')).toEqual([]);
    const issues = run({}, { body: 'text' });
    expect(issues).toHaveLength(0);
    const a = validateEntry(s, { collection: 'author', slug: 'a', data: {}, body: 'text' });
    expect(a[0].path).toBe('');
    expect(a[0].message).toContain('no markdown field');
  });
  it('never throws on garbage', () => {
    expect(() => run({ title: { a: 1 }, tags: [1], featuredImage: null, author: 5 })).not.toThrow();
  });
});

describe('buildDataSchema', () => {
  it('excludes markdown, includes draft, exports to JSON Schema', () => {
    const shape = buildDataSchema(s.collections.post).shape;
    expect(Object.keys(shape)).not.toContain('body');
    expect(Object.keys(shape)).toContain('draft');
    const js = z.toJSONSchema(buildDataSchema(s.collections.post), { target: 'draft-2020-12' }) as any;
    expect(js.properties.title).toBeDefined();
    expect(js.additionalProperties).toBe(false);
    expect(js.required).toContain('title');
    expect(js.properties.related.anyOf?.[0] ?? js.properties.related).toMatchObject({ minItems: 1, maxItems: 3 });
    expect(JSON.stringify(js.properties.related)).toContain('author');
    expect(JSON.stringify(js.properties.related)).toContain('pattern');
    const req = z.toJSONSchema(buildDataSchema(s.collections.post2), { target: 'draft-2020-12' }) as any;
    expect(req.required).toContain('extra');
  });
});

describe('normalizeData', () => {
  it('drops null everywhere and empty strings of string-valued fields only', () => {
    const data = {
      title: 'Hi',
      link: null,
      kind: '',
      publishedAt: '',
      tint: '',
      author: '',
      tags: ['a'],
      count: null,
      extra: '',
      draft: true,
    };
    const out = normalizeData(s.collections.post, data);
    expect(out).toEqual({ title: 'Hi', tags: ['a'], extra: '', draft: true });
    expect(data.link).toBeNull();
    expect(out.tags).toBe(data.tags);
  });

  it('agrees with validation: an optional field accepts "" exactly when normalizeData drops it', () => {
    const fields = Object.entries(s.collections.post.fields).filter(([, f]) => f.type !== 'markdown' && !f.required);
    for (const [key] of fields) {
      const accepted = run({ [key]: '' }).every((i) => i.path !== key && !i.path.startsWith(`${key}.`));
      const dropped = !Object.hasOwn(normalizeData(s.collections.post, { [key]: '' }), key);
      expect({ key, accepted }).toEqual({ key, accepted: dropped || key === 'extra' });
    }
  });
});

describe('initialData', () => {
  const now = new Date('2026-03-04T05:06:07.000Z');
  it('sets defaults, defaultNow and draft only', () => {
    expect(initialData(s.collections.post, now)).toEqual({
      title: 'Untitled',
      tint: '#ffffff',
      featured: false,
      createdAt: now.toISOString(),
      createdDay: '2026-03-04',
      draft: true,
    });
    expect(initialData(s.collections.author, now)).toEqual({ draft: true });
    const col = { label: 'L', fields: { t: { type: 'string' as const, label: 'T', list: true, default: ['a'] } } };
    expect(initialData(col).t).not.toBe(col.fields.t.default);
  });
});
