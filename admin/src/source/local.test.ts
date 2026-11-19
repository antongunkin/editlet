// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { detectMode } from './detect';
import { createLocalSource } from './local';

import { EditletError } from '../../../core/issues';
import { createDevHandler } from '../../../node/devHandler';

const site = join(import.meta.dirname, '../../../node/__fixtures__/site');

const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'editlet-admin-'));
  temps.push(root);
  await cp(site, root, { recursive: true });
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return { root, fetch, source: createLocalSource({ fetch }) };
}

describe('createLocalSource', () => {
  it('lists files with git blob shas', async () => {
    const { source } = await setup();
    expect(source.kind).toBe('local');
    const files = await source.listFiles();
    const hello = files.find((f) => f.path === 'cms/content/post/hello-world.md');
    expect(hello?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads a file as bytes', async () => {
    const { source } = await setup();
    const bytes = await source.readFile('cms/content/author/jane.md');
    expect(new TextDecoder().decode(bytes)).toContain('name: Jane');
  });

  it('rejects a missing file with an EditletError', async () => {
    const { source } = await setup();
    const error = await source.readFile('cms/content/post/missing.md').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditletError);
    expect((error as EditletError).message).toContain('File not found: cms/content/post/missing.md');
  });

  it('commits a utf8 change', async () => {
    const { root, source } = await setup();
    const content = '---\nname: Janet\n---\n';
    const result = await source.commit([{ path: 'cms/content/author/jane.md', content }], 'Update author/jane');
    expect(result).toEqual({ issues: [] });
    expect(await readFile(join(root, 'cms/content/author/jane.md'), 'utf8')).toBe(content);
  });

  it('commits binary content as base64', async () => {
    const { root, source } = await setup();
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 31) % 256);
    const path = 'cms/content/post/hello-world/other.webp';
    const result = await source.commit([{ path, content: bytes, sha: null }], 'Upload image');
    expect(result).toEqual({ issues: [] });
    expect(new Uint8Array(await readFile(join(root, path)))).toEqual(bytes);
  });

  it('returns issues for an invalid entry and leaves the file unchanged', async () => {
    const { root, source } = await setup();
    const path = 'cms/content/post/hello-world.md';
    const before = await readFile(join(root, path), 'utf8');
    const result = await source.commit([{ path, content: '---\nauthor: author/jane\n---\nHi\n' }], 'Update');
    expect(result.issues.length).toBeGreaterThan(0);
    expect(await readFile(join(root, path), 'utf8')).toBe(before);
  });

  it('commit with stale sha → issues', async () => {
    const { root, source } = await setup();
    const path = 'cms/content/author/jane.md';
    const before = await readFile(join(root, path), 'utf8');
    const result = await source.commit([{ path, content: '---\nname: X\n---\n', sha: '0'.repeat(40) }], 'Update');
    expect(result.issues.map((i) => i.message)).toContain('File changed since it was read');
    expect(await readFile(join(root, path), 'utf8')).toBe(before);
  });

  it('forwards a matching sha and deletes with null content', async () => {
    const { source } = await setup();
    const files = await source.listFiles();
    const cover = files.find((f) => f.path === 'cms/content/post/hello-world/cover.webp');
    const featured = '---\ntitle: Hello world\nauthor: author/jane\n---\nHello!\n';
    const result = await source.commit(
      [
        { path: 'cms/content/post/hello-world.md', content: featured },
        { path: 'cms/content/post/hello-world/cover.webp', content: null, sha: cover?.sha },
      ],
      'Remove cover',
    );
    expect(result).toEqual({ issues: [] });
    const after = await source.listFiles();
    expect(after.some((f) => f.path === 'cms/content/post/hello-world/cover.webp')).toBe(false);
  });

  it('throws on unexpected statuses', async () => {
    const fetch = (async () => new Response('nope', { status: 500 })) as unknown as typeof globalThis.fetch;
    const source = createLocalSource({ fetch });
    await expect(source.commit([], 'x')).rejects.toThrow('Dev API 500');
    await expect(source.listFiles()).rejects.toThrow('Dev API 500');
    await expect(source.readFile('a.md')).rejects.toThrow('Dev API 500');
  });
});

describe('detectMode', () => {
  it('is local when the dev API answers', async () => {
    const { fetch } = await setup();
    expect(await detectMode(fetch)).toEqual({ mode: 'local' });
  });

  it('is local-broken with issues when the schema is broken', async () => {
    const { root, fetch } = await setup();
    await writeFile(join(root, 'cms/schema.json'), '{ not json');
    const result = await detectMode(fetch);
    expect(result.mode).toBe('local-broken');
    expect(result.mode === 'local-broken' && result.issues.length).toBeGreaterThan(0);
  });

  it('is github on 404', async () => {
    const fetch = (async () => new Response('Not found', { status: 404 })) as unknown as typeof globalThis.fetch;
    expect(await detectMode(fetch)).toEqual({ mode: 'github' });
  });

  it('is github when fetch throws', async () => {
    const fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    expect(await detectMode(fetch)).toEqual({ mode: 'github' });
  });

  it('is github on a 500 without issues', async () => {
    const fetch = (async () => new Response('<html>', { status: 500 })) as unknown as typeof globalThis.fetch;
    expect(await detectMode(fetch)).toEqual({ mode: 'github' });
  });

  it('lists the versions of a file and reads one through the dev API', async () => {
    const { root, source } = await setup();
    const path = 'cms/content/author/jane.md';
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=a@t', ...args], { cwd: root })
        .toString()
        .trim();
    git('init', '-b', 'main');
    git('add', '.');
    git('commit', '-m', 'init');
    const before = await readFile(join(root, path), 'utf8');
    await writeFile(join(root, path), '---\nname: Janet\n---\n');
    git('commit', '-am', 'Rename Jane');
    const versions = await source.listVersions(path);
    expect(versions.map((v) => v.message)).toEqual(['Rename Jane', 'init']);
    expect(await source.listVersions(path, 1)).toHaveLength(1);
    expect(new TextDecoder().decode(await source.readVersion(path, versions[1]!.commit))).toBe(before);
    const error = await source
      .readVersion('cms/content/author/nobody.md', versions[0]!.commit)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditletError);
  });

  it('lists no versions outside a git checkout', async () => {
    const { source } = await setup();
    expect(await source.listVersions('cms/content/author/jane.md')).toEqual([]);
  });
});
