import { EDITLET_PARAM } from '../loader/protocol';

/** File name of the admin config, next to the admin's `index.html`. */
export const ADMIN_CONFIG_FILE = 'config.json';

export interface AdminGitHubConfig {
  owner: string;
  repo: string;
  baseBranch: string;
}

/** Content of `config.json`. It is served publicly: never put secrets in it. */
export interface AdminConfig {
  github?: AdminGitHubConfig;
  authUrl?: string;
  /** Idle timeout of the admin session in minutes; missing → `DEFAULT_SESSION_MINUTES`. */
  sessionMinutes?: number;
  /** Live preview is enabled (the Next adapter serves the preview route). */
  preview?: boolean;
  /** Query parameter that opens the editor on the site's pages, when it is not `editlet`. */
  param?: string;
}

/** Admin session idle timeout when `config.json` sets none. */
export const DEFAULT_SESSION_MINUTES = 60;

/** Adapter option `admin`. Everything here ends up public. */
export interface AdminConfigOptions {
  /** `owner/name`. Default: Vercel's `VERCEL_GIT_REPO_OWNER`/`VERCEL_GIT_REPO_SLUG`, then `GITHUB_REPOSITORY`. */
  repo?: string;
  /** Public URL of the auth handler: https, `http` on localhost, or a path starting with `/`. */
  authUrl?: string;
  /**
   * Minutes without clicks or typing in the admin after which the admin signs out (integer 1–1440). Default: the env
   * var `CMS_SESSION_MINUTES`, else the admin's 60.
   */
  sessionMinutes?: number;
  /**
   * Turn on live preview of unsaved edits in the Next site. Needs a resolvable GitHub repo and the server env vars
   * `CMS_PREVIEW_SECRET` and `CMS_GITHUB_TOKEN`; see `docs/next/preview.md`. Default: off.
   */
  preview?: boolean;
  /**
   * Query parameter that opens the editor on the site's pages (`?<param>`, `?<param>=branch:<name>`): letters, digits,
   * `_` and `-`, starting with a letter. Default: the env var `EDITLET_PARAM`, else `editlet`.
   */
  param?: string;
}

const PARAM = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/**
 * The site's editor query parameter: `options.param` (throws `TypeError` when invalid), else a valid `EDITLET_PARAM`
 * env value, else `editlet`. The adapters pass it to the loader and write it to `config.json`.
 */
export function resolveParam(options: AdminConfigOptions | undefined, env: Record<string, string | undefined>): string {
  if (options?.param !== undefined) {
    if (!PARAM.test(options.param)) {
      throw new TypeError(
        `admin.param must start with a letter and hold only letters, digits, "_" and "-", got "${options.param}"`,
      );
    }
    return options.param;
  }
  const raw = env.EDITLET_PARAM?.trim();
  return raw && PARAM.test(raw) ? raw : EDITLET_PARAM;
}

const REPO = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/;

function isValidAuthUrl(value: string): boolean {
  if (value.startsWith('/')) return !value.startsWith('//');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

const MAX_SESSION_MINUTES = 1440;

function isValidSessionMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_SESSION_MINUTES;
}

/** `CMS_SESSION_MINUTES` when it is a valid whole number, else `undefined`. */
function envSessionMinutes(env: Record<string, string | undefined>): number | undefined {
  const raw = env.CMS_SESSION_MINUTES?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return isValidSessionMinutes(value) ? value : undefined;
}

function toGitHub(repo: string, baseBranch: string): AdminGitHubConfig | null {
  const match = REPO.exec(repo);
  return match ? { owner: match[1]!, repo: match[2]!, baseBranch } : null;
}

function envRepo(env: Record<string, string | undefined>): string | undefined {
  const { VERCEL_GIT_REPO_OWNER: owner, VERCEL_GIT_REPO_SLUG: slug, GITHUB_REPOSITORY: full } = env;
  const candidates = [owner && slug ? `${owner}/${slug}` : undefined, full];
  return candidates.find((c) => c !== undefined && REPO.test(c));
}

/** Throws `TypeError` for an invalid option. An invalid env value is ignored. */
export function buildAdminConfig(
  options: AdminConfigOptions | undefined,
  ctx: { baseBranch: string | null; env: Record<string, string | undefined> },
): AdminConfig {
  const config: AdminConfig = {};
  if (options?.repo !== undefined && !REPO.test(options.repo)) {
    throw new TypeError(`admin.repo must look like "owner/name", got "${options.repo}"`);
  }
  const repo = options?.repo ?? envRepo(ctx.env);
  if (repo && ctx.baseBranch) {
    const github = toGitHub(repo, ctx.baseBranch);
    if (github) config.github = github;
  }
  if (options?.authUrl !== undefined) {
    if (!isValidAuthUrl(options.authUrl)) {
      throw new TypeError('admin.authUrl must be an https URL, an http URL on localhost, or a path starting with "/"');
    }
    config.authUrl = options.authUrl;
  }
  if (options?.sessionMinutes !== undefined && !isValidSessionMinutes(options.sessionMinutes)) {
    throw new TypeError(
      `admin.sessionMinutes must be a whole number of minutes from 1 to ${MAX_SESSION_MINUTES}, got ${options.sessionMinutes}`,
    );
  }
  const sessionMinutes = options?.sessionMinutes ?? envSessionMinutes(ctx.env);
  if (sessionMinutes !== undefined) config.sessionMinutes = sessionMinutes;
  if (options?.preview !== undefined && typeof options.preview !== 'boolean') {
    throw new TypeError('admin.preview must be a boolean');
  }
  if (options?.preview) config.preview = true;
  const param = resolveParam(options, ctx.env);
  if (param !== EDITLET_PARAM) config.param = param;
  return config;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads a fetched `config.json`. `null` = not an object. Invalid and unknown members are dropped, never thrown. */
export function parseAdminConfig(value: unknown): AdminConfig | null {
  if (!isRecord(value)) return null;
  const config: AdminConfig = {};
  const { github, authUrl, sessionMinutes, preview, param } = value;
  if (isRecord(github) && typeof github.owner === 'string' && typeof github.repo === 'string') {
    const parsed = typeof github.baseBranch === 'string' && github.baseBranch ? github.baseBranch : null;
    const result = parsed ? toGitHub(`${github.owner}/${github.repo}`, parsed) : null;
    if (result) config.github = result;
  }
  if (typeof authUrl === 'string' && isValidAuthUrl(authUrl)) config.authUrl = authUrl;
  if (isValidSessionMinutes(sessionMinutes)) config.sessionMinutes = sessionMinutes;
  if (preview === true) config.preview = true;
  if (typeof param === 'string' && PARAM.test(param) && param !== EDITLET_PARAM) config.param = param;
  return config;
}
