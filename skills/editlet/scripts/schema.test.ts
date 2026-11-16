// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '../../../../..');
const site = join(import.meta.dirname, '../../../node/__fixtures__/site');
const jiti = join(repo, 'node_modules/.bin/jiti');

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copyOfSite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-schema-'));
  temps.push(dir);
  await cp(site, dir, { recursive: true });
  return dir;
}

const run = (root: string, ...args: string[]) =>
  spawnSync(jiti, [join(import.meta.dirname, 'schema.ts'), ...args, '--root', root], { encoding: 'utf8' });

async function candidate(root: string, text: string): Promise<string> {
  const path = join(root, 'candidate.json');
  await writeFile(path, text);
  return path;
}

describe('schema check', () => {
  it('accepts the unchanged schema', async () => {
    const root = await copyOfSite();
    const res = run(root, 'check', join(root, 'cms/schema.json'));
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^✓ schema change is safe/);
  });

  it('rejects a change that breaks existing entries and leaves the schema alone', async () => {
    const root = await copyOfSite();
    const schemaPath = join(root, 'cms/schema.json');
    const before = await readFile(schemaPath, 'utf8');
    const next = JSON.parse(before);
    next.collections.post.fields.summary = { type: 'string', label: 'Summary', required: true };
    const res = run(root, 'check', await candidate(root, JSON.stringify(next)));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cms/content/post/hello-world.md: summary — Required');
    expect(await readFile(schemaPath, 'utf8')).toBe(before);
  });

  it('reports an invalid candidate', async () => {
    const root = await copyOfSite();
    const res = run(root, 'check', await candidate(root, '{"collections":1}'));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('contentDir — ');
  });

  it('resolves a relative candidate against --root', async () => {
    const root = await copyOfSite();
    await candidate(root, await readFile(join(root, 'cms/schema.json'), 'utf8'));
    const res = run(root, 'check', 'candidate.json');
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^✓ schema change is safe/);
  });

  it('reports entries under the old contentDir when the candidate changes contentDir', async () => {
    const root = await copyOfSite();
    const next = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    next.contentDir = 'cms/other';
    const res = run(root, 'check', await candidate(root, JSON.stringify(next)));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Not an entry file');
  });

  it('needs a candidate argument', async () => {
    const res = run(await copyOfSite(), 'check');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Usage:');
  });
});

describe('schema json-schema', () => {
  it('prints one collection', async () => {
    const res = run(await copyOfSite(), 'json-schema', 'post');
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).properties.title).toBeDefined();
  });

  it('prints all collections', async () => {
    const res = run(await copyOfSite(), 'json-schema');
    expect(res.status).toBe(0);
    expect(Object.keys(JSON.parse(res.stdout)).toSorted()).toEqual(['author', 'homePage', 'post']);
  });

  it('exits 2 for an unknown collection', async () => {
    const res = run(await copyOfSite(), 'json-schema', 'nope');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('nope');
  });
});

describe('schema usage', () => {
  it('exits 2 with the usage for an unknown flag', async () => {
    const res = run(await copyOfSite(), 'json-schema', '--dry-run');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Usage:');
    expect(res.stderr).not.toContain('    at ');
  });

  it('exits 2 for an unknown command', async () => {
    const res = run(await copyOfSite(), 'frobnicate');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('Usage:');
  });
});

const validate = (root: string) =>
  spawnSync(jiti, [join(import.meta.dirname, 'validate.ts'), root], { encoding: 'utf8' });
const post = 'cms/content/post/hello-world.md';

async function setSchema(root: string, edit: (schema: any) => void): Promise<void> {
  const path = join(root, 'cms/schema.json');
  const schema = JSON.parse(await readFile(path, 'utf8'));
  edit(schema);
  await writeFile(path, `${JSON.stringify(schema, null, 2)}\n`);
}

describe('schema rename-field', () => {
  it('dry run lists the plan and writes nothing', async () => {
    const root = await copyOfSite();
    const before = [await readFile(join(root, 'cms/schema.json'), 'utf8'), await readFile(join(root, post), 'utf8')];
    const res = run(root, 'rename-field', 'post', 'featuredImage', 'cover');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('schema: cms/schema.json (post.featuredImage → post.cover)');
    expect(res.stdout).toContain(`entry: ${post}`);
    expect(res.stdout).toContain('dry run: nothing written; add --apply to write');
    expect([await readFile(join(root, 'cms/schema.json'), 'utf8'), await readFile(join(root, post), 'utf8')]).toEqual(
      before,
    );
  });

  it('dry run notes titleField following the rename and marks re-serialized entries', async () => {
    const root = await copyOfSite();
    await setSchema(root, (schema) => {
      schema.collections.post.titleField = 'title';
    });
    await writeFile(join(root, post), '---\n{title: Hi, author: author/jane}\n---\nBody\n');
    const res = run(root, 'rename-field', 'post', 'title', 'headline');
    expect(res.stdout).toContain('note: titleField/slugFrom follow the rename');
    expect(res.stdout).toContain(`entry: ${post} (rewritten in standard format)`);
  });

  it('--apply rewrites schema (same position) and entries, and validate passes', async () => {
    const root = await copyOfSite();
    const res = run(root, 'rename-field', 'post', 'featuredImage', 'cover', '--apply');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('applied: 2 files written');
    const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    expect(Object.keys(schema.collections.post.fields)).toEqual(['title', 'body', 'cover', 'author']);
    expect(await readFile(join(root, post), 'utf8')).toBe(
      '---\ntitle: Hello world\ncover:\n  src: hello-world/cover.webp\n  alt: Cover\nauthor: author/jane\n---\nHello!\n',
    );
    expect(validate(root).status).toBe(0);
  });

  it('moves titleField and slugFrom along', async () => {
    const root = await copyOfSite();
    await setSchema(root, (s) => Object.assign(s.collections.post, { titleField: 'title', slugFrom: 'title' }));
    expect(run(root, 'rename-field', 'post', 'title', 'headline', '--apply').status).toBe(0);
    const post_ = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8')).collections.post;
    expect([post_.titleField, post_.slugFrom]).toEqual(['headline', 'headline']);
    expect(validate(root).status).toBe(0);
  });

  it.each([
    ['post', 'title', 'author'],
    ['post', 'title', 'draft'],
    ['post', 'title', '9x'],
    ['nope', 'title', 'x'],
    ['post', 'nope', 'x'],
  ])('exits 2 for %s %s %s', async (...args) => {
    const root = await copyOfSite();
    const res = run(root, 'rename-field', ...args, '--apply');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('rename-field:');
  });

  it('exits 2 without arguments', async () => {
    expect(run(await copyOfSite(), 'rename-field', 'post').status).toBe(2);
  });

  it('falls back to serializer for a flow-mapping entry', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, post), '---\n{title: Hello, author: author/jane}\n---\nHi\n');
    expect(run(root, 'rename-field', 'post', 'author', 'writer', '--apply').status).toBe(0);
    const text = await readFile(join(root, post), 'utf8');
    expect(text).toContain('writer: author/jane');
    expect(text).toContain('title: Hello');
    expect(text.endsWith('---\n\nHi\n')).toBe(true);
    expect(validate(root).status).toBe(0);
  });

  it('exits 1 and writes nothing when the result is invalid', async () => {
    const root = await copyOfSite();
    const before = await readFile(join(root, 'cms/schema.json'), 'utf8');
    await writeFile(join(root, post), '---\ntitle: 5x\nauthor: author/nobody\n---\n');
    const res = run(root, 'rename-field', 'post', 'title', 'headline', '--apply');
    expect(res.status).toBe(1);
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(before);
  });
});

describe('schema remove-field', () => {
  it('dry run reports data loss', async () => {
    const root = await copyOfSite();
    const res = run(root, 'remove-field', 'post', 'featuredImage');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain(`loses data: ${post} (featuredImage)`);
    expect(res.stdout).toContain('note: image files are left on disk: cms/content/post/hello-world/cover.webp');
    expect(res.stdout).toContain('dry run');
    expect(await readFile(join(root, post), 'utf8')).toContain('featuredImage:');
  });

  it('--apply removes key and continuation lines, drops titleField/slugFrom, keeps the image', async () => {
    const root = await copyOfSite();
    await setSchema(root, (s) => Object.assign(s.collections.post, { titleField: 'featuredImage' }));
    const res = run(root, 'remove-field', 'post', 'featuredImage', '--apply');
    expect(res.status).toBe(0);
    expect(await readFile(join(root, post), 'utf8')).toBe(
      '---\ntitle: Hello world\nauthor: author/jane\n---\nHello!\n',
    );
    const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    expect(schema.collections.post.fields.featuredImage).toBeUndefined();
    expect(schema.collections.post.titleField).toBeUndefined();
    await stat(join(root, 'cms/content/post/hello-world/cover.webp'));
    expect(validate(root).status).toBe(0);
  });

  it('a markdown field notes and clears bodies', async () => {
    const root = await copyOfSite();
    const dry = run(root, 'remove-field', 'post', 'body');
    expect(dry.stdout).toContain(`loses body: ${post}`);
    expect(run(root, 'remove-field', 'post', 'body', '--apply').status).toBe(0);
    expect(await readFile(join(root, post), 'utf8').then((t) => t.endsWith('---\n'))).toBe(true);
    expect(validate(root).status).toBe(0);
  });

  it('dry run notes a dropped titleField / slugFrom', async () => {
    const root = await copyOfSite();
    await setSchema(root, (schema) => {
      schema.collections.post.titleField = 'featuredImage';
    });
    const res = run(root, 'remove-field', 'post', 'featuredImage');
    expect(res.stdout).toContain('note: titleField/slugFrom "featuredImage" removed from post');
  });

  it('exits 2 for an unknown field', async () => {
    expect(run(await copyOfSite(), 'remove-field', 'post', 'nope').status).toBe(2);
  });
});

describe('schema check count', () => {
  it('counts only entry files', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, 'cms/content/post/.hidden.md'), 'x');
    await writeFile(join(root, 'cms/content/notes.md'), 'x');
    const res = run(root, 'check', join(root, 'cms/schema.json'));
    expect(res.stdout).toContain('(3 entries checked)');
  });
});

const changedLines = (a: string[], b: string[]) => a.filter((line, i) => line !== b[i]).length;

describe('schema minimal text edits', () => {
  const schemaFile = 'cms/schema.json';
  const lines = async (root: string) => (await readFile(join(root, schemaFile), 'utf8')).split('\n');

  it('rename changes exactly one line and leaves the other collection alone', async () => {
    const root = await copyOfSite();
    const before = await lines(root);
    expect(run(root, 'rename-field', 'post', 'title', 'headline', '--apply').status).toBe(0);
    const after = await lines(root);
    expect(after).toHaveLength(before.length);
    expect(changedLines(before, after)).toBe(1);
    const schema = JSON.parse(after.join('\n'));
    expect(Object.keys(schema.collections.post.fields)[0]).toBe('headline');
    expect(Object.keys(schema.collections.homePage.fields)).toEqual(['title']);
    expect(validate(root).status).toBe(0);
  });

  it('titleField and slugFrom follow a rename with one-line changes', async () => {
    const root = await copyOfSite();
    const path = join(root, schemaFile);
    const text = (await readFile(path, 'utf8')).replace(
      '"label": "Post",',
      '"label": "Post",\n      "titleField": "title",\n      "slugFrom": "title",',
    );
    await writeFile(path, text);
    const before = await lines(root);
    expect(run(root, 'rename-field', 'post', 'title', 'headline', '--apply').status).toBe(0);
    const after = await lines(root);
    expect(after).toHaveLength(before.length);
    expect(changedLines(before, after)).toBe(3);
    const post_ = JSON.parse(after.join('\n')).collections.post;
    expect([post_.titleField, post_.slugFrom]).toEqual(['headline', 'headline']);
  });

  it('remove deletes exactly the field line (middle and last fields)', async () => {
    const root = await copyOfSite();
    const before = await lines(root);
    expect(run(root, 'remove-field', 'post', 'featuredImage', '--apply').status).toBe(0);
    const middle = await lines(root);
    expect(middle).toEqual(before.filter((line) => !line.includes('"featuredImage"')));
    expect(run(root, 'remove-field', 'post', 'author', '--apply').status).toBe(0);
    const last = (await lines(root)).join('\n');
    expect(Object.keys(JSON.parse(last).collections.post.fields)).toEqual(['title', 'body']);
    expect(last).toContain('"body": { "type": "markdown", "label": "Body" }\n');
    expect(validate(root).status).toBe(0);
  });

  it('remove drops titleField / slugFrom lines and leaves the other collection alone', async () => {
    const root = await copyOfSite();
    const path = join(root, schemaFile);
    await writeFile(
      path,
      (await readFile(path, 'utf8')).replace(
        '"label": "Post",',
        '"label": "Post",\n      "titleField": "featuredImage", "slugFrom": "title",',
      ),
    );
    const before = await lines(root);
    expect(run(root, 'remove-field', 'post', 'featuredImage', '--apply').status).toBe(0);
    const after = await lines(root);
    expect(after.some((line) => line.includes('featuredImage'))).toBe(false);
    expect(after.join('\n')).toContain('"slugFrom": "title",');
    expect(before.length - after.length).toBe(1);
    expect(JSON.parse(after.join('\n')).collections.homePage.fields.title).toBeDefined();
  });

  it('works on an already 2-space-formatted schema', async () => {
    const root = await copyOfSite();
    await setSchema(root, () => {});
    const before = await lines(root);
    expect(run(root, 'rename-field', 'post', 'title', 'headline', '--apply').status).toBe(0);
    const after = await lines(root);
    expect(changedLines(before, after)).toBe(1);
    expect(run(root, 'remove-field', 'post', 'author', '--apply').status).toBe(0);
    expect(Object.keys(JSON.parse((await lines(root)).join('\n')).collections.post.fields)).toEqual([
      'headline',
      'body',
      'featuredImage',
    ]);
  });
});

describe('schema apply safety', () => {
  it('rename-field refuses an entry that already has a key named like the target', async () => {
    const root = await copyOfSite();
    const before = await readFile(join(root, 'cms/schema.json'), 'utf8');
    await writeFile(join(root, post), '---\ntitle: Hello\nheadline: Existing\nauthor: author/jane\n---\nHi\n');
    const res = run(root, 'rename-field', 'post', 'title', 'headline', '--apply');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`${post}: headline — Field "headline" already exists in this entry`);
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(before);
    expect(await readFile(join(root, post), 'utf8')).toContain('headline: Existing');
  });

  it('--apply writes entries first, the schema last, and reports a failed write', async () => {
    const root = await copyOfSite();
    const second = 'cms/content/post/second.md';
    await writeFile(join(root, second), await readFile(join(root, post), 'utf8'));
    await chmod(join(root, second), 0o444);
    const schemaBefore = await readFile(join(root, 'cms/schema.json'), 'utf8');
    const res = run(root, 'rename-field', 'post', 'title', 'headline', '--apply');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`write failed: ${second}: `);
    expect(res.stderr).toContain(`already written: ${post}`);
    expect(res.stderr).not.toContain('    at ');
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(schemaBefore);
  });
});
