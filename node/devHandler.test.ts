// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDevHandler } from './devHandler';

import {
  DEV_API_BASE,
  type DevCommitRequest,
  type DevErrorResponse,
  type DevFilesResponse,
  type DevGitFile,
  type DevGitResponse,
  type DevVersionsResponse,
} from '../core/devApi';
import { gitBlobSha } from '../core/sha';
import type { FileHistory } from '../core/source';

const site = join(import.meta.dirname, '__fixtures__/site');
const ORIGIN = 'http://localhost:3000';

const temps: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-dev-'));
  temps.push(dir);
  return dir;
}
async function copyOfSite(): Promise<string> {
  const dir = await tempDir();
  await cp(site, dir, { recursive: true });
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function fileUrl(path: string): string {
  return `${ORIGIN}${DEV_API_BASE}/file?path=${encodeURIComponent(path)}`;
}

function versionsUrl(path: string, limit?: string): string {
  return `${ORIGIN}${DEV_API_BASE}/versions?${new URLSearchParams({ path, ...(limit ? { limit } : {}) })}`;
}
function versionUrl(path: string, commit: string): string {
  return `${ORIGIN}${DEV_API_BASE}/version?${new URLSearchParams({ path, commit })}`;
}

async function setup() {
  const root = await copyOfSite();
  const handler = createDevHandler({ root });
  const get = (path: string) => handler(new Request(fileUrl(path)));
  const put = (path: string, body: string | Uint8Array<ArrayBuffer>, headers: Record<string, string> = {}) =>
    handler(new Request(fileUrl(path), { method: 'PUT', body, headers }));
  const del = (path: string, headers: Record<string, string> = {}) =>
    handler(new Request(fileUrl(path), { method: 'DELETE', headers }));
  const commit = (body: DevCommitRequest | string, headers: Record<string, string> = {}) =>
    handler(
      new Request(`${ORIGIN}${DEV_API_BASE}/commit`, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
        headers,
      }),
    );
  const sha = async (path: string) => gitBlobSha(await readFile(join(root, path)));
  return { root, handler, get, put, del, commit, sha };
}

async function expectError(res: Response, status: number): Promise<DevErrorResponse> {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toBe('application/json');
  const body = (await res.json()) as DevErrorResponse;
  expect(body.issues.length).toBeGreaterThan(0);
  return body;
}

describe('createDevHandler', () => {
  it('lists the content tree and the schema with git blob shas', async () => {
    const { root, handler } = await setup();
    await writeFile(join(root, 'cms/content/post/.gitkeep'), '');
    await writeFile(join(root, 'cms/content/post/notes.txt'), 'stray');
    const res = await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    const { files } = (await res.json()) as DevFilesResponse;
    expect(files.map((f) => f.path)).toEqual([
      'cms/content/author/jane.md',
      'cms/content/homePage/index.md',
      'cms/content/post/hello-world.md',
      'cms/content/post/hello-world/cover.webp',
      'cms/content/post/notes.txt',
      'cms/schema.json',
    ]);
    for (const f of files) expect(f.sha).toMatch(/^[0-9a-f]{40}$/);
    const jane = files.find((f) => f.path === 'cms/content/author/jane.md');
    expect(jane?.sha).toBe(await gitBlobSha(await readFile(join(root, 'cms/content/author/jane.md'))));
  });

  it('GET returns exact bytes with a content type', async () => {
    const { root, get } = await setup();
    const img = await get('cms/content/post/hello-world/cover.webp');
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/webp');
    const expected = await readFile(join(root, 'cms/content/post/hello-world/cover.webp'));
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(new Uint8Array(expected));

    expect(img.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(img.headers.get('x-content-type-options')).toBe('nosniff');

    const md = await get('cms/content/author/jane.md');
    expect(md.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(md.headers.get('content-security-policy')).toBe("sandbox; default-src 'none'");
    expect(md.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await md.text()).toBe(await readFile(join(root, 'cms/content/author/jane.md'), 'utf8'));

    const schema = await get('cms/schema.json');
    expect(schema.headers.get('content-type')).toBe('application/json');
  });

  it('GET of a writable but missing path is 404', async () => {
    const { get } = await setup();
    await expectError(await get('cms/content/post/missing.md'), 404);
  });

  it('PUT of a valid entry writes it', async () => {
    const { root, put } = await setup();
    const content = '---\ntitle: New\nauthor: author/jane\n---\nHi\n';
    const res = await put('cms/content/post/new-post.md', content);
    expect(res.status).toBe(204);
    expect(await readFile(join(root, 'cms/content/post/new-post.md'), 'utf8')).toBe(content);
  });

  it('PUT creates missing parent directories', async () => {
    const { root, put } = await setup();
    const res = await put('cms/content/post/new-post/cover.png', new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(204);
    expect(new Uint8Array(await readFile(join(root, 'cms/content/post/new-post/cover.png')))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it('PUT of an invalid entry is 422 and leaves the file unchanged', async () => {
    const { root, put } = await setup();
    const file = join(root, 'cms/content/post/hello-world.md');
    const before = await readFile(file, 'utf8');
    const { issues } = await expectError(
      await put('cms/content/post/hello-world.md', '---\nauthor: author/nobody\n---\n'),
      422,
    );
    expect(issues).toContainEqual({ file: 'cms/content/post/hello-world.md', path: 'title', message: 'Required' });
    expect(issues).toContainEqual({
      file: 'cms/content/post/hello-world.md',
      path: 'author',
      message: 'Referenced entry not found: author/nobody',
    });
    expect(await readFile(file, 'utf8')).toBe(before);
  });

  it('PUT of an entry with invalid UTF-8 is 422', async () => {
    const { put } = await setup();
    await expectError(await put('cms/content/author/bob.md', new Uint8Array([0x2d, 0xff])), 422);
  });

  it('PUT of an invalid schema is 422 and leaves it unchanged', async () => {
    const { root, put } = await setup();
    const before = await readFile(join(root, 'cms/schema.json'), 'utf8');
    const { issues } = await expectError(await put('cms/schema.json', '{ "contentDir": "" }'), 422);
    expect(issues.every((i) => i.file === 'cms/schema.json')).toBe(true);
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(before);
  });

  it('PUT of a valid schema writes it', async () => {
    const { root, put } = await setup();
    const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    schema.collections.author.label = 'Writer';
    const text = JSON.stringify(schema, null, 2);
    expect((await put('cms/schema.json', text)).status).toBe(204);
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(text);
  });

  it.each(['webp', 'png', 'jpg', 'jpeg', 'avif', 'gif', 'svg'])('PUT of a .%s image writes raw bytes', async (ext) => {
    const { root, put } = await setup();
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    const res = await put(`cms/content/post/hello-world/pic.${ext}`, bytes);
    expect(res.status).toBe(204);
    expect(new Uint8Array(await readFile(join(root, `cms/content/post/hello-world/pic.${ext}`)))).toEqual(bytes);
  });

  it.each(['../package.json', '/etc/passwd', 'src/app/page.tsx', 'cms/content/post/script.ts', 'package.json'])(
    'rejects %s with 400 for every method',
    async (path) => {
      const { get, put, del } = await setup();
      await expectError(await get(path), 400);
      await expectError(await put(path, 'x'), 400);
      await expectError(await del(path), 400);
    },
  );

  it('requires the path query parameter', async () => {
    const { handler } = await setup();
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/file`)), 400);
  });

  it('DELETE removes a file and 404s when missing', async () => {
    const { root, put, del } = await setup();
    expect((await put('cms/content/post/hello-world/pic.png', new Uint8Array([1]))).status).toBe(204);
    expect((await del('cms/content/post/hello-world/pic.png')).status).toBe(204);
    await expect(readFile(join(root, 'cms/content/post/hello-world/pic.png'))).rejects.toThrow();
    await expectError(await del('cms/content/post/hello-world/pic.png'), 404);
    await expectError(await del('cms/content/post/missing.md'), 404);
  });

  it('DELETE of a referenced entry or image is 422 and keeps the file', async () => {
    const { root, del } = await setup();
    const { issues } = await expectError(await del('cms/content/author/jane.md'), 422);
    expect(issues).toEqual([
      { file: 'cms/content/post/hello-world.md', path: 'author', message: 'Referenced entry not found: author/jane' },
    ]);
    const image = await expectError(await del('cms/content/post/hello-world/cover.webp'), 422);
    expect(image.issues[0]).toMatchObject({ file: 'cms/content/post/hello-world.md', path: 'featuredImage.src' });
    await readFile(join(root, 'cms/content/author/jane.md'));
    await readFile(join(root, 'cms/content/post/hello-world/cover.webp'));
  });

  it('PUT of a schema that breaks existing entries is 422', async () => {
    const { root, put } = await setup();
    const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    schema.collections.author.fields.bio = { type: 'string', label: 'Bio', required: true };
    const { issues } = await expectError(await put('cms/schema.json', JSON.stringify(schema)), 422);
    expect(issues).toEqual([{ file: 'cms/content/author/jane.md', path: 'bio', message: 'Required' }]);
  });

  it('PUT and DELETE honour If-Match (bare or quoted)', async () => {
    const { root, put, del, sha } = await setup();
    const jane = 'cms/content/author/jane.md';
    const before = await readFile(join(root, jane), 'utf8');
    const stale = '0'.repeat(40);
    const mismatch = await expectError(await put(jane, '---\nname: J\n---\n', { 'If-Match': stale }), 412);
    expect(mismatch.issues[0]).toMatchObject({ file: jane, path: '' });
    expect(await readFile(join(root, jane), 'utf8')).toBe(before);
    expect((await put(jane, '---\nname: J\n---\n', { 'If-Match': await sha(jane) })).status).toBe(204);
    expect((await put(jane, '---\nname: K\n---\n', { 'If-Match': `"${await sha(jane)}"` })).status).toBe(204);
    await expectError(await put('cms/content/author/bob.md', '---\nname: B\n---\n', { 'If-Match': stale }), 412);
    await expect(readFile(join(root, 'cms/content/author/bob.md'))).rejects.toThrow();

    const pic = 'cms/content/post/hello-world/pic.png';
    expect((await put(pic, new Uint8Array([1]))).status).toBe(204);
    await expectError(await del(pic, { 'If-Match': stale }), 412);
    await expectError(await del('cms/content/post/hello-world/nope.png', { 'If-Match': stale }), 412);
    expect((await del(pic, { 'If-Match': `"${await sha(pic)}"` })).status).toBe(204);
  });

  it('DELETE of the schema file is 400', async () => {
    const { root, del } = await setup();
    await expectError(await del('cms/schema.json'), 400);
    await readFile(join(root, 'cms/schema.json'));
  });

  it('returns 403 for every request in production', async () => {
    const { handler, get, put, commit } = await setup();
    vi.stubEnv('NODE_ENV', 'production');
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`)), 403);
    await expectError(await get('cms/content/author/jane.md'), 403);
    await expectError(await put('cms/content/author/jane.md', '---\nname: X\n---\n'), 403);
    await expectError(await handler(new Request(`${ORIGIN}/nope`)), 403);
    await expectError(await commit({ message: 'x', changes: [] }), 403);
  });

  it('rejects a cross-origin request with 403', async () => {
    const { handler } = await setup();
    const req = new Request(`${ORIGIN}${DEV_API_BASE}/files`, { headers: { origin: 'http://evil.test' } });
    await expectError(await handler(req), 403);
    const same = new Request(`${ORIGIN}${DEV_API_BASE}/files`, { headers: { origin: ORIGIN } });
    expect((await handler(same)).status).toBe(200);
  });

  it('returns 404 for unknown routes and 405 for wrong methods', async () => {
    const { handler } = await setup();
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/nope`)), 404);
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files/`)), 404);
    await expectError(await handler(new Request(`${ORIGIN}/`)), 404);
    const filesPost = await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`, { method: 'POST' }));
    expect(filesPost.headers.get('allow')).toBe('GET');
    await expectError(filesPost, 405);
    const filePost = await handler(new Request(fileUrl('cms/content/author/jane.md'), { method: 'POST' }));
    expect(filePost.headers.get('allow')).toBe('GET, PUT, DELETE');
    await expectError(filePost, 405);
  });

  it('rejects an empty path and an encoded ".." path with 400', async () => {
    const { handler } = await setup();
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/file?path=`)), 400);
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/file?path=%2e%2e/package.json`)), 400);
    const deep = `${ORIGIN}${DEV_API_BASE}/file?path=cms/content/post/%2e%2e/%2e%2e/%2e%2e/package.json`;
    await expectError(await handler(new Request(deep, { method: 'PUT', body: 'x' })), 400);
  });

  it('only answers on local hosts unless more are allowed', async () => {
    const root = await copyOfSite();
    const handler = createDevHandler({ root });
    const list = (origin: string) => handler(new Request(`${origin}${DEV_API_BASE}/files`, { headers: { origin } }));
    await expectError(await list('http://evil.test:3000'), 403);
    await expectError(await list('http://localhost.evil.test'), 403);
    for (const ok of ['http://localhost:3000', 'http://127.0.0.1:4321', 'http://[::1]:3000', 'http://app.localhost']) {
      expect((await list(ok)).status).toBe(200);
    }
    const lan = createDevHandler({ root, allowedHosts: ['dev.example.test'] });
    const url = `http://dev.example.test:3000${DEV_API_BASE}/files`;
    expect((await lan(new Request(url))).status).toBe(200);
    await expectError(await lan(new Request(`http://other.example.test${DEV_API_BASE}/files`)), 403);
  });

  it('returns 400 for paths through a file and for directory targets', async () => {
    const { root, get, put, del } = await setup();
    const through = 'cms/content/post/hello-world.md/cover.png';
    await expectError(await get(through), 400);
    await expectError(await put(through, new Uint8Array([1])), 400);
    await expectError(await del(through), 400);
    await mkdir(join(root, 'cms/content/post/folder.png'));
    await expectError(await get('cms/content/post/folder.png'), 400);
    await expectError(await put('cms/content/post/folder.png', new Uint8Array([1])), 400);
    await expectError(await del('cms/content/post/folder.png'), 400);
  });

  it('returns JSON 500 for unexpected fs errors', async () => {
    const { root, get } = await setup();
    await chmod(join(root, 'cms/content/author/jane.md'), 0o000);
    const { issues } = await expectError(await get('cms/content/author/jane.md'), 500);
    expect(issues[0].message).toContain('EACCES');
  });

  it('rejects writes that escape contentDir through a symlink', async () => {
    const { root, put, get } = await setup();
    const outside = await tempDir();
    await symlink(outside, join(root, 'cms/content/post/linked'));
    await expectError(await put('cms/content/post/linked/evil.png', new Uint8Array([1])), 400);
    await expectError(await put('cms/content/post/linked/deeper/evil.png', new Uint8Array([1])), 400);
    await writeFile(join(outside, 'secret.png'), 'secret');
    await expectError(await get('cms/content/post/linked/secret.png'), 400);
    await expect(readFile(join(outside, 'evil.png'))).rejects.toThrow();
  });

  it('re-reads the schema per request and keeps the schema file editable when it is broken', async () => {
    const { root, handler, get, put } = await setup();
    const good = await readFile(join(root, 'cms/schema.json'), 'utf8');
    await writeFile(join(root, 'cms/schema.json'), '{ broken');
    await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`)), 500);
    await expectError(await get('cms/content/author/jane.md'), 500);
    const schema = await get('cms/schema.json');
    expect(schema.status).toBe(200);
    expect(await schema.text()).toBe('{ broken');
    await expectError(await put('cms/schema.json', '{ still broken'), 422);
    await expectError(await handler(new Request(fileUrl('cms/schema.json'), { method: 'DELETE' })), 400);
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe('{ broken');
    expect((await put('cms/schema.json', good)).status).toBe(204);
    expect((await get('cms/content/author/jane.md')).status).toBe(200);
  });

  it('honours a custom schema path', async () => {
    const root = await copyOfSite();
    await mkdir(join(root, 'config'));
    await cp(join(root, 'cms/schema.json'), join(root, 'config/editlet.json'));
    await rm(join(root, 'cms/schema.json'));
    const handler = createDevHandler({ root, schemaPath: 'config/editlet.json' });
    const res = await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`));
    const { files } = (await res.json()) as DevFilesResponse;
    expect(files.map((f) => f.path)).toContain('config/editlet.json');
    await expectError(await handler(new Request(fileUrl('cms/schema.json'))), 400);
  });

  describe('GET history', () => {
    const historyUrl = (path: string) => `${ORIGIN}${DEV_API_BASE}/history?path=${encodeURIComponent(path)}`;

    it('is empty outside a git checkout', async () => {
      const { handler } = await setup();
      const res = await handler(new Request(historyUrl('cms/content/x.md')));
      expect(await res.json()).toEqual({ updated: null, created: null, commits: 0 });
    });

    it('reports the newest and oldest commit of the file', async () => {
      const { root, handler, put } = await setup();
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=a@t', ...args], { cwd: root });
      git('init', '-b', 'main');
      git('add', '.');
      git('commit', '-m', 'init');
      const listing = (await (await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`))).json()) as DevFilesResponse;
      const entry = listing.files.find((f) => f.path.endsWith('.md'))!;
      const current = await readFile(join(root, entry.path), 'utf8');
      expect((await put(entry.path, `${current}\n`)).status).toBe(204);
      git('commit', '-am', 'second');
      const body = (await (await handler(new Request(historyUrl(entry.path)))).json()) as FileHistory;
      expect(body.commits).toBe(2);
      expect(body.updated).toMatchObject({ actor: { name: 'Ann' }, message: 'second' });
      expect(body.created).toMatchObject({ message: 'init' });
    });

    it('needs a safe path and GET', async () => {
      const { handler } = await setup();
      expect((await handler(new Request(`${ORIGIN}${DEV_API_BASE}/history`))).status).toBe(400);
      expect((await handler(new Request(historyUrl('../x')))).status).toBe(400);
      expect((await handler(new Request(historyUrl('a.md'), { method: 'POST' }))).status).toBe(405);
    });
  });

  describe('GET versions and version', () => {
    const POST = 'cms/content/post/hello-world.md';
    /** A checkout with two commits of POST: init and second. */
    async function withHistory() {
      const ctx = await setup();
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=a@t', ...args], { cwd: ctx.root })
          .toString()
          .trim();
      git('init', '-b', 'main');
      git('add', '.');
      git('commit', '-m', 'init');
      const first = await readFile(join(ctx.root, POST), 'utf8');
      await writeFile(join(ctx.root, POST), `${first}\nMore.\n`);
      git('commit', '-am', 'second');
      return { ...ctx, git, first };
    }

    it('is an empty list outside a git checkout, and 404 for a version', async () => {
      const { handler } = await setup();
      expect(await (await handler(new Request(versionsUrl(POST)))).json()).toEqual({ versions: [] });
      expect((await handler(new Request(versionUrl(POST, 'a'.repeat(40))))).status).toBe(404);
    });

    it('lists the commits of one file, newest first, with the blob sha after each', async () => {
      const { handler, git, sha } = await withHistory();
      const { versions } = (await (await handler(new Request(versionsUrl(POST)))).json()) as DevVersionsResponse;
      expect(versions.map((v) => v.message)).toEqual(['second', 'init']);
      expect(versions[0]).toMatchObject({
        actor: { name: 'Ann' },
        commit: git('rev-parse', 'HEAD'),
        sha: await sha(POST),
      });
      expect(versions[1]!.sha).toBe(git('rev-parse', `HEAD~1:${POST}`));
      expect(versions[0]!.date).toMatch(/^\d{4}-\d\d-\d\dT/);
      const one = (await (await handler(new Request(versionsUrl(POST, '1')))).json()) as DevVersionsResponse;
      expect(one.versions).toHaveLength(1);
    });

    it('marks the commit that deleted the file with a null sha', async () => {
      const { handler, git, root, first } = await withHistory();
      git('rm', '-q', POST);
      git('commit', '-m', 'remove');
      await writeFile(join(root, POST), first);
      git('add', POST);
      git('commit', '-m', 'back');
      const { versions } = (await (await handler(new Request(versionsUrl(POST)))).json()) as DevVersionsResponse;
      expect(versions.map((v) => [v.message, v.sha === null])).toEqual([
        ['back', false],
        ['remove', true],
        ['second', false],
        ['init', false],
      ]);
    });

    it('does not follow renames, even with log.follow in the git config', async () => {
      const { handler, git, sha } = await withHistory();
      const moved = 'cms/content/post/moved.md';
      git('mv', POST, moved);
      git('commit', '-m', 'move');
      git('config', 'log.follow', 'true');
      const { versions } = (await (await handler(new Request(versionsUrl(moved)))).json()) as DevVersionsResponse;
      expect(versions.map((v) => v.message)).toEqual(['move']);
      expect(versions[0]!.sha).toBe(await sha(moved));
    });

    it('serves the file as a commit left it, and 404 where it was not', async () => {
      const { handler, git, first } = await withHistory();
      const res = await handler(new Request(versionUrl(POST, git('rev-parse', 'HEAD~1'))));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(await res.text()).toBe(first);
      await expectError(await handler(new Request(versionUrl(POST, git('rev-parse', '--short', 'HEAD')))), 400);
      const missing = 'cms/content/post/nope.md';
      expect((await handler(new Request(versionUrl(missing, git('rev-parse', 'HEAD'))))).status).toBe(404);
      expect((await handler(new Request(versionUrl(POST, 'f'.repeat(40))))).status).toBe(404);
    });

    it('works when the site is a folder inside the repository', async () => {
      const outer = await tempDir();
      await cp(site, join(outer, 'site'), { recursive: true });
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=Ann', '-c', 'user.email=a@t', ...args], { cwd: outer })
          .toString()
          .trim();
      git('init', '-b', 'main');
      git('add', '.');
      git('commit', '-m', 'init');
      const handler = createDevHandler({ root: join(outer, 'site') });
      const { versions } = (await (await handler(new Request(versionsUrl(POST)))).json()) as DevVersionsResponse;
      expect(versions).toHaveLength(1);
      expect(versions[0]!.sha).toBe(git('rev-parse', `HEAD:site/${POST}`));
      const res = await handler(new Request(versionUrl(POST, versions[0]!.commit)));
      expect(await res.text()).toBe(await readFile(join(outer, 'site', POST), 'utf8'));
    });

    it('needs a content path, a commit id, a limit in range and GET', async () => {
      const { handler } = await setup();
      await expectError(await handler(new Request(`${ORIGIN}${DEV_API_BASE}/versions`)), 400);
      await expectError(await handler(new Request(versionsUrl('package.json'))), 400);
      await expectError(await handler(new Request(versionsUrl('../x.md'))), 400);
      await expectError(await handler(new Request(versionsUrl(POST, '0'))), 400);
      await expectError(await handler(new Request(versionsUrl(POST, '101'))), 400);
      await expectError(await handler(new Request(versionUrl('.env', 'a'.repeat(40)))), 400);
      await expectError(await handler(new Request(versionsUrl('cms/content/post/a\nb.md'))), 400);
      await expectError(await handler(new Request(versionUrl(POST, 'HEAD'))), 400);
      await expectError(await handler(new Request(versionUrl(POST, '--output=x'))), 400);
      expect((await handler(new Request(versionsUrl(POST), { method: 'POST' }))).status).toBe(405);
      expect((await handler(new Request(versionsUrl('cms/schema.json')))).status).toBe(200);
    });

    it('answers 500 with the issues while the schema is broken', async () => {
      const { root, handler } = await setup();
      await writeFile(join(root, 'cms/schema.json'), '{ broken');
      await expectError(await handler(new Request(versionsUrl(POST))), 500);
      expect((await handler(new Request(versionsUrl('cms/schema.json')))).status).toBe(200);
    });
  });

  describe('GET git', () => {
    const gitUrl = `${ORIGIN}${DEV_API_BASE}/git`;
    const C = 'cms/content';
    const readGit = async (handler: (req: Request) => Promise<Response>) =>
      (await (await handler(new Request(gitUrl))).json()) as DevGitResponse;
    const repo = (cwd: string) => {
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd })
          .toString()
          .trim();
      git('init', '-b', 'feature');
      git('add', '.');
      git('commit', '-m', 'init');
      return git;
    };
    const sorted = (files: DevGitFile[]) => files.toSorted((a, b) => a.path.localeCompare(b.path));

    it('answers no branch and no files outside a git checkout, with a project id', async () => {
      const { root, handler } = await setup();
      const res = await handler(new Request(gitUrl));
      expect(res.status).toBe(200);
      const body = (await res.json()) as DevGitResponse;
      expect(body).toEqual({ branch: null, changes: 0, files: [], project: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(body.project).not.toContain(root);
    });

    it('hashes the given root when it cannot be resolved', async () => {
      const handler = createDevHandler({ root: join(await tempDir(), 'missing') });
      expect((await readGit(handler)).project).toMatch(/^[0-9a-f]{64}$/);
    });

    it('reports the branch and the uncommitted files under contentDir', async () => {
      const { root, handler, put } = await setup();
      repo(root);
      expect(await readGit(handler)).toMatchObject({ branch: 'feature', changes: 0, files: [] });

      const listing = (await (await handler(new Request(`${ORIGIN}${DEV_API_BASE}/files`))).json()) as DevFilesResponse;
      const entry = listing.files.find((f) => f.path.endsWith('.md'))!;
      const current = await readFile(join(root, entry.path), 'utf8');
      expect((await put(entry.path, `${current}\n`)).status).toBe(204);
      expect(await readGit(handler)).toMatchObject({
        branch: 'feature',
        changes: 1,
        files: [{ path: entry.path, status: 'modified' }],
      });
    });

    it('lists each kind of change by path, a rename as one change and two files', async () => {
      const { root, handler } = await setup();
      const git = repo(root);
      await writeFile(join(root, C, 'author/jane.md'), '---\nname: Jane D\n---\n');
      await writeFile(join(root, C, 'author/new one.md'), '---\nname: New\n---\n');
      await writeFile(join(root, C, 'author/staged.md'), '---\nname: S\n---\n');
      git('add', `${C}/author/staged.md`);
      await writeFile(join(root, C, 'author/ad.md'), '---\nname: AD\n---\n');
      git('add', `${C}/author/ad.md`);
      await rm(join(root, C, 'author/ad.md'));
      await writeFile(join(root, C, 'author/"quoted".md'), '---\nname: Q\n---\n');
      await rm(join(root, C, 'homePage/index.md'));
      git('mv', `${C}/post/hello-world.md`, `${C}/post/hello.md`);
      await writeFile(join(root, 'outside.md'), 'not content');

      const body = await readGit(handler);
      expect(sorted(body.files)).toEqual(
        sorted([
          { path: `${C}/author/jane.md`, status: 'modified' },
          { path: `${C}/author/new one.md`, status: 'added' },
          { path: `${C}/author/staged.md`, status: 'added' },
          { path: `${C}/author/"quoted".md`, status: 'added' },
          { path: `${C}/homePage/index.md`, status: 'removed' },
          { path: `${C}/post/hello.md`, status: 'added' },
          { path: `${C}/post/hello-world.md`, status: 'removed' },
        ]),
      );
      // Porcelain entries, as before: jane, new one, staged, ad (AD), quoted, index, the rename.
      expect(body.changes).toBe(7);
    });

    it('reads a staged delete as removed', async () => {
      const { root, handler } = await setup();
      const git = repo(root);
      git('rm', '-q', `${C}/author/jane.md`);
      expect((await readGit(handler)).files).toEqual([{ path: `${C}/author/jane.md`, status: 'removed' }]);
    });

    it('reads a merge conflict as modified', async () => {
      const { root, handler } = await setup();
      const git = repo(root);
      const jane = `${C}/author/jane.md`;
      git('checkout', '-q', '-b', 'other');
      await writeFile(join(root, jane), '---\nname: Other\n---\n');
      git('commit', '-qam', 'other');
      git('checkout', '-q', 'feature');
      await writeFile(join(root, jane), '---\nname: Feature\n---\n');
      git('commit', '-qam', 'feature');
      expect(() => git('merge', '-q', 'other')).toThrow();
      expect((await readGit(handler)).files).toEqual([{ path: jane, status: 'modified' }]);
    });

    it('still lists the files on a detached HEAD', async () => {
      const { root, handler } = await setup();
      const git = repo(root);
      git('checkout', '-q', '--detach');
      await writeFile(join(root, C, 'author/jane.md'), '---\nname: Detached\n---\n');
      expect(await readGit(handler)).toMatchObject({
        branch: null,
        changes: 1,
        files: [{ path: `${C}/author/jane.md`, status: 'modified' }],
      });
    });

    it('gives paths relative to the project when it is a folder inside the repository', async () => {
      const outer = await tempDir();
      await cp(site, join(outer, 'site'), { recursive: true });
      repo(outer);
      await writeFile(join(outer, 'site', C, 'author/jane.md'), '---\nname: Sub\n---\n');
      await writeFile(join(outer, 'elsewhere.md'), 'x');
      const handler = createDevHandler({ root: join(outer, 'site') });
      expect(await readGit(handler)).toMatchObject({
        changes: 1,
        files: [{ path: `${C}/author/jane.md`, status: 'modified' }],
      });
    });

    it('keeps the project id stable across calls and handlers, and different per project', async () => {
      const { root, handler } = await setup();
      const first = (await readGit(handler)).project;
      expect((await readGit(handler)).project).toBe(first);
      expect((await readGit(createDevHandler({ root }))).project).toBe(first);
      const other = await setup();
      expect((await readGit(other.handler)).project).not.toBe(first);
    });

    it('is GET only', async () => {
      const { handler } = await setup();
      expect((await handler(new Request(gitUrl, { method: 'POST' }))).status).toBe(405);
    });
  });

  describe('POST commit', () => {
    const bob = '---\nname: Bob\n---\n';

    it('answers 500 with the issues for a file other than the schema while the schema is broken', async () => {
      const { root, commit } = await setup();
      await writeFile(join(root, 'cms/schema.json'), '{ broken');
      await expectError(
        await commit({ message: 'x', changes: [{ path: 'cms/content/author/bob.md', content: bob }] }),
        500,
      );
    });

    it('applies a batch of writes and deletes', async () => {
      const { root, commit } = await setup();
      const res = await commit({
        message: 'Drop the cover',
        changes: [
          { path: 'cms/content/post/hello-world.md', content: '---\ntitle: Hello\nauthor: author/jane\n---\nHi\n' },
          { path: 'cms/content/post/hello-world/cover.webp', content: null },
          { path: 'cms/content/author/bob.md', content: bob, encoding: 'utf8' },
        ],
      });
      expect(res.status).toBe(204);
      await expect(readFile(join(root, 'cms/content/post/hello-world/cover.webp'))).rejects.toThrow();
      // The emptied image folder goes too, as in Git; the collection folder still has files and stays.
      await expect(stat(join(root, 'cms/content/post/hello-world'))).rejects.toThrow();
      expect((await stat(join(root, 'cms/content/post'))).isDirectory()).toBe(true);
      expect(await readFile(join(root, 'cms/content/author/bob.md'), 'utf8')).toBe(bob);
    });

    it('is atomic: one invalid entry means nothing is written', async () => {
      const { root, commit } = await setup();
      const { issues } = await expectError(
        await commit({
          message: 'Mixed',
          changes: [
            { path: 'cms/content/author/bob.md', content: bob },
            { path: 'cms/content/post/bad.md', content: '---\n---\n' },
          ],
        }),
        422,
      );
      expect(issues).toContainEqual({ file: 'cms/content/post/bad.md', path: 'title', message: 'Required' });
      await expect(readFile(join(root, 'cms/content/author/bob.md'))).rejects.toThrow();
    });

    it('accepts two new entries that reference each other', async () => {
      const { root, put, commit } = await setup();
      const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
      schema.collections.author.fields.favourite = { type: 'reference', label: 'Fav', collections: ['post'] };
      expect((await put('cms/schema.json', JSON.stringify(schema))).status).toBe(204);
      const res = await commit({
        message: 'Pair',
        changes: [
          { path: 'cms/content/post/pair.md', content: '---\ntitle: Pair\nauthor: author/bob\n---\n' },
          { path: 'cms/content/author/bob.md', content: '---\nname: Bob\nfavourite: post/pair\n---\n' },
        ],
      });
      expect(res.status).toBe(204);
      await readFile(join(root, 'cms/content/post/pair.md'));
      await readFile(join(root, 'cms/content/author/bob.md'));
    });

    it('writes base64 content as raw bytes', async () => {
      const { root, commit } = await setup();
      const bytes = new Uint8Array([0, 255, 128, 10, 13]);
      const path = 'cms/content/post/hello-world/pic.png';
      const res = await commit({
        message: 'Image',
        changes: [{ path, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' }],
      });
      expect(res.status).toBe(204);
      expect(new Uint8Array(await readFile(join(root, path)))).toEqual(bytes);
      await expectError(
        await commit({ message: 'Bad', changes: [{ path, content: 'not base64!', encoding: 'base64' }] }),
        400,
      );
    });

    it('checks expected shas: 409 on any mismatch, nothing written', async () => {
      const { root, commit, sha } = await setup();
      const jane = 'cms/content/author/jane.md';
      const before = await readFile(join(root, jane), 'utf8');
      const edit = '---\nname: Jane D\n---\n';
      const stale = await commit({
        message: 'Stale',
        changes: [
          { path: 'cms/content/author/bob.md', content: bob, sha: null },
          { path: jane, content: edit, sha: '0'.repeat(40) },
        ],
      });
      const { issues } = await expectError(stale, 409);
      expect(issues).toEqual([{ file: jane, path: '', message: expect.stringContaining('changed') }]);
      await expect(readFile(join(root, 'cms/content/author/bob.md'))).rejects.toThrow();
      expect(await readFile(join(root, jane), 'utf8')).toBe(before);

      await expectError(await commit({ message: 'Exists', changes: [{ path: jane, content: edit, sha: null }] }), 409);
      const missing = { path: 'cms/content/author/bob.md', content: bob, sha: '0'.repeat(40) };
      await expectError(await commit({ message: 'Missing', changes: [missing] }), 409);

      const ok = await commit({ message: 'Fresh', changes: [{ path: jane, content: edit, sha: await sha(jane) }] });
      expect(ok.status).toBe(204);
      expect(await readFile(join(root, jane), 'utf8')).toBe(edit);
    });

    it('rejects a bad body or a non-writable path with 400', async () => {
      const { commit } = await setup();
      await expectError(await commit('{ nope'), 400);
      await expectError(await commit(JSON.stringify({ changes: [] })), 400);
      await expectError(await commit(JSON.stringify({ message: 'x', changes: [{ path: 'a.md' }] })), 400);
      const extra = { message: 'x', changes: [{ path: 'cms/content/author/bob.md', content: bob, mode: 1 }] };
      await expectError(await commit(JSON.stringify(extra)), 400);
      const { issues } = await expectError(
        await commit({ message: 'x', changes: [{ path: '../package.json', content: '{}' }] }),
        400,
      );
      expect(issues).toEqual([{ file: '../package.json', path: '', message: 'Path not writable' }]);
    });

    it('rejects an empty message and a referenced delete with 422', async () => {
      const { commit } = await setup();
      const empty = await expectError(
        await commit({ message: ' ', changes: [{ path: 'cms/content/author/bob.md', content: bob }] }),
        422,
      );
      expect(empty.issues).toEqual([{ path: '', message: 'Commit message is required' }]);
      const { issues } = await expectError(
        await commit({ message: 'x', changes: [{ path: 'cms/content/author/jane.md', content: null }] }),
        422,
      );
      expect(issues[0]).toMatchObject({ file: 'cms/content/post/hello-world.md', path: 'author' });
    });

    it('leaves nothing behind when staging a file fails', async () => {
      const { root, commit } = await setup();
      const locked = join(root, 'cms/content/post/hello-world');
      await chmod(locked, 0o555);
      try {
        const res = await commit({
          message: 'Partial',
          changes: [
            { path: 'cms/content/author/bob.md', content: bob },
            { path: 'cms/content/post/hello-world/pic.png', content: 'AQ==', encoding: 'base64' },
          ],
        });
        await expectError(res, 500);
      } finally {
        await chmod(locked, 0o755);
      }
      expect(await readdir(join(root, 'cms/content/author'))).toEqual(['jane.md']);
    });

    it('allows only POST and applies the same guards', async () => {
      const { handler, commit } = await setup();
      const get = await handler(new Request(`${ORIGIN}${DEV_API_BASE}/commit`));
      expect(get.headers.get('allow')).toBe('POST');
      await expectError(get, 405);
      await expectError(await commit({ message: 'x', changes: [] }, { origin: 'http://evil.test' }), 403);
      const symlinked = await setup();
      const outside = await tempDir();
      await symlink(outside, join(symlinked.root, 'cms/content/post/linked'));
      const res = await symlinked.commit({
        message: 'x',
        changes: [{ path: 'cms/content/post/linked/evil.png', content: 'AQ==', encoding: 'base64' }],
      });
      await expectError(res, 400);
      expect(await readdir(outside)).toEqual([]);
    });

    it('accepts a new collection and its first entry in one batch', async () => {
      const { root, commit } = await setup();
      const schema = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
      schema.collections.tag = { label: 'Tag', fields: { name: { type: 'string', label: 'Name', required: true } } };
      const res = await commit({
        message: 'Add tags',
        changes: [
          { path: 'cms/schema.json', content: JSON.stringify(schema) },
          { path: 'cms/content/tag/a.md', content: '---\nname: A\n---\n' },
        ],
      });
      expect(res.status).toBe(204);
      expect(await readFile(join(root, 'cms/content/tag/a.md'), 'utf8')).toBe('---\nname: A\n---\n');
    });

    it('accepts an empty batch', async () => {
      const { commit } = await setup();
      expect((await commit({ message: 'Nothing', changes: [] })).status).toBe(204);
    });
  });
});
