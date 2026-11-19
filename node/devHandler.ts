import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { DEFAULT_SCHEMA_PATH, listFiles, loadProjectSchema } from './fs';
import { parsePorcelainZ, porcelainEntries } from './gitStatus';

import {
  DEV_API_BASE,
  type DevErrorResponse,
  type DevFilesResponse,
  type DevGitResponse,
  type DevVersionsResponse,
} from '../core/devApi';
import { decodeUtf8 } from '../core/entryFile';
import { EditletError, type Issue } from '../core/issues';
import { isHiddenContentPath } from '../core/paths';
import { parseSchemaText, type Schema } from '../core/schema';
import { gitBlobSha } from '../core/sha';
import {
  MAX_FILE_VERSIONS,
  versionLimit,
  type FileChange,
  type FileEvent,
  type FileHistory,
  type FileVersion,
} from '../core/source';
import { isWritablePath, validateChanges, validateCommit, type ChangeContext } from '../core/writes';
import { fromBase64 } from '../github/base64';

const FILES_ROUTE = `${DEV_API_BASE}/files`;
const FILE_ROUTE = `${DEV_API_BASE}/file`;
const COMMIT_ROUTE = `${DEV_API_BASE}/commit`;
const HISTORY_ROUTE = `${DEV_API_BASE}/history`;
const GIT_ROUTE = `${DEV_API_BASE}/git`;
const VERSIONS_ROUTE = `${DEV_API_BASE}/versions`;
const VERSION_ROUTE = `${DEV_API_BASE}/version`;

/** A full commit id (SHA-1 or SHA-256): never a ref name, an abbreviation or an option. */
const COMMIT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
/** A control character: a newline in a path would shift the `cat-file --batch-check` lines. */
// oxlint-disable-next-line no-control-regex -- the control characters are what it finds
const CONTROL = /[\u0000-\u001f\u007f]/;

const execFileAsync = promisify(execFile);

const commitBody = z.strictObject({
  message: z.string(),
  changes: z.array(
    z.strictObject({
      path: z.string(),
      content: z.string().nullable(),
      encoding: z.enum(['utf8', 'base64']).optional(),
      sha: z.string().nullable().optional(),
    }),
  ),
});

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const CONTENT_TYPES: Record<string, string> = {
  md: 'text/markdown; charset=utf-8',
  json: 'application/json',
  webp: 'image/webp',
  png: 'image/png',
  gif: 'image/gif',
  avif: 'image/avif',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

/** Served files must never run as documents on the app origin (an SVG can carry script). */
const FILE_HEADERS = {
  'Content-Security-Policy': "sandbox; default-src 'none'",
  'X-Content-Type-Options': 'nosniff',
};

function contentType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function json(
  status: number,
  body: DevFilesResponse | DevGitResponse | FileHistory | DevVersionsResponse | DevErrorResponse,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function fail(status: number, message: string, headers?: Record<string, string>): Response {
  return json(status, { issues: [{ path: '', message }] }, headers);
}

/** Issue when a file's current sha (`null` = missing) is not the expected one (`null` = must not exist). */
function shaIssue(file: string, expected: string | null, actual: string | null): Issue | null {
  if (expected === actual) return null;
  const message =
    actual === null ? 'File not found' : expected === null ? 'File already exists' : 'File changed since it was read';
  return { file, path: '', message };
}

/** `If-Match` value without surrounding quotes; `undefined` when the header is absent. */
function ifMatch(req: Request): string | undefined {
  return req.headers
    .get('if-match')
    ?.trim()
    .replace(/^"(.*)"$/, '$1');
}

/** UTF-8 text of a file, or `undefined` when it cannot be read or is not valid UTF-8. */
function readText(target: string): string | undefined {
  try {
    const decoded = decodeUtf8(new Uint8Array(readFileSync(target)), target);
    return 'text' in decoded ? decoded.text : undefined;
  } catch {
    return undefined;
  }
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code ?? '';

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Realpath of the deepest existing ancestor of `path`, with the missing tail appended. */
async function realpathDeepest(path: string): Promise<string> {
  const tail: string[] = [];
  let current = path;
  for (;;) {
    try {
      return join(await realpath(current), ...tail.toReversed());
    } catch (error) {
      const parent = dirname(current);
      if (!['ENOENT', 'ENOTDIR'].includes(errorCode(error)) || parent === current) throw error;
      tail.push(basename(current));
      current = parent;
    }
  }
}

async function isInside(target: string, base: string): Promise<boolean> {
  const [realTarget, realBase] = await Promise.all([realpathDeepest(target), realpathDeepest(base)]);
  return realTarget.startsWith(realBase + sep);
}

/** Whether `target` exists as a regular file; throws a 400 for directories and paths through a file. */
async function fileExists(target: string): Promise<boolean> {
  try {
    if ((await stat(target)).isDirectory()) throw new HttpError(400, 'Path is a directory');
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Stages every write to a temp file next to its target, then renames them all into place, then runs the deletes.
 * If staging fails the temp files are removed and nothing is applied.
 */
async function applyChanges(root: string, changes: FileChange[]): Promise<void> {
  const staged: { temp: string; target: string }[] = [];
  try {
    for (const { path, content } of changes) {
      if (content === null) continue;
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      const temp = join(dirname(target), `.${basename(target)}.${crypto.randomUUID()}.tmp`);
      staged.push({ temp, target });
      await writeFile(temp, content);
    }
  } catch (error) {
    await Promise.all(staged.map(({ temp }) => rm(temp, { force: true })));
    throw error;
  }
  for (const { temp, target } of staged) await rename(temp, target);
  for (const { path, content } of changes) {
    if (content !== null) continue;
    await rm(join(root, path), { force: true });
    await pruneEmptyDirs(root, dirname(path));
  }
}

/**
 * Removes `dir` (relative to `root`) and its parents while they are empty, like Git, which keeps no empty folders: a
 * moved or deleted image folder does not linger. Stops at the first folder that still has files, or at `root`.
 */
async function pruneEmptyDirs(root: string, dir: string): Promise<void> {
  for (let d = dir; d !== '.' && d !== '' && d !== '/'; d = dirname(d)) {
    try {
      await rmdir(join(root, d));
    } catch {
      return;
    }
  }
}

async function currentSha(target: string, exists: boolean): Promise<string | null> {
  return exists ? gitBlobSha(await readFile(target)) : null;
}

function isAllowedHost(hostname: string, extra: readonly string[]): boolean {
  return LOCAL_HOSTS.includes(hostname) || hostname.endsWith('.localhost') || extra.includes(hostname);
}

export function createDevHandler(opts: {
  root: string;
  schemaPath?: string;
  /** Extra hostnames (exact match) besides localhost, 127.0.0.1, [::1] and *.localhost. */
  allowedHosts?: string[];
}): (req: Request) => Promise<Response> {
  const { root } = opts;
  const schemaPath = opts.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const allowedHosts = opts.allowedHosts ?? [];

  async function currentSchema(): Promise<{ schema: Schema | null; issues: Issue[] }> {
    try {
      return { schema: await loadProjectSchema(root, schemaPath), issues: [] };
    } catch (error) {
      if (error instanceof EditletError) return { schema: null, issues: error.issues };
      throw error;
    }
  }

  async function listFilesRoute(schema: Schema): Promise<Response> {
    const content = (await listFiles(root, schema.contentDir)).filter((p) => !isHiddenContentPath(schema, p));
    const paths = [...new Set([...content, schemaPath])].toSorted();
    const files = await Promise.all(
      paths.map(async (path) => ({ path, sha: await gitBlobSha(await readFile(join(root, path))) })),
    );
    return json(200, { files });
  }

  /** Repo state for `validateChanges`: the files under contentDir plus the schema file. */
  async function changeContext(schema: Schema | null): Promise<ChangeContext> {
    const existing = new Set(schema === null ? [] : await listFiles(root, schema.contentDir)).add(schemaPath);
    return {
      schema,
      schemaPath,
      exists: (p) => existing.has(p),
      list: () => existing,
      read: (p) => readText(join(root, p)),
    };
  }

  /** The schema a batch writes to the schema file, when it parses; `null` otherwise. */
  function batchSchema(changes: FileChange[]): Schema | null {
    const content = changes.find((c) => c.path === schemaPath)?.content;
    const decoded = content === undefined || content === null ? null : decodeUtf8(content, schemaPath);
    if (decoded === null || 'issue' in decoded) return null;
    try {
      return parseSchemaText(decoded.text, schemaPath);
    } catch {
      return null;
    }
  }

  /** Directory a writable path must resolve inside (after symlinks): the schema's folder or contentDir. */
  function baseOf(path: string, schema: Schema | null): string {
    return path === schemaPath || schema === null ? dirname(join(root, schemaPath)) : join(root, schema.contentDir);
  }

  /** `schema` is null only when the schema on disk is broken; then `path` is the schema file. */
  async function fileRoute(req: Request, path: string, schema: Schema | null): Promise<Response> {
    const target = join(root, path);
    if (!(await isInside(target, baseOf(path, schema)))) {
      return fail(400, 'Path resolves outside the content directory');
    }
    const exists = await fileExists(target);

    if (req.method === 'GET') {
      if (!exists) return fail(404, 'File not found');
      const bytes = new Uint8Array(await readFile(target));
      return new Response(bytes, { status: 200, headers: { 'Content-Type': contentType(path), ...FILE_HEADERS } });
    }

    if (req.method === 'DELETE' && path === schemaPath) return fail(400, 'The schema file cannot be deleted');
    const expected = ifMatch(req);
    const conflict = expected === undefined ? null : shaIssue(path, expected, await currentSha(target, exists));
    if (conflict) return json(412, { issues: [conflict] });
    if (req.method === 'DELETE' && !exists) return fail(404, 'File not found');

    const change: FileChange = { path, content: req.method === 'PUT' ? new Uint8Array(await req.arrayBuffer()) : null };
    const issues = validateChanges(await changeContext(schema), [change]);
    if (issues.length > 0) return json(422, { issues });
    await applyChanges(root, [change]);
    return new Response(null, { status: 204 });
  }

  async function commitRoute(req: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return fail(400, 'Body must be JSON');
    }
    const body = commitBody.safeParse(raw);
    if (!body.success) {
      return json(400, { issues: body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const { message, changes: requested } = body.data;

    const { schema, issues: schemaIssues } = await currentSchema();
    if (schema === null && requested.some((c) => c.path !== schemaPath)) return json(500, { issues: schemaIssues });

    const changes: FileChange[] = [];
    for (const { path, content, encoding } of requested) {
      if (content === null || encoding !== 'base64') {
        changes.push({ path, content });
        continue;
      }
      try {
        changes.push({ path, content: fromBase64(content) });
      } catch {
        return json(400, { issues: [{ file: path, path: '', message: 'Content is not valid base64' }] });
      }
    }

    // A path is writable under the current schema or under a (parsable) schema change in the same batch.
    const schemas = [schema, batchSchema(changes)].filter((s) => s !== null);
    const owners = new Map<string, Schema | null>();
    const notWritable: Issue[] = [];
    for (const { path } of changes) {
      const owner = path === schemaPath ? null : schemas.find((s) => isWritablePath(s, schemaPath, path));
      if (owner === undefined) notWritable.push({ file: path, path: '', message: 'Path not writable' });
      else owners.set(path, owner);
    }
    if (notWritable.length > 0) return json(400, { issues: notWritable });

    const conflicts: Issue[] = [];
    for (const { path, sha } of requested) {
      const target = join(root, path);
      if (!(await isInside(target, baseOf(path, owners.get(path) ?? null)))) {
        return json(400, {
          issues: [{ file: path, path: '', message: 'Path resolves outside the content directory' }],
        });
      }
      const exists = await fileExists(target);
      const conflict = sha === undefined ? null : shaIssue(path, sha, await currentSha(target, exists));
      if (conflict) conflicts.push(conflict);
    }
    if (conflicts.length > 0) return json(409, { issues: conflicts });

    const issues = validateCommit(await changeContext(schema), changes, message);
    if (issues.length > 0) return json(422, { issues });
    await applyChanges(root, changes);
    return new Response(null, { status: 204 });
  }

  /** A stable id of this project for client storage keys: a hash of the resolved root, never the path itself. */
  let projectId: Promise<string> | undefined;
  function project(): Promise<string> {
    projectId ??= realpath(root)
      .catch(() => root)
      .then((resolved) => createHash('sha256').update(resolved).digest('hex'));
    return projectId;
  }

  /** The checkout's branch and the uncommitted files under `contentDir` (count and list); empty when git is not usable. */
  async function gitRoute(): Promise<Response> {
    let body: DevGitResponse = { branch: null, changes: 0, files: [], project: await project() };
    try {
      const { schema } = await currentSchema();
      const [branch, status, prefix] = await Promise.all([
        git(['branch', '--show-current']),
        git(['status', '--porcelain=v1', '-z', '-uall', '--', schema?.contentDir ?? '.']),
        git(['rev-parse', '--show-prefix']),
      ]);
      body = {
        ...body,
        branch: branch.trim() === '' ? null : branch.trim(),
        changes: porcelainEntries(status).length,
        files: parsePorcelainZ(status, prefix.replace(/\n$/, '')),
      };
    } catch {
      // not a git checkout, or no git binary
    }
    return json(200, body);
  }

  /** `git log` of one file: newest and oldest commit plus the count; empty when git is not usable. */
  async function historyRoute(path: string): Promise<Response> {
    let body: FileHistory = { updated: null, created: null, commits: 0 };
    try {
      const out = (
        await execFileAsync('git', ['-C', root, 'log', '--format=%an%x1f%aI%x1f%s', '--', path], { maxBuffer: 1 << 24 })
      ).stdout;
      const events = out
        .split('\n')
        .filter(Boolean)
        .map((line): FileEvent => {
          const [name = '', date = '', message = ''] = line.split('\x1f');
          return { actor: { name }, date, message };
        });
      body = { updated: events[0] ?? null, created: events.at(-1) ?? null, commits: events.length };
    } catch {
      // not a git checkout, or no git binary
    }
    return json(200, body);
  }

  /** Runs git in `root` (pathspecs literal: a `*` in a file name is not a glob). */
  function git(args: string[], input?: string): Promise<string> {
    const run = execFileAsync('git', ['-C', root, '--literal-pathspecs', ...args], { maxBuffer: 1 << 24 });
    if (input !== undefined) run.child.stdin?.end(input);
    return run.then((r) => r.stdout);
  }

  /** `git log` of one file, newest first, with the file's blob sha after each commit; `[]` when git is not usable. */
  async function versionsRoute(path: string, limit: number): Promise<Response> {
    let versions: FileVersion[] = [];
    try {
      const out = await git([
        'log',
        // A user's `log.follow` or `log.showSignature` would follow renames or print gpg lines among the commits.
        '--no-follow',
        '--no-show-signature',
        `--max-count=${limit}`,
        '--format=%H%x1f%an%x1f%aI%x1f%s',
        '--',
        path,
      ]);
      const commits = out
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [commit = '', name = '', date = '', message = ''] = line.split('\x1f');
          return { commit, actor: { name }, date, message };
        });
      if (commits.length > 0) {
        // `git log` paths are relative to `root`; `<commit>:<path>` is relative to the top of the repository.
        const prefix = (await git(['rev-parse', '--show-prefix'])).trim();
        const objects = (
          await git(['cat-file', '--batch-check'], commits.map((c) => `${c.commit}:${prefix}${path}\n`).join(''))
        )
          .split('\n')
          .filter(Boolean);
        versions = commits.map((c, i) => {
          const [sha = '', type] = (objects[i] ?? '').split(' ');
          return { ...c, sha: type === 'blob' ? sha : null };
        });
      }
    } catch {
      // not a git checkout, or no git binary
    }
    return json(200, { versions });
  }

  /** The file as `commit` left it; 404 when it is not a file in that commit (or git is not usable). */
  async function versionRoute(path: string, commit: string): Promise<Response> {
    try {
      const prefix = (await git(['rev-parse', '--show-prefix'])).trim();
      const { stdout } = await execFileAsync('git', ['-C', root, 'cat-file', 'blob', `${commit}:${prefix}${path}`], {
        encoding: 'buffer',
        maxBuffer: 1 << 26,
      });
      return new Response(new Uint8Array(stdout), {
        status: 200,
        headers: { 'Content-Type': contentType(path), ...FILE_HEADERS },
      });
    } catch {
      return fail(404, `Not found in ${commit}: ${path}`);
    }
  }

  /** The path of a /versions or /version request, or the error response. */
  async function versionPath(url: URL): Promise<string | Response> {
    const path = url.searchParams.get('path');
    if (path === null || path === '') return fail(400, 'Missing "path" query parameter');
    if (CONTROL.test(path)) return fail(400, 'Path not readable');
    if (path === schemaPath) return path;
    const { schema, issues } = await currentSchema();
    if (schema === null) return json(500, { issues });
    if (!isWritablePath(schema, schemaPath, path)) return fail(400, 'Path not readable');
    return path;
  }

  async function handle(req: Request): Promise<Response> {
    if (process.env.NODE_ENV === 'production') return fail(403, 'The Editlet dev API is disabled in production');
    const url = new URL(req.url);
    if (!isAllowedHost(url.hostname, allowedHosts)) return fail(403, `Host "${url.hostname}" is not allowed`);
    const origin = req.headers.get('origin');
    if (origin !== null && origin !== url.origin) return fail(403, 'Cross-origin requests are not allowed');

    if (url.pathname === FILES_ROUTE) {
      if (req.method !== 'GET') return fail(405, 'Method not allowed', { Allow: 'GET' });
      const { schema, issues } = await currentSchema();
      return schema === null ? json(500, { issues }) : listFilesRoute(schema);
    }

    if (url.pathname === FILE_ROUTE) {
      if (!['GET', 'PUT', 'DELETE'].includes(req.method)) {
        return fail(405, 'Method not allowed', { Allow: 'GET, PUT, DELETE' });
      }
      const path = url.searchParams.get('path');
      if (path === null || path === '') return fail(400, 'Missing "path" query parameter');
      const { schema, issues } = await currentSchema();
      if (path === schemaPath) return fileRoute(req, path, schema);
      if (schema === null) return json(500, { issues });
      if (!isWritablePath(schema, schemaPath, path)) return fail(400, 'Path not writable');
      return fileRoute(req, path, schema);
    }

    if (url.pathname === GIT_ROUTE) {
      if (req.method !== 'GET') return fail(405, 'Method not allowed', { Allow: 'GET' });
      return gitRoute();
    }

    if (url.pathname === HISTORY_ROUTE) {
      if (req.method !== 'GET') return fail(405, 'Method not allowed', { Allow: 'GET' });
      const path = url.searchParams.get('path');
      if (path === null || path === '') return fail(400, 'Missing "path" query parameter');
      if (path.startsWith('/') || path.split('/').includes('..')) return fail(400, 'Path not readable');
      return historyRoute(path);
    }

    if (url.pathname === VERSIONS_ROUTE || url.pathname === VERSION_ROUTE) {
      if (req.method !== 'GET') return fail(405, 'Method not allowed', { Allow: 'GET' });
      const path = await versionPath(url);
      if (typeof path !== 'string') return path;
      if (url.pathname === VERSIONS_ROUTE) {
        const raw = url.searchParams.get('limit');
        const limit = raw === null ? undefined : Number(raw);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > MAX_FILE_VERSIONS)) {
          return fail(400, `Bad "limit": an integer from 1 to ${MAX_FILE_VERSIONS}`);
        }
        return versionsRoute(path, versionLimit(limit));
      }
      const commit = url.searchParams.get('commit') ?? '';
      if (!COMMIT_ID.test(commit)) return fail(400, 'Bad "commit": a full commit id');
      return versionRoute(path, commit);
    }

    if (url.pathname === COMMIT_ROUTE) {
      if (req.method !== 'POST') return fail(405, 'Method not allowed', { Allow: 'POST' });
      return commitRoute(req);
    }

    return fail(404, 'Not found');
  }

  return async (req) => {
    try {
      return await handle(req);
    } catch (error) {
      if (error instanceof HttpError) return fail(error.status, error.message);
      if (['ENOTDIR', 'EISDIR'].includes(errorCode(error))) return fail(400, 'Path is not a file');
      return fail(500, error instanceof Error ? error.message : String(error));
    }
  };
}
