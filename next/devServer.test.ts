import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
// @vitest-environment node
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startDevApi } from './devServer';

const FIXTURE = join(__dirname, '__fixtures__/site');
const BODY = '---\ntitle: New\nauthor: author/jane\n---\nHi\n';

let closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.map((close) => close()));
  closers = [];
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'editlet-devserver-'));
  await cp(FIXTURE, root, { recursive: true });
  const api = await startDevApi({ root });
  closers.push(api.close, () => rm(root, { recursive: true, force: true }));
  return { root, base: `http://127.0.0.1:${api.port}` };
}

function rawGet(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/__editlet/files', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

describe('startDevApi', () => {
  it('rejects a direct request with a foreign Host and forged x-forwarded-host', async () => {
    const { base } = await setup();
    const port = Number(new URL(base).port);
    expect(await rawGet(port, { host: `evil.test:${port}`, 'x-forwarded-host': 'localhost:3000' })).toBe(403);
  });

  it('rejects a request without x-forwarded-host', async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/__editlet/files`);
    expect(res.status).toBe(403);
  });

  it('rejects a non-local forwarded host via the handler host check', async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/__editlet/files`, { headers: { 'x-forwarded-host': 'evil.test' } });
    expect(res.status).toBe(403);
  });

  it('serves the file list using the forwarded host', async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/__editlet/files`, { headers: { 'x-forwarded-host': 'localhost:3000' } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { files: unknown[] };
    expect(body.files.length).toBeGreaterThan(0);
  });

  it('accepts a same-origin PUT and writes the file', async () => {
    const { root, base } = await setup();
    const res = await fetch(`${base}/__editlet/file?path=cms/content/post/new.md`, {
      method: 'PUT',
      body: BODY,
      headers: { origin: 'http://localhost:3000', 'x-forwarded-host': 'localhost:3000' },
    });
    expect(res.status).toBe(204);
    expect(await readFile(join(root, 'cms/content/post/new.md'), 'utf8')).toBe(BODY);
  });

  it('rejects a cross-origin PUT with 403', async () => {
    const { base } = await setup();
    const res = await fetch(`${base}/__editlet/file?path=cms/content/post/new.md`, {
      method: 'PUT',
      body: BODY,
      headers: { origin: 'http://evil.test', 'x-forwarded-host': 'localhost:3000' },
    });
    expect(res.status).toBe(403);
  });

  it('startDevApi rejects in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    try {
      await expect(startDevApi({ root: '.' })).rejects.toThrow('must not be used in production');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
