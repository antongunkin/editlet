// @vitest-environment node
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readProject, validateProject, writeTypes } from './project';

import { generateTypes } from '../core/generate';
import { EditletError } from '../core/issues';

const site = join(import.meta.dirname, '__fixtures__/site');
const broken = join(import.meta.dirname, '__fixtures__/broken');

const temps: string[] = [];
async function copyOf(fixture: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-'));
  temps.push(dir);
  await cp(fixture, dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('project', () => {
  it('reports an unreadable non-entry file as an issue instead of rejecting', async () => {
    const dir = await copyOf(site);
    const schema = (await readProject(dir)).schema;
    const target = join(dir, schema.contentDir, 'broken.txt');
    await writeFile(target, 'x');
    await chmod(target, 0o000);
    const project = await readProject(dir);
    expect(project.issues).toEqual([
      { file: `${schema.contentDir}/broken.txt`, path: '', message: 'Not an entry file' },
    ]);
  });

  it('validates a clean project', async () => {
    expect(await validateProject(site)).toEqual([]);
  });

  it('reads all entries', async () => {
    const project = await readProject(site);
    expect(project.entries.length).toBe(3);
    expect(project.issues).toEqual([]);
  });

  it('reports a broken reference', async () => {
    const issues = await validateProject(broken);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe('cms/content/post/broken.md');
    expect(issues[0].path).toBe('author');
  });

  it('reports stray files', async () => {
    const root = await copyOf(site);
    await writeFile(join(root, 'cms/content/post/notes.txt'), 'hi');
    await writeFile(join(root, 'cms/content/post/.gitkeep'), '');
    const issues = await validateProject(root);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe('cms/content/post/notes.txt');
    expect(issues[0].message).toContain('Not an entry file');
  });

  it('reports unparsable frontmatter and skips the entry', async () => {
    const root = await copyOf(site);
    await writeFile(join(root, 'cms/content/post/bad.md'), '---\ntitle: [\n---\n');
    const project = await readProject(root);
    expect(project.entries.length).toBe(3);
    expect(project.issues).toHaveLength(1);
    expect(project.issues[0].file).toBe('cms/content/post/bad.md');
  });

  it('reports invalid UTF-8 for that file only', async () => {
    const root = await copyOf(site);
    await writeFile(join(root, 'cms/content/post/bad.md'), new Uint8Array([0x2d, 0xff, 0xfe]));
    const project = await readProject(root);
    expect(project.entries.length).toBe(3);
    expect(project.issues).toEqual([{ file: 'cms/content/post/bad.md', path: '', message: 'File is not valid UTF-8' }]);
  });

  it('skips hidden paths only below contentDir, and the schema file inside contentDir', async () => {
    const root = await copyOf(site);
    const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    schema.contentDir = '.cms/content';
    await rename(join(root, 'cms'), join(root, '.cms'));
    await writeFile(join(root, '.cms/content/schema.json'), JSON.stringify(schema));
    await mkdir(join(root, '.cms/content/post/.drafts'));
    await writeFile(join(root, '.cms/content/post/.drafts/x.md'), 'junk');
    const project = await readProject(root, '.cms/content/schema.json');
    expect(project.entries.length).toBe(3);
    expect(project.issues).toEqual([]);
    expect(await validateProject(root, '.cms/content/schema.json')).toEqual([]);
  });

  it('rejects when the schema is missing', async () => {
    const root = await copyOf(site);
    await rm(join(root, 'cms/schema.json'));
    await expect(readProject(root)).rejects.toBeInstanceOf(EditletError);
    await expect(validateProject(root)).rejects.toBeInstanceOf(EditletError);
  });

  it('rejects an invalid schema with file-tagged issues', async () => {
    const root = await copyOf(site);
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const error = await readProject(root).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditletError);
    expect((error as EditletError).issues.every((i) => i.file === 'cms/schema.json')).toBe(true);
  });

  it('tolerates a missing contentDir', async () => {
    const root = await copyOf(site);
    await rm(join(root, 'cms/content'), { recursive: true });
    const project = await readProject(root);
    expect(project.entries).toEqual([]);
    expect(project.issues).toEqual([]);
  });

  it('writes types', async () => {
    const root = await copyOf(site);
    const project = await readProject(root);
    const written = await writeTypes(root);
    expect(written).toBe(join(root, '.editlet/content.d.ts'));
    expect(await readFile(written, 'utf8')).toBe(generateTypes(project.schema));
  });
});
