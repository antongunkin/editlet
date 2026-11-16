// @vitest-environment node
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { adminDir, createDevMiddleware } from './devServer';
import { sendWebResponse, toWebRequest } from './nodeBridge';

const schema = {
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Posts',
      fields: {
        title: { label: 'Title', type: 'string', required: true },
        body: { label: 'Body', type: 'markdown' },
      },
    },
  },
};

let temp: string;
let root: string;
let admin: string;
let server: Server;
let port: number;

async function put(dir: string, file: string, text: string): Promise<void> {
  await mkdir(dirname(join(dir, file)), { recursive: true });
  await writeFile(join(dir, file), text);
}

beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), 'editlet-astro-dev-'));
  root = join(temp, 'site');
  admin = join(temp, 'admin');
  await put(root, 'cms/schema.json', JSON.stringify(schema, null, 2));
  await put(root, 'cms/content/post/hello.md', '---\ntitle: Hello\n---\n');
  await put(root, 'package.json', '{}');
  await put(admin, 'index.html', '<!doctype html><title>admin</title>');
  await put(admin, 'assets/a.js', 'export {};');
  await put(temp, 'x', 'outside');

  const middleware = createDevMiddleware({ root, schemaPath: 'cms/schema.json', adminDir: admin });
  server = createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 418;
      res.end('next');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(temp, { recursive: true, force: true });
});

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** Raw request: `fetch` would normalise the path and refuse a custom `Host`. */
function send(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: opts.method ?? 'GET',
        headers: { host: `localhost:${port}`, ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    req.on('error', reject);
    req.end(opts.body);
  });
}

describe('createDevMiddleware', () => {
  it('serves the dev API', async () => {
    const res = await send('/__editlet/files');
    expect(res.status).toBe(200);
    const { files } = JSON.parse(res.body) as { files: { path: string }[] };
    expect(files.map((f) => f.path)).toContain('cms/content/post/hello.md');
  });

  it('refuses a foreign Host', async () => {
    const res = await send('/__editlet/files', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  it('PUT round-trips a body', async () => {
    const body = '---\ntitle: A\n---\nBody\n';
    const res = await send('/__editlet/file?path=cms/content/post/a.md', {
      method: 'PUT',
      headers: { origin: `http://localhost:${port}`, 'content-type': 'text/markdown' },
      body,
    });
    expect(res.status, res.body).toBe(204);
    expect(await readFile(join(root, 'cms/content/post/a.md'), 'utf8')).toBe(body);
  });

  it('serves admin files', async () => {
    const index = await send('/editlet/');
    expect(index.status).toBe(200);
    expect(index.headers['content-type']).toMatch(/^text\/html/);
    expect(index.body).toContain('<title>admin</title>');

    const withQuery = await send('/editlet/?editlet=post/a');
    expect(withQuery.status).toBe(200);

    const js = await send('/editlet/assets/a.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/^text\/javascript/);
    expect(js.body).toBe('export {};');
  });

  it('answers HEAD without a body and refuses POST', async () => {
    const head = await send('/editlet/', { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    const post = await send('/editlet/', { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  it('answers 404 for a missing admin file or a directory', async () => {
    expect((await send('/editlet/nope.js')).status).toBe(404);
    expect((await send('/editlet/assets')).status).toBe(404);
  });

  it('refuses traversal', async () => {
    for (const path of ['/editlet/..%2F..%2Fpackage.json', '/editlet/%2e%2e/x', '/editlet/../x', '/editlet/%E0%A4%A']) {
      const res = await send(path);
      expect(res.status, path).toBe(404);
      expect(res.body, path).not.toContain('outside');
    }
  });

  it('passes other paths', async () => {
    expect((await send('/')).status).toBe(418);
    expect((await send('/editletx')).status).toBe(418);
    expect((await send('/__editletx')).status).toBe(418);
  });
});

const builtAdmin = join(import.meta.dirname, '../admin/dist/index.html');

describe('adminDir', () => {
  // Only meaningful until P6 builds the real admin into `admin/dist/`.
  it.skipIf(existsSync(builtAdmin))('falls back to the stub', () => {
    expect(existsSync(builtAdmin)).toBe(false);
    const dir = adminDir();
    expect(dir).toMatch(/astro[/\\]stub$/);
    expect(existsSync(join(dir, 'index.html'))).toBe(true);
  });
});

describe('sendWebResponse', () => {
  it('keeps every Set-Cookie header', async () => {
    const headers = new Headers({ 'content-type': 'text/plain' });
    headers.append('set-cookie', 'a=1; Path=/');
    headers.append('set-cookie', 'b=2; Path=/');
    const bridge = createServer((_req, res) => void sendWebResponse(res, new Response('ok', { status: 201, headers })));
    await new Promise<void>((resolve) => bridge.listen(0, '127.0.0.1', resolve));
    const { port: bridgePort } = bridge.address() as AddressInfo;
    try {
      const res = await new Promise<{ status?: number; cookies?: string[]; type?: string }>((resolve, reject) =>
        request({ host: '127.0.0.1', port: bridgePort, path: '/' }, (r) => {
          r.resume();
          r.on('end', () =>
            resolve({ status: r.statusCode, cookies: r.headers['set-cookie'], type: r.headers['content-type'] }),
          );
        })
          .on('error', reject)
          .end(),
      );
      expect(res).toEqual({ status: 201, cookies: ['a=1; Path=/', 'b=2; Path=/'], type: 'text/plain' });
    } finally {
      await new Promise((resolve) => bridge.close(resolve));
    }
  });
});

const fake = (o: object) => o as unknown as Parameters<typeof toWebRequest>[0];

describe('toWebRequest', () => {
  it('uses :authority and https for a TLS / HTTP2 request', () => {
    const web = toWebRequest(
      fake({
        headers: { ':authority': 'localhost:4321', origin: 'https://localhost:4321' },
        socket: { encrypted: true },
        method: 'GET',
        url: '/__editlet/files',
      }),
    );
    expect(new URL(web.url).origin).toBe('https://localhost:4321');
  });

  it('fails closed without a host', () => {
    const web = toWebRequest(fake({ headers: {}, socket: {}, method: 'GET', url: '/' }));
    expect(new URL(web.url).hostname).toBe('invalid.invalid');
  });

  it('uses http for a plain socket', () => {
    const web = toWebRequest(fake({ headers: { host: 'localhost:4321' }, socket: {}, method: 'GET', url: '/x' }));
    expect(new URL(web.url).origin).toBe('http://localhost:4321');
  });
});
