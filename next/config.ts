import { watch, type FSWatcher } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';

import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from 'next/constants.js';

import { findDevHandlerCode } from './buildGuard';
import { startDevApi } from './devServer';
import { shouldResyncContent, syncAdminOnly, syncContent, syncPublicDir } from './publicDir';

import {
  buildAdminConfig,
  DEFAULT_SESSION_MINUTES,
  resolveParam,
  type AdminConfig,
  type AdminConfigOptions,
} from '../admin/config';
import { DEV_API_BASE } from '../core/devApi';
import { DEFAULT_SCHEMA_PATH, loadProjectSchema } from '../node/fs';
import { writeTypes } from '../node/project';

export interface WithEditletOptions {
  root?: string;
  schemaPath?: string;
  typesFile?: string;
  /** Public admin config (`config.json`). Everything here ends up public. */
  admin?: AdminConfigOptions;
  /** Internal: the package directory, when it cannot be resolved from `root` (tests). */
  packageDir?: string;
}

type ConfigInput =
  | NextConfig
  | ((phase: string, ctx: { defaultConfig: NextConfig }) => NextConfig | Promise<NextConfig>);
type Rewrites = Awaited<ReturnType<NonNullable<NextConfig['rewrites']>>>;
type DevApi = { port: number; close(): Promise<void> };

const PREPARED_ENV = 'EDITLET_NEXT_PREPARED';
const DEV_API_KEY = '__editletDevApi';
const PREPARE_KEY = '__editletPrepare';

/* eslint-disable no-console -- the dev adapter reports schema problems on stderr */
function report(error: unknown): void {
  const issues = (error as { issues?: { file?: string; path?: string; message: string }[] }).issues;
  if (Array.isArray(issues)) {
    for (const i of issues) console.error(`[editlet] ${[i.file, i.path].filter(Boolean).join(' ')}: ${i.message}`);
  } else {
    console.error(`[editlet] ${error instanceof Error ? error.message : String(error)}`);
  }
}

function warn(message: string): void {
  // eslint-disable-next-line no-console -- the adapter reports build configuration problems on stderr
  console.warn(`[editlet] ${message}`);
}

/* eslint-enable no-console */

async function resolveAdminConfigUncached(
  root: string,
  schemaPath: string,
  admin: AdminConfigOptions | undefined,
  dev: boolean,
): Promise<AdminConfig> {
  let baseBranch: string | null = null;
  try {
    baseBranch = (await loadProjectSchema(root, schemaPath)).git.baseBranch;
  } catch (error) {
    if (!dev) throw error;
  }
  try {
    const config = buildAdminConfig(admin, { baseBranch, env: process.env });
    if (config.preview && !config.github) {
      const message =
        'admin.preview needs a GitHub repo: set the admin.repo option (or deploy on Vercel) and a git.baseBranch in the schema.';
      if (!dev) throw new TypeError(message);
      warn(message);
      delete config.preview;
    }
    if (!dev && !config.github) {
      warn(
        'admin: no GitHub repo configured (set the admin.repo option or deploy on Vercel); the production admin cannot open a repo.',
      );
    }
    return config;
  } catch (error) {
    if (!dev) throw error;
    report(error);
    return {};
  }
}

const ADMIN_CONFIG_KEY = '__editletAdminConfig';
const warnedOnce = new Set<string>();

/**
 * One resolution per process, root, schema path and mode: `prepare` and the preview env injection share it, so the
 * schema is read once and problems are reported once. A failure is cached too (a failed build stops anyway).
 */
function resolveAdminConfig(
  root: string,
  schemaPath: string,
  admin: AdminConfigOptions | undefined,
  dev: boolean,
): Promise<AdminConfig> {
  const g = globalThis as unknown as Record<string, Map<string, Promise<AdminConfig>> | undefined>;
  const all = (g[ADMIN_CONFIG_KEY] ??= new Map());
  const key = `${root}\0${schemaPath}\0${dev ? 'dev' : 'prod'}`;
  let found = all.get(key);
  if (!found) {
    found = resolveAdminConfigUncached(root, schemaPath, admin, dev);
    all.set(key, found);
  }
  return found;
}

/** The non-secret runtime config for the preview route, as the `EDITLET_PREVIEW` env value, or `null`. */
async function previewEnvFor(
  root: string,
  schemaPath: string,
  admin: AdminConfigOptions | undefined,
  dev: boolean,
  build: boolean,
): Promise<string | null> {
  if (!admin?.preview) return null;
  let config: AdminConfig;
  try {
    config = await resolveAdminConfig(root, schemaPath, admin, dev);
  } catch (error) {
    // dev reports inside the resolver; the build must fail; any other phase (`next start`) reports once and goes on
    if (build) throw error;
    const key = `${root}\0${schemaPath}`;
    if (!dev && !warnedOnce.has(key)) {
      warnedOnce.add(key);
      warn(`admin.preview is off: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
  if (!config.preview || !config.github) return null;
  return JSON.stringify({
    owner: config.github.owner,
    repo: config.github.repo,
    schemaPath,
    sessionMinutes: config.sessionMinutes ?? DEFAULT_SESSION_MINUTES,
  });
}

function createSyncer(run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let pending: Promise<void> | null = null;
  const start = () => {
    const p = run().finally(() => {
      if (running === p) running = null;
    });
    running = p;
    return p;
  };
  return () => {
    if (!running) return start();
    pending ??= running
      .catch(() => undefined)
      .then(() => {
        pending = null;
        return start();
      });
    return pending;
  };
}

function resolvePackageDir(root: string): string {
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('editlet/next/config');
    return dirname(dirname(entry));
  } catch (error) {
    throw new Error(
      `Cannot locate the editlet package from ${root}: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

function startWatchers(
  root: string,
  schemaPath: string,
  typesFile: string | undefined,
  sync: () => Promise<void>,
): void {
  const watchers = new Set<FSWatcher>();
  let contentWatcher: { dir: string; watcher: FSWatcher } | null = null;
  let contentTimer: ReturnType<typeof setTimeout> | undefined;
  let schemaTimer: ReturnType<typeof setTimeout> | undefined;
  const resync = () => {
    clearTimeout(contentTimer);
    contentTimer = setTimeout(() => void sync().catch(report), 100);
  };
  const ensureContentWatcher = async () => {
    const schema = await loadProjectSchema(root, schemaPath);
    const dir = join(root, schema.contentDir);
    if (contentWatcher?.dir === dir) return;
    contentWatcher?.watcher.close();
    watchers.delete(contentWatcher?.watcher as FSWatcher);
    contentWatcher = null;
    const watcher = watch(dir, { recursive: true }, (_event, filename) => {
      if (shouldResyncContent(filename ? filename.toString() : null)) resync();
    }).unref();
    watchers.add(watcher);
    contentWatcher = { dir, watcher };
  };
  void ensureContentWatcher().catch(() => undefined);
  const schemaFile = join(root, schemaPath);
  try {
    watchers.add(
      watch(dirname(schemaFile), (_event, filename) => {
        if (filename && filename.toString() !== basename(schemaFile)) return;
        clearTimeout(schemaTimer);
        schemaTimer = setTimeout(() => {
          void (async () => {
            await writeTypes(root, typesFile, schemaPath);
            await sync();
            await ensureContentWatcher();
          })().catch(report);
        }, 100);
      }).unref(),
    );
  } catch {
    // schema directory missing: nothing to watch
  }
}

type Prepared = { done: Promise<void>; contentSync: () => Promise<void> };

async function runPrepare(
  root: string,
  schemaPath: string,
  typesFile: string | undefined,
  dev: boolean,
  pkgDir: string,
  contentSync: () => Promise<void>,
  admin: AdminConfigOptions | undefined,
) {
  const config = await resolveAdminConfig(root, schemaPath, admin, dev);
  try {
    await writeTypes(root, typesFile, schemaPath);
    await syncPublicDir(root, schemaPath, pkgDir, config);
  } catch (error) {
    if (!dev) throw error;
    report(error);
    try {
      await syncAdminOnly(root, pkgDir, config);
    } catch (inner) {
      report(inner);
    }
  }
  process.env[PREPARED_ENV] = '1';
  if (dev) startWatchers(root, schemaPath, typesFile, contentSync);
}

/** One prepare per process (and per project): concurrent config evaluations share it. */
function prepare(
  root: string,
  schemaPath: string,
  typesFile: string | undefined,
  dev: boolean,
  pkgDir: string,
  admin: AdminConfigOptions | undefined,
): Promise<void> {
  if (process.env[PREPARED_ENV] === '1') return Promise.resolve();
  const g = globalThis as unknown as Record<string, Record<string, Prepared> | undefined>;
  const all = (g[PREPARE_KEY] ??= {});
  const key = `${root}\0${schemaPath}`;
  if (!all[key]) {
    const contentSync = createSyncer(() => syncContent(root, schemaPath));
    const done = runPrepare(root, schemaPath, typesFile, dev, pkgDir, contentSync, admin).catch((error: unknown) => {
      delete all[key];
      throw error;
    });
    all[key] = { done, contentSync };
  }
  return all[key].done;
}

function ensureDevApi(root: string, schemaPath: string): Promise<DevApi> {
  const g = globalThis as unknown as Record<string, Promise<DevApi> | undefined>;
  g[DEV_API_KEY] ??= startDevApi({ root, schemaPath }).catch((error: unknown) => {
    delete g[DEV_API_KEY];
    throw error;
  });
  return g[DEV_API_KEY];
}

function mergeRewrites(user: Rewrites | undefined, rewrite: { source: string; destination: string }): Rewrites {
  if (user === undefined) return { beforeFiles: [rewrite] };
  if (Array.isArray(user)) return { beforeFiles: [rewrite], afterFiles: user };
  return { ...user, beforeFiles: [rewrite, ...(user.beforeFiles ?? [])] };
}

export function withEditlet(
  nextConfig: ConfigInput = {},
  options: WithEditletOptions = {},
): (phase: string, ctx: { defaultConfig: NextConfig }) => Promise<NextConfig> {
  const root = options.root ?? process.cwd();
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  return async (phase, ctx) => {
    const user = typeof nextConfig === 'function' ? await nextConfig(phase, ctx) : nextConfig;
    const dev = phase === PHASE_DEVELOPMENT_SERVER;
    const build = phase === PHASE_PRODUCTION_BUILD;
    if (dev || build) {
      const pkgDir = options.packageDir ?? resolvePackageDir(root);
      await prepare(root, schemaPath, options.typesFile, dev, pkgDir, options.admin);
    }
    const previewEnv = await previewEnvFor(root, schemaPath, options.admin, dev, build);
    const api = dev ? await ensureDevApi(root, schemaPath) : null;
    // Inlined into client code: <EditletLoader /> reads `process.env.EDITLET_PARAM`.
    const env = { ...user.env, EDITLET_PARAM: resolveParam(options.admin, process.env) };

    return {
      ...user,
      env: previewEnv ? { ...env, EDITLET_PREVIEW: previewEnv } : env,
      transpilePackages: [...new Set([...(user.transpilePackages ?? []), 'editlet'])],
      ...(api
        ? {
            async rewrites() {
              const existing = await user.rewrites?.();
              return mergeRewrites(existing, {
                source: `${DEV_API_BASE}/:path*`,
                destination: `http://127.0.0.1:${api.port}${DEV_API_BASE}/:path*`,
              });
            },
          }
        : build
          ? {
              compiler: {
                ...user.compiler,
                async runAfterProductionCompile(metadata: { projectDir: string; distDir: string }) {
                  await user.compiler?.runAfterProductionCompile?.(metadata);
                  const found = await findDevHandlerCode(resolve(metadata.projectDir, metadata.distDir));
                  if (found) {
                    throw new Error(`Editlet dev handler code leaked into the production build: ${found}`);
                  }
                },
              },
            }
          : {}),
    };
  };
}
