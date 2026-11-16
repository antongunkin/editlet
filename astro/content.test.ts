// @vitest-environment node
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { LoaderContext } from 'astro/loaders';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { astroTypes, formatIssues, editletCollections, editletLoader, toAstroData } from './content';
import { setAstroState, type EditletAstroState } from './shared';

import type { Collection } from '../core/schema';

const schema = {
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Posts',
      fields: {
        title: { label: 'Title', type: 'string', required: true },
        cover: { label: 'Cover', type: 'image' },
        author: { label: 'Author', type: 'reference', collections: ['author'] },
        body: { label: 'Body', type: 'markdown' },
      },
    },
    author: { label: 'Authors', fields: { name: { label: 'Name', type: 'string', required: true } } },
    home: { label: 'Home', singleton: true, fields: { heading: { label: 'Heading', type: 'string' } } },
  },
};

const HELLO = '---\ntitle: Hello\ncover:\n  src: hello/cover.png\n  alt: Cover\nauthor: author/jane\n---\nHi there\n';

const files: Record<string, string> = {
  'cms/schema.json': JSON.stringify(schema, null, 2),
  'cms/content/post/hello.md': HELLO,
  'cms/content/post/hello/cover.png': 'png',
  'cms/content/author/jane.md': '---\nname: Jane\n---\n',
  'cms/content/home/index.md': '---\nheading: Welcome\n---\n',
};

const temps: string[] = [];

async function project(overrides: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-astro-'));
  temps.push(dir);
  for (const [file, text] of Object.entries({ ...files, ...overrides })) await put(dir, file, text);
  return dir;
}

async function put(dir: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), text);
}

function state(root: string, command: EditletAstroState['command']): void {
  setAstroState({ root, schemaPath: 'cms/schema.json', command });
}

interface Stored {
  id: string;
  data: Record<string, unknown>;
  body?: string;
  filePath?: string;
  digest?: string | number;
  rendered?: { html: string };
  assetImports?: string[];
}

function fakeContext(root: string, collection: string, watcher?: EventEmitter) {
  const map = new Map<string, Stored>();
  const store = {
    set: (entry: Stored) => {
      map.set(entry.id, entry);
      return true;
    },
    get: (id: string) => map.get(id),
    delete: (id: string) => void map.delete(id),
    keys: () => [...map.keys()],
    clear: () => map.clear(),
    entries: () => [...map.entries()],
  };
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const ctx = {
    collection,
    store,
    logger,
    config: { root: pathToFileURL(`${root}/`) },
    renderMarkdown: async (body: string) => ({ html: body, metadata: { imagePaths: [] } }),
    generateDigest: (s: string) => String(s.length),
    watcher,
  } as unknown as LoaderContext;
  return { ctx, map, logger };
}

afterEach(async () => {
  (globalThis as Record<symbol, unknown>)[Symbol.for('editlet.astro')] = undefined;
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const post = schema.collections.post as unknown as Collection;

describe('toAstroData', () => {
  it('maps images and references', () => {
    expect(toAstroData(post, { title: 'T', cover: { src: 'p/c.png', alt: 'A' }, author: 'author/jane' })).toEqual({
      title: 'T',
      cover: { src: '__ASTRO_IMAGE_./p/c.png', alt: 'A' },
      author: { collection: 'author', id: 'jane' },
    });
    expect(toAstroData(post, { title: 'T', cover: { src: '../media/x.png', alt: 'A' } }).cover).toEqual({
      src: '__ASTRO_IMAGE_../media/x.png',
      alt: 'A',
    });
  });

  it('maps multiple references to an array and drops absent values', () => {
    const col: Collection = {
      label: 'C',
      fields: {
        refs: { label: 'Refs', type: 'reference', collections: ['author', 'post'], multiple: true },
        one: { label: 'One', type: 'reference', collections: ['author'] },
        cover: { label: 'Cover', type: 'image' },
      },
    };
    expect(toAstroData(col, { refs: ['author/jane', 'post/hello'], one: '', cover: null })).toEqual({
      refs: [
        { collection: 'author', id: 'jane' },
        { collection: 'post', id: 'hello' },
      ],
    });
  });
});

describe('astroTypes', () => {
  it('describes the Astro entry data', () => {
    const types = astroTypes(post);
    expect(types).toContain('export type Entry');
    expect(types).toContain('title: string;');
    expect(types).toContain("cover?: { src: import('astro').ImageMetadata; alt: string };");
    expect(types).toContain("author?: { collection: 'author'; id: string };");
    expect(types).toContain('draft?: boolean;');
    expect(types).not.toContain('body');
  });

  it('covers selects, json and multi-collection references', () => {
    const types = astroTypes({
      label: 'C',
      fields: {
        kind: {
          label: 'Kind',
          type: 'select',
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: "b'c" },
          ],
        },
        tags: { label: 'Tags', type: 'select', options: [{ label: 'X', value: 'x' }], multiple: true, required: true },
        meta: { label: 'Meta', type: 'json' },
        refs: { label: 'Refs', type: 'reference', collections: ['author', 'post'], multiple: true },
      },
    });
    expect(types).toContain("kind?: 'a' | 'b\\'c';");
    expect(types).toContain("tags: 'x'[];");
    expect(types).toContain('meta?: unknown;');
    expect(types).toContain("refs?: ({ collection: 'author'; id: string } | { collection: 'post'; id: string })[];");
  });
});

describe('formatIssues', () => {
  it('prints one issue per line', () => {
    expect(
      formatIssues([
        { file: 'a.md', path: 'title', message: 'Required' },
        { file: 'b.md', path: '', message: 'Not an entry file' },
      ]),
    ).toBe('a.md: title — Required\nb.md — Not an entry file');
  });
});

describe('editletLoader', () => {
  it('load stores entries with id, filePath, data', async () => {
    const dir = await project();
    state(dir, 'build');
    const { ctx, map } = fakeContext(dir, 'post');
    await editletLoader('post').load(ctx);
    expect([...map.keys()]).toEqual(['hello']);
    const hello = map.get('hello')!;
    expect(hello.filePath).toBe('cms/content/post/hello.md');
    expect(hello.data).toEqual({
      title: 'Hello',
      cover: { src: '__ASTRO_IMAGE_./hello/cover.png', alt: 'Cover' },
      author: { collection: 'author', id: 'jane' },
    });
    expect(hello.body).toBe('Hi there\n');
    expect(hello.rendered?.html).toBe('Hi there\n');
    expect(hello.assetImports).toEqual([]);
    expect(hello.digest).toBeDefined();

    const home = fakeContext(dir, 'home');
    await editletLoader('home').load(home.ctx);
    expect([...home.map.keys()]).toEqual(['index']);
    expect(home.map.get('index')!.filePath).toBe('cms/content/home/index.md');
    expect(home.map.get('index')!.rendered).toBeUndefined();
  });

  it('load throws all issues of the collection', async () => {
    const dir = await project({
      'cms/content/post/hello.md': '---\ntitle: 42\nauthor: author/nope\n---\nHi\n',
      'cms/content/author/bad.md': '---\nname: 7\n---\n',
    });
    const { ctx, map } = fakeContext(dir, 'post');
    const load = editletLoader('post', { schemaPath: 'cms/schema.json' }).load(ctx);
    await expect(load).rejects.toThrow('Editlet: invalid content in "post"');
    await expect(editletLoader('post').load(ctx)).rejects.toThrow('cms/content/post/hello.md: title — Expected text');
    const error = await editletLoader('post')
      .load(ctx)
      .catch((e: Error) => e);
    expect((error as Error).message).toContain(
      'cms/content/post/hello.md: author — Referenced entry not found: author/nope',
    );
    expect((error as Error).message).not.toContain('author/bad.md');
    expect(map.size).toBe(0);
  });

  it('a broken schema fails the loader', async () => {
    const dir = await project({ 'cms/schema.json': '{ nope' });
    const { ctx } = fakeContext(dir, 'post');
    await expect(editletLoader('post').load(ctx)).rejects.toThrow('cms/schema.json — Invalid JSON');
  });

  it('drafts only in dev', async () => {
    const dir = await project({ 'cms/content/post/wip.md': '---\ntitle: WIP\ndraft: true\n---\n' });
    state(dir, 'build');
    const build = fakeContext(dir, 'post');
    await editletLoader('post').load(build.ctx);
    expect([...build.map.keys()]).toEqual(['hello']);

    state(dir, 'dev');
    const dev = fakeContext(dir, 'post');
    await editletLoader('post').load(dev.ctx);
    expect([...dev.map.keys()].toSorted()).toEqual(['hello', 'wip']);
    expect(dev.map.get('wip')!.data).toEqual({ title: 'WIP', draft: true });
  });

  it('deletes entries that are gone', async () => {
    const dir = await project();
    const { ctx, map } = fakeContext(dir, 'post');
    map.set('old', { id: 'old', data: {} });
    await editletLoader('post').load(ctx);
    expect([...map.keys()]).toEqual(['hello']);
  });

  it('deletes a changed entry that had images before setting it, so Astro rewrites its image imports', async () => {
    // Astro 7.4 rewrites .astro/content-assets.mjs on store.delete, but on store.set only when the entry adds an
    // image: an entry that lost its last image would keep the import, and deleting the file would break every page.
    const dir = await project();
    const { ctx, map } = fakeContext(dir, 'post');
    map.set('hello', { id: 'hello', data: {}, digest: 'old', assetImports: ['./hello/cover.png'] });
    map.set('other', { id: 'other', data: {}, digest: 'old' });
    const calls: string[] = [];
    const { set, delete: del } = ctx.store;
    ctx.store.set = (entry) => (calls.push(`set ${entry.id}`), set(entry));
    ctx.store.delete = (id) => (calls.push(`delete ${id}`), del(id));
    await editletLoader('post').load(ctx);
    expect(calls).toEqual(['delete hello', 'set hello', 'delete other']);
    expect(map.get('hello')!.data.title).toBe('Hello');

    // Unchanged (same digest): left alone.
    calls.length = 0;
    map.set('hello', { ...map.get('hello')!, assetImports: ['./hello/cover.png'] });
    await editletLoader('post').load(ctx);
    expect(calls).toEqual(['set hello']);
  });

  it('keeps last good data when a watcher re-sync fails', async () => {
    const dir = await project();
    state(dir, 'dev');
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const { ctx, map, logger } = fakeContext(dir, 'post', watcher);
    await editletLoader('post').load(ctx);
    expect(watcher.add).toHaveBeenCalledWith(join(dir, 'cms/content'));

    await put(dir, 'cms/content/post/hello.md', '---\ntitle: 42\n---\n');
    watcher.emit('change', join(dir, 'cms/content/post/hello.md'));
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(logger.error.mock.calls[0][0]).toContain('cms/content/post/hello.md: title — Expected text');
    expect(map.get('hello')!.data.title).toBe('Hello');

    await put(dir, 'cms/content/post/second.md', '---\ntitle: Second\n---\n');
    await put(dir, 'cms/content/post/hello.md', '---\ntitle: Fixed\n---\n');
    watcher.emit('add', join(dir, 'cms/content/post/second.md'));
    await vi.waitFor(() => expect(map.get('second')?.data.title).toBe('Second'));
    expect(map.get('hello')!.data.title).toBe('Fixed');

    watcher.emit('change', join(dir, 'elsewhere/file.md'));
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('watches content even when the initial dev sync fails', async () => {
    const dir = await project({ 'cms/content/post/hello.md': '---\ntitle: 42\n---\n' });
    state(dir, 'dev');
    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    const { ctx, map } = fakeContext(dir, 'post', watcher);
    await expect(editletLoader('post').load(ctx)).rejects.toThrow('title — Expected text');

    await put(dir, 'cms/content/post/hello.md', '---\ntitle: Fixed\n---\n');
    watcher.emit('change', join(dir, 'cms/content/post/hello.md'));
    await vi.waitFor(() => expect(map.get('hello')?.data.title).toBe('Fixed'));
  });

  it('createSchema returns a permissive schema and the entry types', async () => {
    const dir = await project();
    state(dir, 'build');
    const loader = editletLoader('post');
    if (!('createSchema' in loader) || !loader.createSchema) throw new Error('no createSchema');
    const { schema: zod, types } = await loader.createSchema();
    expect(types).toContain('title: string;');
    expect((zod as unknown as { safeParse: (v: unknown) => { success: boolean } }).safeParse({ any: 1 }).success).toBe(
      true,
    );
  });
});

describe('editletCollections', () => {
  it('defines one collection per schema collection', async () => {
    const dir = await project();
    state(dir, 'build');
    const collections = editletCollections();
    expect(Object.keys(collections)).toEqual(['post', 'author', 'home']);
    expect((collections.post as { loader: { name: string } }).loader.name).toBe('editlet');
  });
});

describe('references on every level (survey fixture)', () => {
  it('gives each reference the { collection, id } shape Astro getEntry/getEntries resolve', async () => {
    const { readProject } = await import('../node/project');
    const { schema: survey, entries } = await readProject(join(import.meta.dirname, '../__fixtures__/survey'));
    const data = (collection: string, slug: string) => {
      const entry = entries.find((e) => e.collection === collection && e.slug === slug)!;
      return toAstroData(survey.collections[collection]!, entry.data);
    };
    expect(data('survey', 'onboarding')).toMatchObject({
      brand: { collection: 'brand', id: 'index' },
      sections: [
        { collection: 'section', id: 'about-you' },
        { collection: 'section', id: 'feedback' },
      ],
    });
    expect(data('section', 'about-you').questions).toEqual([
      { collection: 'question', id: 'age' },
      { collection: 'question', id: 'role' },
    ]);
    expect(data('question', 'role').next).toEqual({ collection: 'question', id: 'rating' });
    expect(data('option', 'age-adult').followUp).toEqual({ collection: 'question', id: 'age' });
    expect(astroTypes(survey.collections.survey!)).toContain("sections?: { collection: 'section'; id: string }[];");
    // P22: images and references inside object and blocks get the same shapes.
    const blocks = data('page', 'landing').content as Record<string, any>[];
    expect(blocks[0]!.image).toEqual({ src: '__ASTRO_IMAGE_./landing/hero.webp', alt: 'People talking' });
    expect(blocks[1]!.items[0].icon.src).toBe('__ASTRO_IMAGE_./landing/fast.webp');
    expect(blocks[3]!.survey).toEqual({ collection: 'survey', id: 'onboarding' });
    expect(data('question', 'rating').scale).toEqual({
      min: 0,
      max: 10,
      labels: { low: 'Not at all', high: 'Absolutely' },
    });
    const pageTypes = astroTypes(survey.collections.page!);
    expect(pageTypes).toContain("{ block: 'survey'; survey: { collection: 'survey'; id: string }; note?: string }");
    expect(pageTypes).toContain("image?: { src: import('astro').ImageMetadata; alt: string }");
  });
});
