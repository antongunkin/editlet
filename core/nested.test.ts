// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateTypes, toJsonSchema } from './generate';
import { EditletError } from './issues';
import { loadSchema, type Field, type Schema } from './schema';
import { normalizeData, validateEntry } from './validate';
import { allFields, mapFields, visitFields } from './walk';

/** A landing page: `object`, `object` + `list` and `blocks`, with references, images and Markdown inside. */
function input(): any {
  return {
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: {
      page: {
        label: 'Page',
        fields: {
          title: { type: 'string', label: 'Title', required: true },
          seo: {
            type: 'object',
            label: 'SEO',
            fields: {
              title: { type: 'string', label: 'Title' },
              image: { type: 'image', label: 'Image' },
              author: { type: 'reference', label: 'Author', collections: ['author'] },
            },
          },
          features: {
            type: 'object',
            label: 'Features',
            list: true,
            max: 3,
            fields: {
              title: { type: 'string', label: 'Title', required: true },
              draft: { type: 'boolean', label: 'Draft feature' },
            },
          },
          content: {
            type: 'blocks',
            label: 'Content',
            blocks: {
              hero: {
                label: 'Hero',
                fields: {
                  title: { type: 'string', label: 'Title', required: true },
                  image: { type: 'image', label: 'Image' },
                  cta: {
                    type: 'object',
                    label: 'Button',
                    fields: { label: { type: 'string', label: 'Label' }, url: { type: 'url', label: 'URL' } },
                  },
                },
              },
              prose: { label: 'Text', fields: { text: { type: 'markdown', label: 'Text', required: true } } },
              people: {
                label: 'People',
                fields: {
                  people: { type: 'reference', label: 'People', collections: ['author'], multiple: true },
                },
              },
            },
          },
          body: { type: 'markdown', label: 'Body' },
        },
      },
      author: { label: 'Author', fields: { name: { type: 'string', label: 'Name' } } },
    },
  };
}

function issuesOf(value: unknown) {
  try {
    loadSchema(value);
  } catch (e) {
    expect(e).toBeInstanceOf(EditletError);
    return (e as EditletError).issues.map((i) => `${i.path}: ${i.message}`);
  }
  return [];
}

const schema: Schema = loadSchema(input());
const page = schema.collections.page!;

const valid = {
  title: 'Spring',
  seo: { title: 'Spring sale', image: { src: 'spring/share.webp', alt: 'Tulips' }, author: 'author/jane' },
  features: [{ title: 'Fast' }, { title: 'Small', draft: true }],
  content: [
    {
      block: 'hero',
      title: 'Hello',
      image: { src: 'spring/hero.webp', alt: 'Hero' },
      cta: { label: 'Go', url: '/go' },
    },
    { block: 'prose', text: 'Some **Markdown**' },
    { block: 'people', people: ['author/jane', 'author/joe'] },
  ],
};

const run = (data: Record<string, unknown>, ctx = {}) =>
  validateEntry(schema, { collection: 'page', slug: 'spring', data, body: '' }, ctx).map(
    (i) => `${i.path}: ${i.message}`,
  );

describe('loadSchema: object and blocks', () => {
  it('loads nested fields', () => {
    const content = page.fields.content as Extract<Field, { type: 'blocks' }>;
    expect(Object.keys(content.blocks)).toEqual(['hero', 'prose', 'people']);
    expect(content.blocks.prose!.fields.text!.type).toBe('markdown');
  });

  it('applies the field rules inside, with full paths', () => {
    const fx = input();
    fx.collections.page.fields.seo.fields.author.collections = ['ghost'];
    fx.collections.page.fields.content.blocks.hero.fields.cta.fields.label = { type: 'slug', label: 'X' };
    fx.collections.page.fields.content.blocks.people.fields.people.min = 3;
    fx.collections.page.fields.content.blocks.people.fields.people.max = 1;
    expect(issuesOf(fx)).toEqual([
      'collections.page.fields.content.blocks.hero.fields.cta.fields.label.type: unknown field type',
    ]);
    delete fx.collections.page.fields.content.blocks.hero.fields.cta.fields.label;
    expect(issuesOf(fx)).toEqual([
      'collections.page.fields.seo.fields.author.collections.0: unknown collection "ghost"',
      'collections.page.fields.content.blocks.people.fields.people.min: min must not exceed max',
    ]);
  });

  it('rejects empty fields and blocks, min/max without list, and the reserved block key', () => {
    const fx = input();
    fx.collections.page.fields.seo.fields = {};
    fx.collections.page.fields.content.blocks.prose.fields.block = { type: 'string', label: 'Kind' };
    fx.collections.page.fields.empty = { type: 'blocks', label: 'Empty', blocks: {} };
    expect(issuesOf(fx)).toEqual([
      'collections.page.fields.seo.fields: fields must not be empty',
      'collections.page.fields.empty.blocks: blocks must not be empty',
      'collections.page.fields.content.blocks.prose.fields.block: field key "block" is reserved for the block type',
    ]);
    const fx2 = input();
    fx2.collections.page.fields.seo.min = 1;
    fx2.collections.page.fields.content.blocks.prose.fields.block = { type: 'string', label: 'Kind' };
    expect(issuesOf(fx2)).toEqual([
      'collections.page.fields.seo: min/max require list: true',
      'collections.page.fields.content.blocks.prose.fields.block: field key "block" is reserved for the block type',
    ]);
  });

  it('allows draft and markdown as nested keys, but no default on object', () => {
    expect(issuesOf(input())).toEqual([]);
    const fx = input();
    fx.collections.page.fields.seo.default = {};
    expect(issuesOf(fx)).toEqual(['collections.page.fields.seo.default: unknown key "default"']);
  });
});

describe('validateEntry: object and blocks', () => {
  it('accepts a valid page and absent containers', () => {
    expect(run(valid)).toEqual([]);
    expect(run({ title: 'x' })).toEqual([]);
    expect(run({ title: 'x', seo: null, features: null, content: null })).toEqual([]);
  });

  it('reports shape issues at their nested paths', () => {
    expect(
      run({
        title: 'x',
        seo: { title: 1, nope: true },
        features: [{}],
        content: [{ block: 'video' }, { title: 'no kind' }, { block: 'prose', text: '  ' }, { block: 'hero' }],
      }),
    ).toEqual([
      'seo.title: Expected text',
      'seo.nope: Unknown field',
      'features.0.title: Required',
      'content.0.block: Expected block: hero, prose, people',
      'content.1.block: Expected block: hero, prose, people',
      'content.2.text: Required',
      'content.3.title: Required',
    ]);
    // Zod checks a list's length before its items.
    expect(run({ title: 'x', features: [{}, { title: 'b' }, { title: 'c' }, { title: 'd' }] })).toEqual([
      'features: Must have at most 3',
    ]);
    expect(run({ title: 'x', seo: 'nope', features: {}, content: {} })).toEqual([
      'seo: Expected an object',
      'features: Expected a list',
      'content: Expected a list',
    ]);
  });

  it('checks references and images inside against the project', () => {
    const ctx = { entryExists: (r: string) => r === 'author/jane', fileExists: (p: string) => p.endsWith('hero.webp') };
    expect(run(valid, ctx)).toEqual([
      'seo.image.src: Image file not found: cms/content/page/spring/share.webp',
      'content.2.people.1: Referenced entry not found: author/joe',
    ]);
  });

  it('skips project checks under a container with a shape issue', () => {
    const data = { ...valid, content: [{ block: 'people', people: ['author/joe', 7] }] };
    expect(run(data, { entryExists: () => false })).toEqual([
      'content.0.people.1: Expected a reference like "collection/slug"',
      'seo.author: Referenced entry not found: author/jane',
    ]);
  });
});

describe('normalizeData: object and blocks', () => {
  it('drops absent values at every level and keeps the block kind first', () => {
    const out = normalizeData(page, {
      title: 'x',
      seo: { title: '', image: null, author: 'author/jane' },
      features: [{ title: 'a', draft: null }],
      content: [
        { title: 'Hi', image: null, block: 'hero', cta: { label: '', url: null } },
        { block: 'other', x: null },
      ],
    });
    expect(out).toEqual({
      title: 'x',
      seo: { author: 'author/jane' },
      features: [{ title: 'a' }],
      content: [
        { block: 'hero', title: 'Hi', cta: {} },
        { block: 'other', x: null },
      ],
    });
    expect(Object.keys((out.content as object[])[0]!)).toEqual(['block', 'title', 'cta']);
  });
});

describe('walk', () => {
  it('visits every leaf with its path, depth first in field order', () => {
    const seen: string[] = [];
    visitFields(page.fields, valid, (field, _v, at) => seen.push(`${at.join('.')}:${field.type}`));
    expect(seen).toEqual([
      'title:string',
      'seo.title:string',
      'seo.image:image',
      'seo.author:reference',
      'features.0.title:string',
      'features.1.title:string',
      'features.1.draft:boolean',
      'content.0.title:string',
      'content.0.image:image',
      'content.0.cta.label:string',
      'content.0.cta.url:url',
      'content.1.text:markdown',
      'content.2.people:reference',
    ]);
  });

  it('maps leaves and keeps containers, unknown keys and unknown blocks', () => {
    const data = { ...valid, extra: 1, content: [...valid.content, { block: 'video', src: 'x' }] };
    const out = mapFields(page.fields, data, (field, v) => (field.type === 'image' ? 'IMG' : v));
    expect(out.seo).toEqual({ title: 'Spring sale', image: 'IMG', author: 'author/jane' });
    expect((out.content as object[])[0]).toMatchObject({ block: 'hero', image: 'IMG' });
    expect((out.content as object[])[3]).toEqual({ block: 'video', src: 'x' });
    expect(out.extra).toBe(1);
    expect(valid.seo.image).toEqual({ src: 'spring/share.webp', alt: 'Tulips' });
    const dropped = mapFields(page.fields, valid, (field, v) => (field.type === 'reference' ? undefined : v));
    expect(dropped.seo).toEqual({ title: 'Spring sale', image: { src: 'spring/share.webp', alt: 'Tulips' } });
  });

  it('lists every field of the tree', () => {
    expect(allFields(page.fields).map(([p]) => p.join('.'))).toContain('content.hero.cta.url');
  });
});

describe('generateTypes and toJsonSchema: object and blocks', () => {
  const out = generateTypes(schema);

  it('writes nested types and a union of blocks', () => {
    expect(out).toContain(
      'seo?: { title?: string; image?: { src: string; alt: string }; author?: `author/${string}` };',
    );
    expect(out).toContain('features?: { title: string; draft?: boolean }[];');
    expect(out).toContain("content?: ({ block: 'hero'; title: string; ");
    expect(out).toContain("{ block: 'prose'; text: string }");
  });

  it('describes the raw frontmatter in JSON Schema', () => {
    const js = toJsonSchema(page) as { properties: Record<string, { anyOf?: unknown[]; type?: string }> };
    expect(JSON.stringify(js.properties.content)).toContain('"hero"');
  });

  it('compiles, and narrows blocks by kind, under tsc --strict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editlet-nested-'));
    try {
      fs.writeFileSync(path.join(dir, 'content.d.ts'), out);
      const file = path.join(dir, 'use.ts');
      fs.writeFileSync(
        file,
        `import type { PageData } from './content';
declare const page: PageData;
for (const b of page.content ?? []) {
  if (b.block === 'hero') { const t: string = b.title; const u: string | undefined = b.cta?.url; void t; void u; }
  else if (b.block === 'prose') { const md: string = b.text; void md; }
  else { const p: \`author/\${string}\`[] | undefined = b.people; void p; }
}
// @ts-expect-error prose has no title
page.content?.filter((b) => b.block === 'prose').map((b) => b.title);
const f: string | undefined = page.features?.[0]?.title;
void f;
`,
      );
      let output = '';
      try {
        execFileSync('npx', ['tsc', '--noEmit', '--strict', '--ignoreConfig', '--skipLibCheck', file], {
          stdio: 'pipe',
        });
      } catch (error) {
        output = String((error as { stdout?: Buffer }).stdout ?? error);
      }
      expect(output).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
