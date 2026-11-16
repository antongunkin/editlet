// @vitest-environment node
import { cp, mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shouldResyncContent, syncContent, syncPublicDir } from './publicDir';

const fixture = fileURLToPath(new URL('./__fixtures__/site', import.meta.url));
const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const adminConfig = { github: { owner: 'acme', repo: 'site', baseBranch: 'main' }, authUrl: '/api/editlet/oauth' };
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'editlet-public-'));
  await cp(fixture, root, { recursive: true });
});
afterEach(() => rm(root, { recursive: true, force: true }));

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('syncPublicDir', () => {
  it('writes admin, marker and images', async () => {
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    const out = join(root, 'public/editlet');
    // the stub when admin/dist is not built, the real admin otherwise
    expect(await readFile(join(out, 'index.html'), 'utf8')).toContain('<html');
    expect(await exists(join(out, '.editlet-generated'))).toBe(true);
    expect(await exists(join(out, 'content/post/hello-world/cover.webp'))).toBe(true);
  });

  it('writes config.json with the admin config, replacing a stale one', async () => {
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    const file = join(root, 'public/editlet/config.json');
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(adminConfig);
    await syncPublicDir(root, undefined, pkgDir, {});
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({});
  });

  it('removes copies whose source is gone', async () => {
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    await rm(join(root, 'cms/content/post/hello-world/cover.webp'));
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    expect(await exists(join(root, 'public/editlet/content/post/hello-world/cover.webp'))).toBe(false);
  });

  it('refuses a folder without the marker', async () => {
    await mkdir(join(root, 'public/editlet'), { recursive: true });
    await writeFile(join(root, 'public/editlet/x.txt'), 'mine');
    await expect(syncPublicDir(root, undefined, pkgDir, adminConfig)).rejects.toThrow(/public\/editlet/);
    expect(await exists(join(root, 'public/editlet/x.txt'))).toBe(true);
  });

  it('keeps the marker when a sync fails, so the next sync succeeds', async () => {
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    const broken = join(root, 'nowhere');
    await expect(syncPublicDir(root, undefined, broken, adminConfig)).rejects.toThrow();
    expect(await exists(join(root, 'public/editlet/.editlet-generated'))).toBe(true);
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    expect(await exists(join(root, 'public/editlet/index.html'))).toBe(true);
  });

  it('content re-sync leaves admin files untouched', async () => {
    await syncPublicDir(root, undefined, pkgDir, adminConfig);
    const admin = join(root, 'public/editlet/index.html');
    const before = await stat(admin);
    await writeFile(join(root, 'public/editlet/sentinel.js'), 'x');
    await rm(join(root, 'cms/content/post/hello-world/cover.webp'));
    await syncContent(root);
    const after = await stat(admin);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await exists(join(root, 'public/editlet/sentinel.js'))).toBe(true);
    expect(await exists(join(root, 'public/editlet/content/post/hello-world/cover.webp'))).toBe(false);
  });

  it('only image or extensionless watch events trigger a re-sync', () => {
    expect(shouldResyncContent('post/a.md')).toBe(false);
    expect(shouldResyncContent('post/a/cover.webp')).toBe(true);
    expect(shouldResyncContent('post/a')).toBe(true);
    expect(shouldResyncContent(null)).toBe(true);
  });
});
