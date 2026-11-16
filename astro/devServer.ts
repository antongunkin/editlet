import { existsSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

import { sendWebResponse, toWebRequest } from './nodeBridge';

import { DEV_API_BASE } from '../core/devApi';
import { DEFAULT_ADMIN_URL } from '../loader/protocol';
import { createDevHandler } from '../node';

/** `DEFAULT_ADMIN_URL` without its trailing slash: `/editlet`. */

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

export type NextFunction = (error?: unknown) => void;
export type DevMiddleware = (req: IncomingMessage, res: ServerResponse, next: NextFunction) => void;

/** Folder served at `/editlet/`: the built admin (`admin/dist/`) when it has an `index.html`, else the stub page. */
export function adminDir(): string {
  const dist = join(import.meta.dirname, '../admin/dist');
  return existsSync(join(dist, 'index.html')) ? dist : join(import.meta.dirname, 'stub');
}

/**
 * Connect-style middleware for `astro dev`: `/__editlet[/*]` → the dev file API, `/editlet/*` → static
 * files of `adminDir`. Everything else goes to `next`.
 */
export function createDevMiddleware(opts: { root: string; schemaPath: string; adminDir: string }): DevMiddleware {
  let handler: ((req: Request) => Promise<Response>) | undefined;
  const api = () => (handler ??= createDevHandler({ root: opts.root, schemaPath: opts.schemaPath }));

  return (req, res, next) => {
    const url = req.url ?? '/';
    // Raw path, not `new URL().pathname`: the URL parser resolves `%2e%2e` segments before we could refuse them.
    const path = url.split('?')[0]!;

    if (path === DEV_API_BASE || path.startsWith(`${DEV_API_BASE}/`)) {
      devApi(api(), req, res).catch(next);
    } else if (path.startsWith(DEFAULT_ADMIN_URL)) {
      adminFile(opts.adminDir, path.slice(DEFAULT_ADMIN_URL.length), req, res).catch(next);
    } else {
      next();
    }
  };
}

async function devApi(
  handler: (req: Request) => Promise<Response>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) abort.abort();
  });
  await sendWebResponse(res, await handler(toWebRequest(req, abort.signal)));
}

function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('Not found');
}

/** Absolute path of `rel` (URL-encoded) inside `dir`, or `null` when it is malformed or escapes `dir`. */
async function resolveInside(dir: string, rel: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel === '' ? 'index.html' : rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const base = await realpath(dir);
  try {
    const file = await realpath(resolve(base, decoded));
    return file.startsWith(base + sep) ? file : null;
  } catch {
    return null;
  }
}

async function adminFile(dir: string, rel: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end();
    return;
  }
  const file = await resolveInside(dir, rel);
  if (file === null || !(await stat(file)).isFile()) return notFound(res);
  const body = await readFile(file);
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-cache');
  res.end(req.method === 'HEAD' ? undefined : body);
}
