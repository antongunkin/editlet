// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleRequest, isAllowedOrigin, type Env } from './handler.ts';

const ALLOWED = 'https://site.example, https://*.preview.example, http://localhost:4321';
const env: Env = { GITHUB_CLIENT_ID: 'cid', GITHUB_CLIENT_SECRET: 'csecret', ALLOWED_ORIGINS: ALLOWED };

describe('isAllowedOrigin', () => {
  it.each([
    ['https://site.example', true],
    ['http://site.example', false],
    ['https://site.example:8443', false],
    ['https://a.preview.example', true],
    ['https://preview.example', false],
    ['https://a.b.preview.example', false],
    ['https://evil.example?.preview.example', false],
    ['http://localhost:4321', true],
    ['http://localhost:3000', false],
    ['https://siteXexample', false],
  ])('%s -> %s', (origin, expected) => {
    expect(isAllowedOrigin(origin, ALLOWED)).toBe(expected);
  });

  it('is case-insensitive for allowlist entries', () => {
    expect(isAllowedOrigin('https://site.example', 'https://Site.Example')).toBe(true);
  });

  it.each([undefined, '', ' , '])('fails closed for allowlist %j', (allowed) => {
    expect(isAllowedOrigin('https://site.example', allowed)).toBe(false);
    expect(isAllowedOrigin('', allowed)).toBe(false);
  });

  it('tolerates a trailing slash on an allowlist entry', () => {
    expect(isAllowedOrigin('https://site.example', 'https://site.example/')).toBe(true);
  });

  it.each([
    'https://site.example:*',
    'https://site.example/path',
    'https://site.example/*',
    'https://site.example?x=*',
    'http*://site.example',
  ])('entry %s never matches', (entry) => {
    expect(isAllowedOrigin('https://site.example', entry)).toBe(false);
    expect(isAllowedOrigin('https://site.example:8443', entry)).toBe(false);
    expect(isAllowedOrigin('https://site.example/path', entry)).toBe(false);
  });

  it('does not treat regex metacharacters as patterns', () => {
    expect(isAllowedOrigin('https://siteXexample', 'https://site.example')).toBe(false);
    expect(isAllowedOrigin('https://site.example', 'https://site.example')).toBe(true);
  });
});

describe('health', () => {
  it.each([env, {}])('GET /health -> 204 even when unconfigured', async (e) => {
    const res = await handleRequest(new Request('https://auth.example/health'), e);
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('router', () => {
  it.each([
    ['GET', 'https://auth.example/'],
    ['GET', 'https://auth.example/nope'],
    ['DELETE', 'https://auth.example/auth'],
  ])('%s %s -> 404', async (method, url) => {
    const res = await handleRequest(new Request(url, { method }), env);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('Not found');
  });
});

const BASE = 'https://auth.example';
const COOKIE = '__Host-editlet-oauth';

function b64urlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

async function sha256b64url(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...digest))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function startAuth(origin: string) {
  const res = await handleRequest(new Request(`${BASE}/auth?origin=${encodeURIComponent(origin)}`), env);
  const location = new URL(res.headers.get('location') ?? 'about:blank');
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return { res, location, cookie };
}

function decodeCookie(cookie: string): { state: string; verifier: string; origin: string } {
  return JSON.parse(b64urlDecode(cookie.slice(`${COOKIE}=`.length)));
}

function parsePage(html: string): { message: Record<string, unknown>; target: string } {
  const match = /const m = (.*?); const t = (.*?);/.exec(html);
  if (!match) throw new Error('no script in page');
  return { message: JSON.parse(match[1] as string), target: JSON.parse(match[2] as string) };
}

async function callback(query: string, cookie?: string, e: Env = env) {
  const res = await handleRequest(
    new Request(`${BASE}/callback?${query}`, { headers: cookie ? { Cookie: cookie } : {} }),
    e,
  );
  const html = await res.text();
  return { res, html, ...parsePage(html) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function signedIn() {
  const { location, cookie } = await startAuth('https://site.example');
  return { cookie, state: location.searchParams.get('state') as string, verifier: decodeCookie(cookie).verifier };
}

function expectClearedCookie(setCookie: string): void {
  for (const part of [`${COOKIE}=`, 'Max-Age=0', 'Secure', 'Path=/', 'HttpOnly', 'SameSite=Lax']) {
    expect(setCookie).toContain(part);
  }
}

function nonceOf(html: string): string | undefined {
  return /<script nonce="([^"]+)">/.exec(html)?.[1];
}

describe('/auth', () => {
  it('redirects to GitHub with PKCE and sets the state cookie', async () => {
    const { res, location, cookie } = await startAuth('https://site.example');
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('client_id')).toBe('cid');
    expect(location.searchParams.get('redirect_uri')).toBe('https://auth.example/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.has('scope')).toBe(false);

    const setCookie = res.headers.get('set-cookie') ?? '';
    for (const part of [`${COOKIE}=`, 'HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=600']) {
      expect(setCookie).toContain(part);
    }
    const payload = decodeCookie(cookie);
    expect(payload.origin).toBe('https://site.example');
    expect(payload.state).toBe(location.searchParams.get('state'));
    expect(location.searchParams.get('code_challenge')).toBe(await sha256b64url(payload.verifier));
  });

  it.each([
    ['(none)', ''],
    ['https://evil.example', '?origin=https%3A%2F%2Fevil.example'],
    ['trailing slash', '?origin=https%3A%2F%2Fsite.example%2F'],
    ['garbage', '?origin=%25%25not-a-url'],
  ])('rejects origin %s', async (_name, query) => {
    const res = await handleRequest(new Request(`${BASE}/auth${query}`), env);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('set-cookie')).toBeNull();
    const { message, target } = parsePage(await res.text());
    expect(message).toEqual({ source: 'editlet-auth', ok: false, error: 'origin_not_allowed' });
    expect(target).toBe('*');
  });

  it.each([
    ['ALLOWED_ORIGINS unset', { ALLOWED_ORIGINS: undefined }],
    ['ALLOWED_ORIGINS empty', { ALLOWED_ORIGINS: ' , ' }],
    ['GITHUB_CLIENT_SECRET unset', { GITHUB_CLIENT_SECRET: undefined }],
  ])('answers 500 server_misconfigured when %s', async (_name, override) => {
    const res = await handleRequest(new Request(`${BASE}/auth?origin=https%3A%2F%2Fsite.example`), {
      ...env,
      ...override,
    });
    expect(res.status).toBe(500);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(parsePage(await res.text()).message).toMatchObject({ ok: false, error: 'server_misconfigured' });
  });

  it('answers server_misconfigured without GITHUB_CLIENT_ID', async () => {
    const res = await handleRequest(new Request(`${BASE}/auth?origin=https%3A%2F%2Fsite.example`), {
      ...env,
      GITHUB_CLIENT_ID: undefined,
    });
    expect(res.status).toBe(500);
    expect(parsePage(await res.text()).message).toMatchObject({ ok: false, error: 'server_misconfigured' });
  });
});

describe('/callback', () => {
  it('exchanges the code and posts the filtered token to the cookie origin', async () => {
    const { cookie, state, verifier } = await signedIn();
    const fetchStub = vi.fn(async () =>
      Response.json({
        access_token: 'ghu_x',
        token_type: 'bearer',
        scope: '',
        expires_in: 28800,
        refresh_token: 'ghr_y',
        refresh_token_expires_in: 15897600,
        extra: 'drop-me',
      }),
    );
    vi.stubGlobal('fetch', fetchStub);

    const { res, html, message, target } = await callback(`code=c1&state=${state}`, cookie);

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect(init.method).toBe('POST');
    const headers = new Headers(init.headers);
    expect(headers.get('accept')).toBe('application/json');
    expect(headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: 'cid',
      client_secret: 'csecret',
      code: 'c1',
      redirect_uri: 'https://auth.example/callback',
      code_verifier: verifier,
    });

    expect(res.status).toBe(200);
    expect(message).toEqual({
      source: 'editlet-auth',
      ok: true,
      token: {
        access_token: 'ghu_x',
        token_type: 'bearer',
        scope: '',
        expires_in: 28800,
        refresh_token: 'ghr_y',
        refresh_token_expires_in: 15897600,
      },
    });
    expect(target).toBe('https://site.example');

    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.has('cross-origin-opener-policy')).toBe(false);
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    const nonce = /<script nonce="([^"]+)">/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`script-src 'nonce-${nonce}'`);
    expectClearedCookie(res.headers.get('set-cookie') ?? '');
    expect(html.replace(/<script[\s\S]*?<\/script>/, '')).not.toContain('ghu_x');
  });

  it('uses a fresh nonce per response', async () => {
    const a = await callback('error=access_denied');
    const b = await callback('error=access_denied');
    expect(nonceOf(a.html)).not.toBe(nonceOf(b.html));
  });

  it('reports a GitHub error param without calling the token endpoint', async () => {
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { message, target, res } = await callback('error=access_denied&error_description=User+said+no');
    expect(message).toEqual({
      source: 'editlet-auth',
      ok: false,
      error: 'access_denied',
      description: 'User said no',
    });
    expect(target).toBe('*');
    expectClearedCookie(res.headers.get('set-cookie') ?? '');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it.each(['wrong-state', 'missing-cookie', 'garbage-cookie'])('%s -> state_mismatch', async (kind) => {
    const { cookie, state } = await signedIn();
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const query = kind === 'wrong-state' ? 'code=c1&state=nope' : `code=c1&state=${state}`;
    const sent = kind === 'missing-cookie' ? undefined : kind === 'garbage-cookie' ? `${COOKIE}=%%%` : cookie;
    const { res, message, target } = await callback(query, sent);
    expect(res.status).toBe(200);
    expect(message).toMatchObject({ ok: false, error: 'state_mismatch' });
    expect(target).toBe('*');
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('rejects when the cookie origin is no longer allowed', async () => {
    const { cookie, state } = await signedIn();
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { message } = await callback(`code=c1&state=${state}`, cookie, {
      ...env,
      ALLOWED_ORIGINS: 'https://other.example',
    });
    expect(message).toMatchObject({ ok: false, error: 'origin_not_allowed' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('answers server_misconfigured without a client secret', async () => {
    const { cookie, state } = await signedIn();
    const fetchStub = vi.fn();
    vi.stubGlobal('fetch', fetchStub);
    const { res, message } = await callback(`code=c1&state=${state}`, cookie, {
      ...env,
      GITHUB_CLIENT_SECRET: undefined,
    });
    expect(res.status).toBe(500);
    expect(message).toMatchObject({ ok: false, error: 'server_misconfigured' });
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('passes through a GitHub error body', async () => {
    const { cookie, state } = await signedIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
        }),
      ),
    );
    const { message, target } = await callback(`code=c1&state=${state}`, cookie);
    expect(message).toEqual({
      source: 'editlet-auth',
      ok: false,
      error: 'bad_verification_code',
      description: 'The code passed is incorrect or expired.',
    });
    expect(target).toBe('*');
  });

  it.each([
    ['network error', () => Promise.reject(new TypeError('boom'))],
    ['non-JSON', async () => new Response('<html>oops</html>', { status: 502 })],
    ['no access_token', async () => Response.json({ token_type: 'bearer' })],
  ])('%s -> token_request_failed', async (_name, impl) => {
    const { cookie, state } = await signedIn();
    vi.stubGlobal('fetch', vi.fn(impl));
    const { message, target } = await callback(`code=c1&state=${state}`, cookie);
    expect(message).toMatchObject({ ok: false, error: 'token_request_failed' });
    expect(target).toBe('*');
  });

  it('replaces a hostile GitHub error param with unknown_error', async () => {
    const { html, message } = await callback(`error=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    expect(message).toMatchObject({ ok: false, error: 'unknown_error' });
    expect(html).not.toContain('<img');
    expect(html).toContain('Sign-in failed: unknown_error.');
  });

  it('escapes a token-endpoint error code in the visible text', async () => {
    const { cookie, state } = await signedIn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: '<b>x</b>&"\'' })),
    );
    const { html } = await callback(`code=c1&state=${state}`, cookie);
    expect(html).toContain('Sign-in failed: &#60;b&#62;x&#60;/b&#62;&#38;&#34;&#39;.');
    expect(html).not.toContain('<b>');
  });

  it('cannot be broken out of the script by a hostile error_description', async () => {
    const hostile = '</script><script>alert(1)</script>';
    const { html, message } = await callback(`error=x&error_description=${encodeURIComponent(hostile)}`);
    expect(html).not.toContain('</script><script>');
    expect(message.description).toBe(hostile);
  });
});

function stubFetch(impl: () => Promise<Response>) {
  const fn = vi.fn(impl);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('/refresh', () => {
  const ORIGIN = 'https://site.example';
  const call = (method: string, init: { origin?: string | null; body?: string; env?: Env } = {}) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const origin = init.origin === undefined ? ORIGIN : init.origin;
    if (origin) headers.Origin = origin;
    return handleRequest(new Request(`${BASE}/refresh`, { method, headers, body: init.body }), init.env ?? env);
  };
  const post = (body: string, init: { origin?: string | null; env?: Env } = {}) => call('POST', { ...init, body });

  afterEach(() => vi.unstubAllGlobals());

  it('answers the preflight for an allowed origin', async () => {
    const res = await call('OPTIONS');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
    expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    expect(res.headers.get('Vary')).toBe('Origin');
  });

  it.each([
    ['OPTIONS', 'https://evil.example'],
    ['OPTIONS', null],
    ['POST', 'https://evil.example'],
    ['POST', null],
  ])('%s from origin %j -> 403 without CORS headers', async (method, origin) => {
    const fetchMock = stubFetch(async () => Response.json({}));
    const res = await call(method, { origin, body: method === 'POST' ? '{"refresh_token":"ghr_y"}' : undefined });
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exchanges the refresh token and returns the filtered token', async () => {
    const fetchMock = stubFetch(async () =>
      Response.json({
        access_token: 'ghu_new',
        token_type: 'bearer',
        scope: '',
        expires_in: 28800,
        refresh_token: 'ghr_new',
        refresh_token_expires_in: 15897600,
        extra: 'dropped',
      }),
    );
    const res = await post('{"refresh_token":"ghr_y"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      access_token: 'ghu_new',
      token_type: 'bearer',
      scope: '',
      expires_in: 28800,
      refresh_token: 'ghr_new',
      refresh_token_expires_in: 15897600,
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(res.headers.get('Cache-Control')).toBe('no-store');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://github.com/login/oauth/access_token');
    expect((init.headers as Record<string, string>).Accept).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      client_id: 'cid',
      client_secret: 'csecret',
      grant_type: 'refresh_token',
      refresh_token: 'ghr_y',
    });
  });

  it.each(['not json', '{}', '{"refresh_token": 5}', '{"refresh_token": ""}', 'null'])(
    'body %j -> 400 invalid_request',
    async (body) => {
      const fetchMock = stubFetch(async () => Response.json({}));
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid_request' });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('maps a GitHub error body to 400 with error and description', async () => {
    stubFetch(async () => Response.json({ error: 'bad_refresh_token', error_description: 'The token is bad.' }));
    const res = await post('{"refresh_token":"ghr_y"}');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_refresh_token', error_description: 'The token is bad.' });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('omits error_description when GitHub sends none', async () => {
    stubFetch(async () => Response.json({ error: 'bad_refresh_token' }));
    const res = await post('{"refresh_token":"ghr_y"}');
    expect(await res.json()).toEqual({ error: 'bad_refresh_token' });
  });

  it('maps an upstream failure to 502', async () => {
    stubFetch(() => Promise.reject(new TypeError('boom')));
    const res = await post('{"refresh_token":"ghr_y"}');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'token_request_failed' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('returns 500 server_misconfigured without a client secret', async () => {
    const fetchMock = stubFetch(async () => Response.json({}));
    const res = await post('{"refresh_token":"ghr_y"}', { env: { ...env, GITHUB_CLIENT_SECRET: undefined } });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_misconfigured' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('GET /refresh -> 404', async () => {
    const res = await call('GET');
    expect(res.status).toBe(404);
  });
});

const tokenStub = () => vi.fn(async () => Response.json({ access_token: 'ghu_x', token_type: 'bearer', scope: '' }));

async function signInVia(requestBase: string, publicUrl: string) {
  const e: Env = { ...env, PUBLIC_URL: publicUrl };
  const auth = await handleRequest(
    new Request(`${requestBase}/auth?origin=${encodeURIComponent('https://site.example')}`),
    e,
  );
  const location = new URL(auth.headers.get('location') ?? 'about:blank');
  const cookie = (auth.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const fetchStub = tokenStub();
  vi.stubGlobal('fetch', fetchStub);
  const res = await handleRequest(
    new Request(`${requestBase}/callback?code=c1&state=${location.searchParams.get('state')}`, {
      headers: { Cookie: cookie },
    }),
    e,
  );
  const [, init] = (fetchStub.mock.calls[0] ?? []) as unknown as [string, RequestInit];
  return { auth, location, res, exchangeBody: init ? JSON.parse(init.body as string) : undefined };
}

describe('PUBLIC_URL', () => {
  it('uses the public origin behind a proxy', async () => {
    const { auth, location, res, exchangeBody } = await signInVia('http://10.0.0.5:3000', 'https://auth.example.com');
    expect(auth.status).toBe(302);
    expect(location.searchParams.get('redirect_uri')).toBe('https://auth.example.com/callback');
    expect(parsePage(await res.text()).message.ok).toBe(true);
    expect(exchangeBody.redirect_uri).toBe('https://auth.example.com/callback');
  });

  it('serves under a base path and builds redirect_uri from it', async () => {
    const { location, res, exchangeBody } = await signInVia(
      'https://site.example/api/editlet/oauth',
      'https://site.example/api/editlet/oauth/',
    );
    expect(location.searchParams.get('redirect_uri')).toBe('https://site.example/api/editlet/oauth/callback');
    expect(exchangeBody.redirect_uri).toBe('https://site.example/api/editlet/oauth/callback');
    expect(parsePage(await res.text()).message.ok).toBe(true);
  });

  it('routes /refresh under the base path', async () => {
    vi.stubGlobal('fetch', tokenStub());
    const res = await handleRequest(
      new Request('https://site.example/api/editlet/oauth/refresh', {
        method: 'POST',
        headers: { Origin: 'https://site.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: 'ghr_y' }),
      }),
      { ...env, PUBLIC_URL: 'https://site.example/api/editlet/oauth' },
    );
    expect(res.status).toBe(200);
  });

  it.each(['https://site.example/auth', 'https://site.example/other/auth'])(
    '%s outside the base path -> 404',
    async (url) => {
      const res = await handleRequest(new Request(url), {
        ...env,
        PUBLIC_URL: 'https://site.example/api/editlet/oauth',
      });
      expect(res.status).toBe(404);
    },
  );

  it.each(['not a url', 'foo:bar', 'http://site.example', 'ftp://site.example'])(
    'answers 500 server_misconfigured for PUBLIC_URL %s',
    async (publicUrl) => {
      const res = await handleRequest(new Request(`${BASE}/auth?origin=https%3A%2F%2Fsite.example`), {
        ...env,
        PUBLIC_URL: publicUrl,
      });
      expect(res.status).toBe(500);
      expect(parsePage(await res.text()).message.error).toBe('server_misconfigured');
    },
  );

  it.each(['http://localhost:8787', 'http://127.0.0.1:8787'])('accepts plain-http PUBLIC_URL %s', async (publicUrl) => {
    const res = await handleRequest(new Request(`${publicUrl}/auth?origin=https%3A%2F%2Fsite.example`), {
      ...env,
      PUBLIC_URL: publicUrl,
    });
    expect(res.status).toBe(302);
  });

  it('tolerates one trailing slash after a route (Next.js trailingSlash)', async () => {
    const res = await handleRequest(
      new Request('https://site.example/api/editlet/oauth/auth/?origin=https%3A%2F%2Fsite.example'),
      { ...env, PUBLIC_URL: 'https://site.example/api/editlet/oauth' },
    );
    expect(res.status).toBe(302);
  });
});
