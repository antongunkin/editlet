// @vitest-environment node
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { findImageRefs } from './assets';
import { entryFilePath, refKey } from './paths';
import { countReferrers, entryReferences, findReferrers } from './references';
import { loadSchema, type Schema } from './schema';
import {
  countReferrersFromSummaries,
  deleteSuspects,
  findReferrersFromSummaries,
  resolveSummaryImages,
  SUMMARY_VERSION,
  summarizeEntry,
  summaryFingerprint,
} from './summary';
import { validateEntry, type Entry } from './validate';

import { readProject } from '../node/project';

const survey = join(import.meta.dirname, '../__fixtures__/survey');
// The demo site of the development repo; the public mirror holds only the package.
const demo = join(import.meta.dirname, '../../..');

const rows = (schema: Schema, entries: Entry[]) =>
  entries.map((e) => ({ collection: e.collection, slug: e.slug, summary: summarizeEntry(schema, e.collection, e) }));

/** Every fact a summary holds, against what the full-file code gives. */
function expectEquivalent(schema: Schema, entries: Entry[]): void {
  for (const entry of entries) {
    const { collection, slug, data, body } = entry;
    const def = schema.collections[collection]!;
    const path = entryFilePath(schema, collection, slug);
    const summary = summarizeEntry(schema, collection, { data, body });

    const raw = def.titleField === undefined ? undefined : data[def.titleField];
    expect(summary.v, path).toBe(SUMMARY_VERSION);
    expect(summary.title ?? slug, path).toBe(typeof raw === 'string' && raw.trim() !== '' ? raw : slug);
    expect(summary.draft, path).toBe(data.draft === true);
    expect(summary.refs, path).toStrictEqual(entryReferences(def, data));
    expect(resolveSummaryImages(schema, path, summary), path).toStrictEqual(
      findImageRefs(schema, def, path, data, body).map(({ body: _, ...use }) => use),
    );
    expect(summary.issues, path).toBe(validateEntry(schema, entry, {}).length);
    // What the cache stores is what was made.
    expect(JSON.parse(JSON.stringify(summary)), path).toStrictEqual(summary);
  }
}

function expectSameReferrers(schema: Schema, entries: Entry[]): void {
  const summaries = rows(
    schema,
    entries.filter((e) => Object.hasOwn(schema.collections, e.collection)),
  );
  expect(countReferrersFromSummaries(schema, summaries)).toEqual(countReferrers(schema, entries));
  const targets = new Set([...entries.map((e) => refKey(e.collection, e.slug)), 'question/missing']);
  for (const ref of targets) {
    expect(
      findReferrersFromSummaries(schema, summaries, ref).map((r) => [r.entry.collection, r.entry.slug, r.fields]),
      ref,
    ).toEqual(findReferrers(schema, entries, ref).map((r) => [r.entry.collection, r.entry.slug, r.fields]));
  }
}

describe('summaries of the survey fixture', () => {
  it('hold what the full files give', async () => {
    const { schema, entries } = await readProject(survey);
    expect(entries.length).toBeGreaterThan(10);
    expectEquivalent(schema, entries);
  });

  it('count and find referrers as the full files do', async () => {
    const { schema, entries } = await readProject(survey);
    expect(countReferrers(schema, entries).size).toBeGreaterThan(0);
    expectSameReferrers(schema, entries);
  });
});

describe.skipIf(!existsSync(join(demo, 'cms/schema.json')))('summaries of the demo site', () => {
  it('hold what the full files give', async () => {
    const { schema, entries } = await readProject(demo);
    expect(entries.length).toBeGreaterThan(10);
    expectEquivalent(schema, entries);
  });

  it('count and find referrers as the full files do', async () => {
    const { schema, entries } = await readProject(demo);
    expectSameReferrers(schema, entries);
  });
});

/** Every place a reference or an image can be. */
const input = () => ({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    author: { label: 'Author', titleField: 'name', fields: { name: { type: 'string', label: 'Name' } } },
    post: {
      label: 'Post',
      titleField: 'title',
      fields: {
        title: { type: 'string', label: 'Title', required: true },
        cover: { type: 'image', label: 'Cover' },
        authors: { type: 'reference', label: 'Authors', collections: ['author'], multiple: true },
        seo: {
          type: 'object',
          label: 'SEO',
          fields: {
            image: { type: 'image', label: 'Image' },
            by: { type: 'reference', label: 'By', collections: ['author'] },
          },
        },
        quotes: {
          type: 'object',
          label: 'Quotes',
          list: true,
          fields: { by: { type: 'reference', label: 'By', collections: ['author'] } },
        },
        content: {
          type: 'blocks',
          label: 'Content',
          blocks: {
            hero: {
              label: 'Hero',
              fields: {
                image: { type: 'image', label: 'Image' },
                author: { type: 'reference', label: 'Author', collections: ['author'] },
              },
            },
            prose: { label: 'Text', fields: { text: { type: 'markdown', label: 'Text' } } },
          },
        },
        body: { type: 'markdown', label: 'Body' },
      },
    },
  },
});

const schema = loadSchema(input());

const post: Entry = {
  collection: 'post',
  slug: 'hello',
  data: {
    title: 'Hello',
    draft: true,
    cover: { src: 'cover.png', alt: 'Cover' },
    authors: ['author/ann', 'author/bo'],
    seo: { image: { src: '../shared/seo.png', alt: '' }, by: 'author/ann' },
    quotes: [{ by: 'author/bo' }, { by: 'author/ann' }],
    content: [
      { block: 'hero', image: { src: 'hero.webp', alt: 'Hero' }, author: 'author/cy' },
      { block: 'prose', text: 'A ![nested](nested.png) image and ![ref][r].\n\n[r]: ../shared/ref.png' },
    ],
  },
  body: 'Text ![body](body.png) <img src="https://example.com/x.png" alt="remote">\n\n`![code](no.png)`\n',
};

describe('summarizeEntry', () => {
  it('finds references and images inside objects, lists, blocks, nested Markdown and the body', () => {
    const summary = summarizeEntry(schema, 'post', post);
    expect(summary.title).toBe('Hello');
    expect(summary.draft).toBe(true);
    expect(summary.issues).toBe(validateEntry(schema, post, {}).length);
    expect(summary.refs.map((r) => r.field)).toEqual([
      'authors',
      'authors',
      'seo.by',
      'quotes.0.by',
      'quotes.1.by',
      'content.0.author',
    ]);
    expect(summary.images.map((i) => i.src)).toEqual([
      'cover.png',
      '../shared/seo.png',
      'hero.webp',
      'nested.png',
      '../shared/ref.png',
      'body.png',
      'https://example.com/x.png',
    ]);
    expect(summary.images[0]).toStrictEqual({ field: 'cover', src: 'cover.png', alt: 'Cover' });
    expect(summary.images[2]).toStrictEqual({
      field: 'content.0.image',
      at: ['content', 0, 'image'],
      label: 'Image (content.0)',
      src: 'hero.webp',
      alt: 'Hero',
    });
    expectEquivalent(schema, [post]);
  });

  it('resolves images for the path it is given', () => {
    const summary = summarizeEntry(schema, 'post', post);
    const paths = resolveSummaryImages(schema, 'cms/content/post/hello.md', summary).map((i) => i.path);
    expect(paths).toEqual([
      'cms/content/post/cover.png',
      'cms/content/shared/seo.png',
      'cms/content/post/hero.webp',
      'cms/content/post/nested.png',
      'cms/content/shared/ref.png',
      'cms/content/post/body.png',
      null,
    ]);
    expect(resolveSummaryImages(schema, 'cms/content/other/x.md', summary)[0]!.path).toBe(
      'cms/content/other/cover.png',
    );
  });

  it('has no title without a non-empty string in the title field', () => {
    for (const title of [undefined, '', '  ', 7, ['a']]) {
      expect(summarizeEntry(schema, 'post', { data: { title }, body: '' }).title).toBeNull();
    }
    const { titleField: _, ...untitled } = input().collections.author;
    const bare = loadSchema({ ...input(), collections: { author: untitled } });
    expect(summarizeEntry(bare, 'author', { data: { name: 'Ann' }, body: '' }).title).toBeNull();
  });

  it('counts schema and file issues, never existence', () => {
    const broken = { title: 5, extra: 1, cover: { src: '/abs.png', alt: 'a' }, seo: { by: 'author/nobody' } };
    const entry = { collection: 'post', slug: 'broken', data: broken, body: '' };
    const count = validateEntry(schema, entry, {}).length;
    expect(count).toBe(3);
    expect(summarizeEntry(schema, 'post', entry).issues).toBe(count);
    const missing = { entryExists: () => false, fileExists: () => false };
    expect(validateEntry(schema, entry, missing).length).toBeGreaterThan(count);
  });

  it('leaves the slug rule out: it depends on the path, not on the file', () => {
    const entry = { collection: 'author', slug: 'Not A Slug', data: { name: 'Ann' }, body: '' };
    expect(validateEntry(schema, entry, {})).toHaveLength(1);
    expect(summarizeEntry(schema, 'author', entry).issues).toBe(0);
  });

  it('gives an empty summary with one issue for a collection the schema lacks', () => {
    expect(summarizeEntry(schema, 'toString', { data: { draft: true }, body: '![a](a.png)' })).toStrictEqual({
      v: SUMMARY_VERSION,
      title: null,
      draft: true,
      refs: [],
      images: [],
      issues: 1,
    });
  });

  it('keeps a 20 KB post under 1 KB', () => {
    const paragraph = 'Plain prose with a [link](https://example.com) and some **bold** words, over and over. ';
    const body = `![one](one.png)\n\n${paragraph.repeat(240)}\n\n![two](two.png)\n`;
    expect(body.length).toBeGreaterThan(20_000);
    const data = { title: 'A long post', authors: ['author/ann', 'author/bo'], cover: { src: 'c.png', alt: 'C' } };
    expect(JSON.stringify(summarizeEntry(schema, 'post', { data, body })).length).toBeLessThan(1024);
  });
});

describe('referrers from summaries', () => {
  it('match the full-file rules, and skip collections the schema lacks', () => {
    const entries: Entry[] = [post, { ...post, slug: 'again' }];
    const gone: Entry = { collection: 'gone', slug: 'x', data: { by: 'author/ann' }, body: '' };
    expectSameReferrers(schema, [...entries, gone]);
    expect(countReferrers(schema, entries).get('author/ann')).toEqual(new Map([['post', 2]]));

    const stale = { collection: 'gone', slug: 'x', summary: summarizeEntry(schema, 'post', post) };
    expect(countReferrersFromSummaries(schema, [stale]).size).toBe(0);
    expect(findReferrersFromSummaries(schema, [stale], 'author/ann')).toEqual([]);
  });
});

describe('deleteSuspects', () => {
  const suspects = async (...deleted: string[]) => {
    const project = await readProject(survey);
    const listed = rows(project.schema, project.entries).map((row) => ({
      ...row,
      path: entryFilePath(project.schema, row.collection, row.slug),
    }));
    const found = deleteSuspects(project.schema, listed, new Set(deleted.map((p) => `cms/content/${p}`)));
    return Array.from(found, (p) => p.replace('cms/content/', '')).toSorted();
  };

  it('finds the entries that reference a deleted entry, at any depth', async () => {
    expect(await suspects('question/rating.md')).toEqual(['question/role.md', 'section/feedback.md']);
    expect(await suspects('survey/onboarding.md')).toEqual(['page/landing.md']); // a blocks item
    expect(await suspects('brand/index.md')).toEqual(['survey/onboarding.md']); // a singleton
  });

  it('finds the entries whose image fields show a deleted file', async () => {
    expect(await suspects('brand/logo.webp')).toEqual(['brand/index.md']);
    expect(await suspects('question/role/diagram.webp')).toEqual(['question/role.md']);
    expect(await suspects('page/landing/fast.webp')).toEqual(['page/landing.md']); // a list in a block
  });

  it('finds nothing for a file nothing points at', async () => {
    expect(await suspects('survey/pulse.md', 'brand/other.webp')).toEqual([]);
    expect(await suspects()).toEqual([]);
  });

  it('leaves out body images and top-level Markdown, but keeps nested images', () => {
    const summary = summarizeEntry(schema, 'post', post);
    const row = { path: 'cms/content/post/hello.md', collection: 'post', slug: 'hello', summary };
    const hit = (path: string) => deleteSuspects(schema, [row], new Set([`cms/content/${path}`])).size === 1;
    expect(hit('post/cover.png')).toBe(true);
    expect(hit('shared/seo.png')).toBe(true);
    expect(hit('post/hero.webp')).toBe(true);
    expect(hit('post/body.png')).toBe(false);
    // A nested Markdown string's image counts too, though validation never checks it (the TODO in `summary.ts`).
    expect(hit('post/nested.png')).toBe(true);
    expect(hit('author/ann.md')).toBe(true);
    expect(hit('author/zed.md')).toBe(false);
  });
});

describe('summaryFingerprint', () => {
  const of = async (edit: (s: any) => void = () => {}, collection = 'post') => {
    const s = input() as any;
    edit(s);
    return summaryFingerprint(loadSchema(s), collection);
  };

  it('is 16 hex characters and does not depend on key order', async () => {
    const base = await of();
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    const reordered = await of((s) => {
      const { title, ...rest } = s.collections.post.fields;
      s.collections.post.fields = { ...rest, title };
    });
    expect(reordered).toBe(base);
    expect(await of(() => {}, 'author')).not.toBe(base);
  });

  it('stays when another collection changes', async () => {
    const base = await of();
    expect(await of((s) => (s.collections.author.label = 'Writer'))).toBe(base);
    expect(await of((s) => (s.collections.author.fields.bio = { type: 'text', label: 'Bio' }))).toBe(base);
    expect(await of((s) => (s.collections.page = { label: 'Page', fields: s.collections.author.fields }))).toBe(base);
  });

  it('changes with a field of this collection, contentDir or another top-level key', async () => {
    const base = await of();
    const edits: ((s: any) => void)[] = [
      (s) => (s.collections.post.fields.title.required = false),
      (s) => (s.collections.post.fields.note = { type: 'text', label: 'Note' }),
      (s) => (s.collections.post.fields.content.blocks.prose.fields.text.required = true),
      (s) => (s.collections.post.titleField = 'body'),
      (s) => (s.contentDir = 'content'),
      (s) => (s.git.baseBranch = 'trunk'),
    ];
    for (const edit of edits) expect(await of(edit), edit.toString()).not.toBe(base);
  });
});
