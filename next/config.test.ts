// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withEditlet } from './config';

const startDevApi = vi.hoisted(() => vi.fn(async () => ({ port: 4567, close: async () => undefined })));
vi.mock('./devServer', () => ({ startDevApi }));
const syncSpy = vi.hoisted(() => vi.fn());
vi.mock('./publicDir', async (orig) => {
  const actual = await orig<typeof import('./publicDir')>();
  return {
    ...actual,
    syncPublicDir: (...args: Parameters<typeof actual.syncPublicDir>) => {
      syncSpy();
      return actual.syncPublicDir(...args);
    },
  };
});

const fixture = fileURLToPath(new URL('./__fixtures__/site', import.meta.url));
const DEV = 'phase-development-server';
const BUILD = 'phase-production-build';
const packageDir = fileURLToPath(new URL('..', import.meta.url));
const ctx = { defaultConfig: {} };
let root: string;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'editlet-config-'));
  await cp(fixture, root, { recursive: true });
  delete process.env.EDITLET_NEXT_PREPARED;
  delete (globalThis as Record<string, unknown>).__editletDevApi;
  delete (globalThis as Record<string, unknown>).__editletPrepare;
  delete (globalThis as Record<string, unknown>).__editletAdminConfig;
  syncSpy.mockClear();
  startDevApi.mockClear();
  vi.stubEnv('VERCEL_GIT_REPO_OWNER', '');
  vi.stubEnv('VERCEL_GIT_REPO_SLUG', '');
  vi.stubEnv('GITHUB_REPOSITORY', '');
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete process.env.EDITLET_NEXT_PREPARED;
  await rm(root, { recursive: true, force: true });
});

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

describe('withEditlet', () => {
  it('dev: rewrite, types, merged user config', async () => {
    const userRewrite = { source: '/a', destination: '/b' };
    const config = await withEditlet(
      {
        transpilePackages: ['x'],
        rewrites: async () => [userRewrite],
      },
      { root, packageDir },
    )(DEV, ctx);
    const rewrites = (await config.rewrites!()) as { beforeFiles: unknown[]; afterFiles: unknown[] };
    expect(rewrites.beforeFiles[0]).toEqual({
      source: '/__editlet/:path*',
      destination: 'http://127.0.0.1:4567/__editlet/:path*',
    });
    expect(rewrites.afterFiles).toEqual([userRewrite]);
    expect(config.transpilePackages).toEqual(['x', 'editlet']);
    expect(await readFile(join(root, '.editlet/content.d.ts'), 'utf8')).toBeTruthy();
    expect(await exists(join(root, 'public/editlet/.editlet-generated'))).toBe(true);
  });

  it('dev: keeps user beforeFiles', async () => {
    const user = { source: '/a', destination: '/b' };
    const config = await withEditlet(
      { rewrites: async () => ({ beforeFiles: [user], fallback: [] }) },
      { root, packageDir },
    )(DEV, ctx);
    const rewrites = (await config.rewrites!()) as { beforeFiles: unknown[]; fallback: unknown[] };
    expect(rewrites.beforeFiles[1]).toEqual(user);
    expect(rewrites.fallback).toEqual([]);
  });

  it('dev: bridge starts once across calls', async () => {
    const wrap = withEditlet({}, { root, packageDir });
    await wrap(DEV, ctx);
    await wrap(DEV, ctx);
    expect(startDevApi).toHaveBeenCalledTimes(1);
  });

  it('build: no rewrite, guard runs user hook and rejects on leaked code', async () => {
    const userHook = vi.fn(async () => undefined);
    const config = await withEditlet({ compiler: { runAfterProductionCompile: userHook } }, { root, packageDir })(
      BUILD,
      ctx,
    );
    expect(config.rewrites).toBeUndefined();
    expect(startDevApi).not.toHaveBeenCalled();
    await mkdir(join(root, '.next/server'), { recursive: true });
    await writeFile(join(root, '.next/server/a.js'), 'ok');
    const meta = { projectDir: root, distDir: '.next' };
    await config.compiler!.runAfterProductionCompile!(meta);
    expect(userHook).toHaveBeenCalledWith(meta);
    await writeFile(join(root, '.next/server/a.js'), 'File changed since it was read');
    await expect(config.compiler!.runAfterProductionCompile!(meta)).rejects.toThrow(/a\.js/);
  });

  it('broken schema: dev resolves with console.error, build rejects', async () => {
    await writeFile(join(root, 'cms/schema.json'), '{ nope');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(withEditlet({}, { root, packageDir })(DEV, ctx)).resolves.toBeTruthy();
    expect(error).toHaveBeenCalled();
    expect(await exists(join(root, 'public/editlet/index.html'))).toBe(true);
    delete process.env.EDITLET_NEXT_PREPARED;
    delete (globalThis as Record<string, unknown>).__editletPrepare;
    await expect(withEditlet({}, { root, packageDir })(BUILD, ctx)).rejects.toThrow();
  });

  it('build: writes config.json from the admin option and the schema base branch', async () => {
    await withEditlet({}, { root, packageDir, admin: { repo: 'acme/site', authUrl: '/api/editlet/oauth' } })(
      BUILD,
      ctx,
    );
    expect(JSON.parse(await readFile(join(root, 'public/editlet/config.json'), 'utf8'))).toEqual({
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
      authUrl: '/api/editlet/oauth',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('build: warns when no GitHub repo is known', async () => {
    await withEditlet({}, { root, packageDir })(BUILD, ctx);
    expect(JSON.parse(await readFile(join(root, 'public/editlet/config.json'), 'utf8'))).toEqual({});
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^\[editlet\] admin: no GitHub repo/));
  });

  it('invalid admin option: build rejects, dev reports and writes an empty config', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(withEditlet({}, { root, packageDir, admin: { repo: 'nope' } })(BUILD, ctx)).rejects.toThrow(
      /admin\.repo/,
    );
    delete process.env.EDITLET_NEXT_PREPARED;
    delete (globalThis as Record<string, unknown>).__editletPrepare;
    await withEditlet({}, { root, packageDir, admin: { repo: 'nope' } })(DEV, ctx);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('admin.repo'));
    expect(JSON.parse(await readFile(join(root, 'public/editlet/config.json'), 'utf8'))).toEqual({});
  });

  it('injects EDITLET_PREVIEW when admin.preview, keeping user env and no secrets', async () => {
    vi.stubEnv('CMS_PREVIEW_SECRET', 'x'.repeat(40));
    const admin = { repo: 'acme/site', preview: true, sessionMinutes: 30 };
    const config = await withEditlet({ env: { A: '1' } }, { root, packageDir, admin })(BUILD, ctx);
    expect(config.env?.A).toBe('1');
    expect(JSON.parse(config.env!.EDITLET_PREVIEW!)).toEqual({
      owner: 'acme',
      repo: 'site',
      schemaPath: 'cms/schema.json',
      sessionMinutes: 30,
    });
    expect(JSON.stringify(config.env)).not.toContain('xxxx');
    expect(JSON.parse(await readFile(join(root, 'public/editlet/config.json'), 'utf8')).preview).toBe(true);
  });

  it('defaults the preview sessionMinutes and also injects in the production server phase', async () => {
    const admin = { repo: 'acme/site', preview: true };
    const config = await withEditlet({}, { root, packageDir, admin })('phase-production-server', ctx);
    expect(JSON.parse(config.env!.EDITLET_PREVIEW!).sessionMinutes).toBe(60);
  });

  it('injects EDITLET_PARAM for <EditletLoader />: admin.param, else the env var, else editlet', async () => {
    expect((await withEditlet({}, { root, packageDir })(BUILD, ctx)).env?.EDITLET_PARAM).toBe('editlet');
    vi.stubEnv('EDITLET_PARAM', 'cms');
    expect((await withEditlet({}, { root, packageDir })('phase-production-server', ctx)).env?.EDITLET_PARAM).toBe(
      'cms',
    );
    const config = await withEditlet({ env: { A: '1' } }, { root, packageDir, admin: { param: 'edit' } })(BUILD, ctx);
    expect(config.env).toEqual({ A: '1', EDITLET_PARAM: 'edit' });
  });

  it('does not inject EDITLET_PREVIEW without admin.preview', async () => {
    const config = await withEditlet({}, { root, packageDir, admin: { repo: 'acme/site' } })(BUILD, ctx);
    expect(config.env?.EDITLET_PREVIEW).toBeUndefined();
  });

  it('preview without a repo: build rejects, dev warns', async () => {
    await expect(withEditlet({}, { root, packageDir, admin: { preview: true } })(BUILD, ctx)).rejects.toThrow(
      /admin\.preview/,
    );
    delete process.env.EDITLET_NEXT_PREPARED;
    delete (globalThis as Record<string, unknown>).__editletPrepare;
    const config = await withEditlet({}, { root, packageDir, admin: { preview: true } })(DEV, ctx);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/admin\.preview/));
    expect(config.env?.EDITLET_PREVIEW).toBeUndefined();
    expect(JSON.parse(await readFile(join(root, 'public/editlet/config.json'), 'utf8'))).not.toHaveProperty('preview');
  });

  it('production server without a repo: warns once across evaluations, no env', async () => {
    const wrap = withEditlet({}, { root, packageDir, admin: { preview: true } });
    expect((await wrap('phase-production-server', ctx)).env?.EDITLET_PREVIEW).toBeUndefined();
    await wrap('phase-production-server', ctx);
    expect(warn.mock.calls.filter(([m]: unknown[]) => /admin\.preview/.test(String(m)))).toHaveLength(1);
  });

  it('reads the schema once per process for prepare and the env injection', async () => {
    const admin = { repo: 'acme/site', preview: true };
    const wrap = withEditlet({}, { root, packageDir, admin });
    await wrap(BUILD, ctx);
    const first = (globalThis as unknown as Record<string, Map<string, unknown>>).__editletAdminConfig.size;
    await wrap(BUILD, ctx);
    expect((globalThis as unknown as Record<string, Map<string, unknown>>).__editletAdminConfig.size).toBe(first);
    expect(first).toBe(1);
  });

  it('skips side effects when already prepared', async () => {
    process.env.EDITLET_NEXT_PREPARED = '1';
    await withEditlet({}, { root, packageDir })(BUILD, ctx);
    expect(await exists(join(root, 'public/editlet'))).toBe(false);
    expect(await exists(join(root, '.editlet'))).toBe(false);
  });

  it('other phases: no side effects, no compiler hook, base config only', async () => {
    const config = await withEditlet({}, { root, packageDir })('phase-production-server', ctx);
    expect(await exists(join(root, 'public/editlet'))).toBe(false);
    expect(await exists(join(root, '.editlet'))).toBe(false);
    expect(config.compiler).toBeUndefined();
    expect(config.rewrites).toBeUndefined();
    expect(config.transpilePackages).toContain('editlet');
  });

  it('dev with preset prepared env still returns the rewrite; undefined user rewrites ok', async () => {
    process.env.EDITLET_NEXT_PREPARED = '1';
    const config = await withEditlet({ rewrites: async () => undefined as never }, { root, packageDir })(DEV, ctx);
    const rewrites = (await config.rewrites!()) as { beforeFiles: unknown[] };
    expect(rewrites.beforeFiles).toHaveLength(1);
  });

  it('clears the cached bridge when it fails to start', async () => {
    startDevApi.mockRejectedValueOnce(new Error('boom'));
    await expect(withEditlet({}, { root, packageDir })(DEV, ctx)).rejects.toThrow('boom');
    expect((globalThis as Record<string, unknown>).__editletDevApi).toBeUndefined();
  });

  it('throws naming the package when it cannot be resolved', async () => {
    await expect(withEditlet({}, { root })(BUILD, ctx)).rejects.toThrow(/the editlet package/);
  });

  it('concurrent evaluations prepare once', async () => {
    const wrap = withEditlet({}, { root, packageDir });
    await Promise.all([wrap(BUILD, ctx), wrap(BUILD, ctx)]);
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
