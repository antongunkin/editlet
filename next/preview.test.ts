// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPreviewHandlers } from './preview';
import { PREVIEW_COOKIE, signPreview, verifyPreview } from './previewCookie';
import { previewRef } from './previewRef';

type CookieOptions = Record<string, unknown>;

const h = vi.hoisted(() => ({
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
  draft: { enabled: false },
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (h.jar.has(name) ? { name, value: h.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: CookieOptions) => {
      h.jar.set(name, { value, options });
    },
    delete: (arg: string | { name: string }) => {
      h.jar.delete(typeof arg === 'string' ? arg : arg.name);
    },
  }),
  draftMode: async () => ({
    get isEnabled() {
      return h.draft.enabled;
    },
    enable: () => {
      h.draft.enabled = true;
    },
    disable: () => {
      h.draft.enabled = false;
    },
  }),
}));

const SECRET = 'a'.repeat(32);
const TOKEN = 'gho_editor-token-123';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const NOW = 1_700_000_000_000;
const SITE = 'https://site.example';
const ENV = { owner: 'acme', repo: 'site', schemaPath: 'cms/schema.json', sessionMinutes: 60 };

function setEnv(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    CMS_PREVIEW_SECRET: SECRET,
    CMS_GITHUB_TOKEN: 'github_pat_server',
    EDITLET_PREVIEW: JSON.stringify(ENV),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function repoResponse(push: boolean, status = 200) {
  return new Response(JSON.stringify({ permissions: { push, pull: true } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(init: { origin?: string | null; body?: unknown; token?: string | null } = {}) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const origin = init.origin === undefined ? SITE : init.origin;
  if (origin !== null) headers.set('Origin', origin);
  const token = init.token === undefined ? TOKEN : init.token;
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  const body = init.body === undefined ? { branch: 'editlet/home', sha: SHA } : init.body;
  return new Request(`${SITE}/api/editlet/preview`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function handlers(push = true) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => repoResponse(push));
  return { fetch, ...createPreviewHandlers({ fetch: fetch as unknown as typeof globalThis.fetch, now: () => NOW }) };
}

beforeEach(() => {
  h.jar.clear();
  h.draft.enabled = false;
  setEnv();
});

afterEach(() => vi.unstubAllEnvs());

describe('preview cookie', () => {
  it('sign/verify round-trip', async () => {
    const value = await signPreview({ branch: 'editlet/home', sha: SHA, exp: NOW / 1000 + 60 }, SECRET);
    expect(value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(await verifyPreview(value, SECRET, NOW)).toEqual({ branch: 'editlet/home', sha: SHA });
  });

  it('verify rejects a tampered payload', async () => {
    const value = await signPreview({ branch: 'editlet/home', sha: SHA, exp: NOW / 1000 + 60 }, SECRET);
    const [payload, sig] = value.split('.');
    const flipped = payload.slice(0, 5) + (payload[5] === 'A' ? 'B' : 'A') + payload.slice(6);
    expect(await verifyPreview(`${flipped}.${sig}`, SECRET, NOW)).toBeNull();
    expect(await verifyPreview(value, 'b'.repeat(32), NOW)).toBeNull();
    expect(await verifyPreview('garbage', SECRET, NOW)).toBeNull();
    expect(await verifyPreview(`${payload}.${sig}.x`, SECRET, NOW)).toBeNull();
    expect(await verifyPreview(`${payload}.!!`, SECRET, NOW)).toBeNull();
  });

  it('verify rejects an expired cookie', async () => {
    const value = await signPreview({ branch: 'editlet/home', sha: SHA, exp: NOW / 1000 }, SECRET);
    expect(await verifyPreview(value, SECRET, NOW)).toBeNull();
    expect(await verifyPreview(value, SECRET, NOW - 1000)).toEqual({ branch: 'editlet/home', sha: SHA });
  });

  it('verify rejects a signed payload with the wrong shape', async () => {
    const value = await signPreview({ branch: 'a..b', sha: SHA, exp: NOW / 1000 + 60 }, SECRET);
    expect(await verifyPreview(value, SECRET, NOW)).toBeNull();
  });

  it('builds the cookie name from the protocol source', () => {
    expect(PREVIEW_COOKIE).toBe('editlet-preview');
  });
});

describe('POST', () => {
  it('POST 403 on a foreign Origin', async () => {
    const { POST, fetch } = handlers();
    expect((await POST(request({ origin: 'https://evil.example' }))).status).toBe(403);
    expect((await POST(request({ origin: null }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
    expect(h.draft.enabled).toBe(false);
  });

  it('POST 400 on a bad branch name or a bad sha', async () => {
    const { POST, fetch } = handlers();
    expect((await POST(request({ body: { branch: 'a..b', sha: SHA } }))).status).toBe(400);
    expect((await POST(request({ body: { branch: 'editlet/home', sha: 'abc' } }))).status).toBe(400);
    expect((await POST(request({ body: { branch: 'editlet/home', sha: SHA.toUpperCase() } }))).status).toBe(400);
    expect((await POST(request({ body: '{nope' }))).status).toBe(400);
    expect((await POST(request({ body: [] }))).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST 401 without a token', async () => {
    const { POST, fetch } = handlers();
    expect((await POST(request({ token: null }))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST 403 without push', async () => {
    const { POST } = handlers(false);
    expect((await POST(request())).status).toBe(403);
    expect(h.draft.enabled).toBe(false);
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(false);

    const failing = vi.fn(async () => repoResponse(true, 404));
    const other = createPreviewHandlers({ fetch: failing as unknown as typeof fetch, now: () => NOW });
    expect((await other.POST(request())).status).toBe(403);
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(false);
  });

  it('POST 401 on a malformed Authorization header', async () => {
    const { POST, fetch } = handlers();
    for (const value of ['Bearer', 'Bearer ', 'Basic abc', `Bearer ${TOKEN} extra`, TOKEN]) {
      const req = request({ token: null });
      req.headers.set('Authorization', value);
      expect((await POST(req)).status).toBe(401);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST 502 when GitHub cannot be reached', async () => {
    const throwing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const { POST } = createPreviewHandlers({ fetch: throwing as unknown as typeof fetch, now: () => NOW });
    const res = await POST(request());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain(TOKEN);
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(false);
  });

  it('POST 502 on a GitHub 5xx or 429, not 403', async () => {
    for (const status of [500, 502, 503, 429]) {
      const failing = vi.fn(async () => new Response('busy', { status }));
      const { POST } = createPreviewHandlers({ fetch: failing as unknown as typeof fetch, now: () => NOW });
      const res = await POST(request());
      expect(res.status).toBe(502);
      expect(await res.text()).not.toContain('No push access');
    }
    expect(h.draft.enabled).toBe(false);
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(false);
  });

  it('POST 500 names a missing CMS_PREVIEW_SECRET', async () => {
    const { POST, fetch } = handlers();
    setEnv({ CMS_PREVIEW_SECRET: undefined });
    let res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('CMS_PREVIEW_SECRET');

    setEnv({ CMS_PREVIEW_SECRET: 'tiny-secret-q7' });
    res = await POST(request());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('CMS_PREVIEW_SECRET');
    expect(text).not.toContain('tiny-secret-q7');

    setEnv({ CMS_GITHUB_TOKEN: undefined });
    res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('CMS_GITHUB_TOKEN');

    setEnv({ EDITLET_PREVIEW: undefined });
    res = await POST(request());
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('EDITLET_PREVIEW');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('POST enables draft mode and sets an HttpOnly Lax cookie', async () => {
    const { POST } = handlers();
    const res = await POST(request());
    expect(res.status).toBe(204);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(h.draft.enabled).toBe(true);
    const cookie = h.jar.get(PREVIEW_COOKIE)!;
    expect(cookie.options).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 3600 });
    expect(await verifyPreview(cookie.value, SECRET, NOW)).toEqual({ branch: 'editlet/home', sha: SHA });
    expect(await verifyPreview(cookie.value, SECRET, NOW + 3600 * 1000)).toBeNull();
  });

  it('the editor token is used only for the permission call', async () => {
    const { POST, fetch } = handlers();
    await POST(request());
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe('https://api.github.com/repos/acme/site');
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
    expect(headers.get('X-GitHub-Api-Version')).toBe('2022-11-28');
    const value = h.jar.get(PREVIEW_COOKIE)!.value;
    expect(value).not.toContain(TOKEN);
    const payload = Buffer.from(value.split('.')[0], 'base64url').toString('utf8');
    expect(payload).not.toContain(TOKEN);
    expect(payload).not.toContain(SECRET);
  });

  it('error responses do not echo the token', async () => {
    const { POST } = handlers(false);
    const res = await POST(request());
    expect(await res.text()).not.toContain(TOKEN);
  });
});

describe('DELETE', () => {
  it('DELETE disables draft mode and clears the cookie', async () => {
    const { POST, DELETE } = handlers();
    await POST(request());
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(true);
    const res = await DELETE();
    expect(res.status).toBe(204);
    expect(h.draft.enabled).toBe(false);
    expect(h.jar.has(PREVIEW_COOKIE)).toBe(false);
  });
});

describe('previewRef', () => {
  it('previewRef is undefined when draft mode is off', async () => {
    h.jar.set(PREVIEW_COOKIE, { value: await signPreview({ branch: 'editlet/home', sha: SHA, exp: 9e9 }, SECRET) });
    expect(await previewRef()).toBeUndefined();
  });

  it('previewRef returns the ref for a valid cookie', async () => {
    h.draft.enabled = true;
    const exp = Math.floor(Date.now() / 1000) + 60;
    h.jar.set(PREVIEW_COOKIE, { value: await signPreview({ branch: 'editlet/home', sha: SHA, exp }, SECRET) });
    expect(await previewRef()).toEqual({ branch: 'editlet/home', sha: SHA });
  });

  it('previewRef is undefined for a missing, forged or expired cookie, or a missing secret', async () => {
    h.draft.enabled = true;
    expect(await previewRef()).toBeUndefined();
    const exp = Math.floor(Date.now() / 1000) + 60;
    h.jar.set(PREVIEW_COOKIE, { value: await signPreview({ branch: 'editlet/home', sha: SHA, exp }, 'f'.repeat(32)) });
    expect(await previewRef()).toBeUndefined();
    h.jar.set(PREVIEW_COOKIE, { value: await signPreview({ branch: 'editlet/home', sha: SHA, exp: 1 }, SECRET) });
    expect(await previewRef()).toBeUndefined();
    h.jar.set(PREVIEW_COOKIE, { value: await signPreview({ branch: 'editlet/home', sha: SHA, exp }, SECRET) });
    setEnv({ CMS_PREVIEW_SECRET: undefined });
    expect(await previewRef()).toBeUndefined();
  });
});
