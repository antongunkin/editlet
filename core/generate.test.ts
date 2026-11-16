// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateTypes, toJsonSchema } from './generate';
import { loadSchema } from './schema';

const options = [
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
];

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      fields: {
        title: { type: 'string', label: 'Title', required: true },
        summary: { type: 'text', label: 'Summary' },
        body: { type: 'markdown', label: 'Body' },
        tags: { type: 'string', label: 'Tags', list: true, required: true },
        status: { type: 'select', label: 'Status', options },
        kinds: { type: 'select', label: 'Kinds', multiple: true, options },
        count: { type: 'number', label: 'Count' },
        featured: { type: 'boolean', label: 'Featured' },
        publishedAt: { type: 'datetime', label: 'At' },
        extra: { type: 'json', label: 'Extra' },
        link: { type: 'url', label: 'Link' },
        tint: { type: 'color', label: 'Tint' },
        cover: { type: 'image', label: 'Cover', required: true },
        author: { type: 'reference', label: 'Author', collections: ['author'] },
        related: { type: 'reference', label: 'Related', collections: ['author', 'homePage'], multiple: true },
      },
    },
    author: { label: 'Author', fields: { name: { type: 'string', label: 'Name', required: true } } },
    homePage: {
      label: 'Home',
      singleton: true,
      fields: { headline: { type: 'string', label: 'Headline' } },
    },
  },
});

describe('toJsonSchema', () => {
  it('describes a collection', () => {
    const js = toJsonSchema(schema.collections.post!) as {
      required: string[];
      additionalProperties: boolean;
      properties: Record<string, { type: string }>;
    };
    expect(js.required).toContain('title');
    expect(js.properties.tags!.type).toBe('array');
    expect(js.additionalProperties).toBe(false);
  });
});

describe('generateTypes', () => {
  const out = generateTypes(schema);

  it('matches the snapshot', async () => {
    await expect(out).toMatchFileSnapshot('./__snapshots__/generate.d.ts');
  });

  it('maps key field types', () => {
    expect(out).toContain('author?: `author/${string}`;');
    expect(out).toContain("status?: 'a' | 'b';");
    expect(out).toContain('related?: (`author/${string}` | `homePage/${string}`)[];');
    expect(out).not.toContain('body?:');
    expect(out.endsWith('}\n')).toBe(true);
  });

  it('compiles under tsc --strict', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editlet-'));
    try {
      const file = path.join(dir, 'content.d.ts');
      fs.writeFileSync(file, out);
      execFileSync('npx', ['tsc', '--noEmit', '--strict', '--ignoreConfig', file], { stdio: 'pipe' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
