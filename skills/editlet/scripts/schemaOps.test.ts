// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkChanges,
  contextOf,
  loadContext,
  planRemoveField,
  planRenameField,
  UsageError,
  withCandidateFiles,
  type Plan,
  type ProjectContext,
} from './schemaOps';

import { EditletError } from '../../../core/issues';

const site = join(import.meta.dirname, '../../../node/__fixtures__/site');
const post = 'cms/content/post/hello-world.md';
const enc = new TextEncoder();

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copyOfSite(edit?: (root: string) => Promise<void>): Promise<ProjectContext> {
  const root = await mkdtemp(join(tmpdir(), 'editlet-ops-'));
  temps.push(root);
  await cp(site, root, { recursive: true });
  await edit?.(root);
  return loadContext(root);
}

async function editSchema(root: string, edit: (schema: any) => void): Promise<void> {
  const path = join(root, 'cms/schema.json');
  const schema = JSON.parse(await readFile(path, 'utf8'));
  edit(schema);
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`);
}

/** The planned text of `path` (`undefined` when the plan leaves it alone). */
const content = (plan: Plan, path: string): string | null | undefined => {
  const c = plan.changes.find((change) => change.path === path)?.content;
  return c === undefined || c === null || typeof c === 'string' ? c : new TextDecoder().decode(c);
};

describe('loadContext and contextOf', () => {
  it('loads the schema text, the schema and every content file', async () => {
    const ctx = await copyOfSite();
    expect(ctx.schemaPath).toBe('cms/schema.json');
    expect(JSON.parse(ctx.schemaText).collections.post).toBeDefined();
    expect([...ctx.files.keys()].toSorted()).toEqual([
      'cms/content/author/jane.md',
      'cms/content/homePage/index.md',
      'cms/content/post/hello-world.md',
      'cms/content/post/hello-world/cover.webp',
      'cms/schema.json',
    ]);
    expect(ctx.context.exists(post)).toBe(true);
    expect(ctx.context.read?.(post)).toContain('title: Hello world');
  });

  it('throws an EditletError for a broken schema', async () => {
    await expect(copyOfSite((root) => writeFile(join(root, 'cms/schema.json'), '{'))).rejects.toBeInstanceOf(
      EditletError,
    );
  });

  it('reads text files only: missing and non-UTF-8 files read as undefined', () => {
    const files = new Map([
      ['a.md', enc.encode('hi')],
      ['b.bin', new Uint8Array([0xff, 0xfe])],
    ]);
    const context = contextOf(null, 'cms/schema.json', files);
    expect(context.read?.('a.md')).toBe('hi');
    expect(context.read?.('b.bin')).toBeUndefined();
    expect(context.read?.('none')).toBeUndefined();
    expect(context.exists('b.bin')).toBe(true);
    expect([...(context.list?.() ?? [])]).toEqual(['a.md', 'b.bin']);
  });
});

describe('withCandidateFiles', () => {
  it('returns the same context for an unparseable candidate or the same contentDir', async () => {
    const ctx = await copyOfSite();
    expect(await withCandidateFiles(ctx, '{')).toBe(ctx);
    expect(await withCandidateFiles(ctx, ctx.schemaText)).toBe(ctx);
  });

  it('adds the files of a new contentDir, so the check sees entries in both folders', async () => {
    const ctx = await copyOfSite(async (root) => {
      await mkdir(join(root, 'cms/other/author'), { recursive: true });
      await writeFile(join(root, 'cms/other/author/bob.md'), '---\nname: 5\n---\n');
    });
    const candidate = ctx.schemaText.replace('"contentDir": "cms/content"', '"contentDir": "cms/other"');
    const next = await withCandidateFiles(ctx, candidate);
    expect(next).not.toBe(ctx);
    expect(next.files.has('cms/other/author/bob.md')).toBe(true);
    expect(next.files.has(post)).toBe(true);
    expect(ctx.files.has('cms/other/author/bob.md')).toBe(false);
    const issues = checkChanges(next, [{ path: next.schemaPath, content: candidate }]);
    expect(issues.map((i) => i.file)).toContain('cms/other/author/bob.md');
    expect(issues.map((i) => i.message)).toContain('Not an entry file');
  });
});

describe('planRenameField', () => {
  it('rejects unknown collections and fields, invalid or reserved keys and existing fields', async () => {
    const ctx = await copyOfSite();
    const cases: [string, string, string, string][] = [
      ['nope', 'title', 'x', 'unknown collection "nope" (known: post, author, homePage)'],
      ['post', 'nope', 'x', 'unknown field "nope" in post (known: title, body, featuredImage, author)'],
      ['post', 'title', '9x', '"9x" is not a valid field key'],
      ['post', 'title', 'draft', '"draft" is not a valid field key'],
      ['post', 'title', 'author', 'post already has a field "author"'],
    ];
    for (const [collection, from, to, message] of cases) {
      expect(() => planRenameField(ctx, collection, from, to)).toThrow(UsageError);
      expect(() => planRenameField(ctx, collection, from, to)).toThrow(message);
    }
  });

  it('renames the key in place in the schema and the entries', async () => {
    const ctx = await copyOfSite();
    const plan = planRenameField(ctx, 'post', 'author', 'writer');
    expect(plan.issues).toEqual([]);
    expect(plan.notes).toEqual([]);
    expect(plan.rewritten).toEqual([]);
    expect(plan.changes.map((c) => c.path)).toEqual(['cms/schema.json', post]);
    expect(content(plan, 'cms/schema.json')).toBe(ctx.schemaText.replace('"author": { "type"', '"writer": { "type"'));
    expect(content(plan, post)).toBe((await readFile(join(ctx.root, post), 'utf8')).replace('author:', 'writer:'));
  });

  it('renaming the markdown body field leaves the entries alone', async () => {
    const ctx = await copyOfSite();
    const plan = planRenameField(ctx, 'post', 'body', 'content');
    expect(plan.changes.map((c) => c.path)).toEqual(['cms/schema.json']);
    expect(plan.issues).toEqual([]);
  });

  it('skips entries without the field and unparseable entries, and notes titleField / slugFrom', async () => {
    const ctx = await copyOfSite(async (root) => {
      await editSchema(root, (s) => Object.assign(s.collections.post, { titleField: 'title', slugFrom: 'title' }));
      await writeFile(join(root, 'cms/content/post/no-author.md'), '---\ntitle: No author\n---\n');
      await writeFile(join(root, 'cms/content/post/broken.md'), '---\ntitle: [\n---\n');
      await writeFile(join(root, 'cms/content/post/binary.md'), new Uint8Array([0xff, 0xfe]));
    });
    const plan = planRenameField(ctx, 'post', 'title', 'headline');
    expect(plan.notes).toEqual(['note: titleField/slugFrom follow the rename']);
    expect(plan.changes.map((c) => c.path).toSorted()).toEqual(
      ['cms/content/post/no-author.md', 'cms/content/post/hello-world.md', 'cms/schema.json'].toSorted(),
    );
    const schema = JSON.parse(content(plan, 'cms/schema.json')!);
    expect([schema.collections.post.titleField, schema.collections.post.slugFrom]).toEqual(['headline', 'headline']);
    // Broken and non-UTF-8 entries were broken before the batch: left alone and not blamed on it (validate reports them).
    expect(plan.issues).toEqual([]);
  });

  it('re-serializes an entry whose frontmatter cannot be edited by line', async () => {
    const ctx = await copyOfSite((root) =>
      writeFile(join(root, post), '---\n{title: Hi, author: author/jane}\n---\nBody\n'),
    );
    const plan = planRenameField(ctx, 'post', 'author', 'writer');
    expect(plan.rewritten).toEqual([post]);
    expect(content(plan, post)).toBe('---\ntitle: Hi\nwriter: author/jane\n---\n\nBody\n');
  });

  it('falls back to a full schema re-serialization when no minimal text edit applies', async () => {
    // More than 12 tokens "author" in the collection: the text edit gives up and the whole file is re-serialized.
    const ctx = await copyOfSite((root) =>
      editSchema(root, (s) => (s.collections.post.fields.author.collections = Array(13).fill('author'))),
    );
    const plan = planRenameField(ctx, 'post', 'author', 'writer');
    const expected = JSON.parse(ctx.schemaText);
    const { author, ...rest } = expected.collections.post.fields;
    expected.collections.post.fields = { ...rest, writer: author };
    expect(content(plan, 'cms/schema.json')).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it('returns clashes instead of a plan when an entry already has the target key', async () => {
    const ctx = await copyOfSite((root) =>
      writeFile(join(root, post), '---\ntitle: Hi\nwriter: x\nauthor: author/jane\n---\n'),
    );
    const plan = planRenameField(ctx, 'post', 'author', 'writer');
    expect(plan.issues).toEqual([
      { file: post, path: 'writer', message: 'Field "writer" already exists in this entry' },
    ]);
    expect(plan.notes).toEqual([]);
    expect(plan.rewritten).toBeUndefined();
  });
});

describe('planRemoveField', () => {
  it('rejects unknown fields', async () => {
    const ctx = await copyOfSite();
    expect(() => planRemoveField(ctx, 'post', 'nope')).toThrow('remove-field: unknown field "nope" in post');
  });

  it('lists data loss and images left on disk, for both image value shapes', async () => {
    const ctx = await copyOfSite(async (root) => {
      await writeFile(
        join(root, 'cms/content/post/short.md'),
        '---\ntitle: Short\nfeaturedImage: hello-world/cover.webp\n---\n',
      );
      await writeFile(join(root, 'cms/content/post/empty.md'), '---\ntitle: Empty\nfeaturedImage: null\n---\n');
      await writeFile(join(root, 'cms/content/post/gone.md'), '---\ntitle: Gone\nfeaturedImage: missing.webp\n---\n');
    });
    const plan = planRemoveField(ctx, 'post', 'featuredImage');
    expect(plan.notes.toSorted()).toEqual(
      [
        'loses data: cms/content/post/gone.md (featuredImage)',
        `loses data: ${post} (featuredImage)`,
        'loses data: cms/content/post/short.md (featuredImage)',
        'note: image files are left on disk: cms/content/post/hello-world/cover.webp',
      ].toSorted(),
    );
    expect(content(plan, 'cms/content/post/empty.md')).toBe('---\ntitle: Empty\n---\n');
    expect(plan.issues).toEqual([]);
  });

  it('removing the markdown field clears non-empty bodies only', async () => {
    const ctx = await copyOfSite((root) =>
      writeFile(join(root, 'cms/content/post/blank.md'), '---\ntitle: B\n---\n\n'),
    );
    const plan = planRemoveField(ctx, 'post', 'body');
    expect(plan.notes).toEqual([`loses body: ${post}`]);
    expect(plan.changes.map((c) => c.path)).toEqual(['cms/schema.json', post]);
    expect(content(plan, post)!.endsWith('---\n')).toBe(true);
  });

  it('drops slugFrom naming the field and notes it', async () => {
    const ctx = await copyOfSite((root) => editSchema(root, (s) => (s.collections.author.slugFrom = 'name')));
    const plan = planRemoveField(ctx, 'author', 'name');
    expect(plan.notes).toContain('note: titleField/slugFrom "name" removed from author');
    expect(JSON.parse(content(plan, 'cms/schema.json')!).collections.author.slugFrom).toBeUndefined();
    expect(content(plan, 'cms/content/author/jane.md')).not.toContain('name:');
  });
});
