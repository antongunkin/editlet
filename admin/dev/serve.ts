// Shared by the dev hosts: the built admin at `/editlet/`, the demo site page with the loader, small HTTP helpers.
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import type { Entry } from '../../core/validate';
import { DEFAULT_ADMIN_URL } from '../../loader/protocol';

const DEV_DIR = fileURLToPath(new URL('.', import.meta.url));
const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url));

export const ADMIN_PREFIX: string = DEFAULT_ADMIN_URL;

export const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function entryTitle(entry: Entry): string {
  for (const key of ['title', 'name']) {
    const value = entry.data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return entry.slug;
}

function renderEntry(entry: Entry): string {
  const ref = `${entry.collection}/${entry.slug}`;
  const draft = entry.data.draft === true ? ' · draft' : '';
  return [
    `<article data-editlet-entry="${escapeHtml(ref)}">`,
    `<h2>${escapeHtml(entryTitle(entry))}</h2>`,
    `<p class="meta">${escapeHtml(ref)}${draft}</p>`,
    `</article>`,
  ].join('');
}

export function send(
  res: ServerResponse,
  status: number,
  body: string | Uint8Array,
  type = 'text/plain; charset=utf-8',
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Serves `admin/dist` under `ADMIN_PREFIX`; `transformIndex` rewrites the text of each served `index.html`. */
export async function serveAdmin(
  pathname: string,
  res: ServerResponse,
  transformIndex?: (html: string) => string,
): Promise<void> {
  if (!(await isFile(join(DIST_DIR, 'index.html')))) {
    send(res, 503, 'Run npm run admin:build first');
    return;
  }
  let relative: string;
  try {
    relative = decodeURIComponent(pathname.slice(ADMIN_PREFIX.length));
  } catch {
    send(res, 400, 'Bad path');
    return;
  }
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  const file = resolve(DIST_DIR, relative);
  if (file !== DIST_DIR && !file.startsWith(DIST_DIR.endsWith(sep) ? DIST_DIR : DIST_DIR + sep)) {
    send(res, 404, 'Not found');
    return;
  }
  const target = (await isFile(file))
    ? file
    : (await isFile(join(file, 'index.html')))
      ? join(file, 'index.html')
      : null;
  const type = target ? CONTENT_TYPES[extname(target)] : undefined;
  if (!target || !type) {
    send(res, 404, 'Not found');
    return;
  }
  if (transformIndex && target.endsWith(`${sep}index.html`)) {
    send(res, 200, transformIndex(await readFile(target, 'utf8')), type);
    return;
  }
  send(res, 200, await readFile(target), type);
}

export type DemoSite = { siteJs: Uint8Array; page: (entries: Entry[]) => string };

let demoSite: Promise<DemoSite> | undefined;

/**
 * The demo site: `page(entries)` renders `entries` as `data-editlet-entry` cards; `siteJs` is the bundled loader. Built
 * once per process, so the Playwright suite can start a host per test.
 */
export function buildDemoSite(): Promise<DemoSite> {
  demoSite ??= (async () => {
    const bundle = await build({
      entryPoints: [join(DEV_DIR, 'site.ts')],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    });
    const template = await readFile(join(DEV_DIR, 'site.html'), 'utf8');
    return {
      siteJs: bundle.outputFiles[0].contents,
      page: (entries: Entry[]) => template.replace('<!--entries-->', entries.map(renderEntry).join('\n')),
    };
  })();
  return demoSite;
}

/** Listens on `port` (`0`: a free one) and resolves with the origin and a `close` that ends open connections too. */
export function listen(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  port: number,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    handler(req, res).catch((error: unknown) => {
      if (res.headersSent) res.end();
      else send(res, 500, error instanceof Error ? error.message : String(error));
    });
  });
  return new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(port, 'localhost', () => {
      const address = server.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      done({
        origin: `http://localhost:${actual}`,
        close: () =>
          new Promise<void>((closed) => {
            server.closeAllConnections();
            server.close(() => closed());
          }),
      });
    });
  });
}
