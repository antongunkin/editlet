import { AUTH_MESSAGE_SOURCE, type AuthMessage, type TokenResponse } from './protocol.ts';

/** Configuration. Cloudflare passes it as bindings; Node, Bun, Deno and Next pass `process.env`. */
export interface Env {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  ALLOWED_ORIGINS?: string;
  /** Public URL of this handler, e.g. `https://example.com/api/editlet/oauth`. Needed behind a proxy or under a path. */
  PUBLIC_URL?: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

const WILDCARD_PROBE = 'wildcard0';

/**
 * Turns one allowlist entry into a regex, or `null` when the entry is malformed (fails closed).
 * An entry must be a bare origin (`scheme://host[:port]`, trailing `/` tolerated); `*` is only valid in the host.
 */
function entryToRegex(raw: string): RegExp | null {
  const entry = raw.toLowerCase().replace(/\/+$/, '');
  const probe = entry.replace(/\*/g, WILDCARD_PROBE);
  let parsed: URL;
  try {
    parsed = new URL(probe);
  } catch {
    return null;
  }
  if (parsed.origin !== probe) return null;
  const count = (text: string) => text.split(WILDCARD_PROBE).length - 1;
  if (count(probe) !== count(parsed.hostname)) return null;
  return new RegExp(`^${escapeRegex(entry).replace(/\*/g, '[a-z0-9-]+')}$`);
}

function allowlistEntries(allowed: string | undefined): string[] {
  return (allowed ?? '').split(/[\s,]+/).filter(Boolean);
}

/**
 * Matches a canonical origin against a comma/whitespace-separated allowlist.
 * `*` matches one or more of `[a-z0-9-]` (never a dot) and is valid only in the host. Entries with a path, query,
 * or a wildcard outside the host never match. Fails closed on empty input.
 */
export function isAllowedOrigin(origin: string, allowed: string | undefined): boolean {
  return allowlistEntries(allowed).some((entry) => entryToRegex(entry)?.test(origin) ?? false);
}

const COOKIE_NAME = '__Host-editlet-oauth';
const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

type TokenFailure = { error: string; description?: string };

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function isCanonicalAllowedOrigin(origin: string | null, env: Env): origin is string {
  if (!origin) return false;
  try {
    return new URL(origin).origin === origin && isAllowedOrigin(origin, env.ALLOWED_ORIGINS);
  } catch {
    return false;
  }
}

function readCookie(request: Request): { state: string; verifier: string; origin: string } | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1 || part.slice(0, index).trim() !== COOKIE_NAME) continue;
    try {
      const raw = part
        .slice(index + 1)
        .trim()
        .replace(/-/g, '+')
        .replace(/_/g, '/');
      const data: unknown = JSON.parse(atob(raw + '='.repeat((4 - (raw.length % 4)) % 4)));
      if (typeof data !== 'object' || data === null) return null;
      const { state, verifier, origin } = data as Record<string, unknown>;
      if (typeof state !== 'string' || typeof verifier !== 'string' || typeof origin !== 'string') return null;
      return { state, verifier, origin };
    } catch {
      return null;
    }
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function callbackPage(
  message: AuthMessage,
  target: string,
  status: number,
  headers: Headers = new Headers(),
): Response {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const text = message.ok
    ? 'Signed in. You can close this window.'
    : `Sign-in failed: ${escapeHtml(message.error)}. Close this window and try again.`;
  const script = `const m = ${safeJson(message)}; const t = ${safeJson(target)}; if (window.opener) { window.opener.postMessage(m, t); window.close(); }`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Editlet sign-in</title></head><body><p>${text}</p><script nonce="${nonce}">${script}</script></body></html>`;
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`);
  return new Response(html, { status, headers });
}

function failure(error: string, status: number, description?: string, headers?: Headers): Response {
  const message: AuthMessage = { source: AUTH_MESSAGE_SOURCE, ok: false, error };
  if (description) message.description = description;
  return callbackPage(message, '*', status, headers);
}

/** Posts a grant to GitHub's token endpoint. `params` are the grant-specific fields. */
async function exchangeToken(env: Env, params: Record<string, string>): Promise<TokenResponse | TokenFailure> {
  let data: unknown;
  try {
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, ...params }),
    });
    data = await res.json();
  } catch {
    return { error: 'token_request_failed' };
  }
  if (typeof data !== 'object' || data === null) return { error: 'token_request_failed' };
  const body = data as Record<string, unknown>;
  if (typeof body.error === 'string') {
    const failed: TokenFailure = { error: body.error };
    if (typeof body.error_description === 'string') failed.description = body.error_description;
    return failed;
  }
  if (typeof body.access_token !== 'string') return { error: 'token_request_failed' };
  const token: TokenResponse = {
    access_token: body.access_token,
    token_type: typeof body.token_type === 'string' ? body.token_type : 'bearer',
    scope: typeof body.scope === 'string' ? body.scope : '',
  };
  if (typeof body.expires_in === 'number') token.expires_in = body.expires_in;
  if (typeof body.refresh_token === 'string') token.refresh_token = body.refresh_token;
  if (typeof body.refresh_token_expires_in === 'number') token.refresh_token_expires_in = body.refresh_token_expires_in;
  return token;
}

async function handleAuth(url: URL, base: string, env: Env): Promise<Response> {
  if (allowlistEntries(env.ALLOWED_ORIGINS).length === 0 || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return failure('server_misconfigured', 500);
  }
  const origin = url.searchParams.get('origin');
  if (!isCanonicalAllowedOrigin(origin, env)) return failure('origin_not_allowed', 400);

  const state = randomToken();
  const verifier = randomToken();
  const authorize = new URL(GITHUB_AUTHORIZE_URL);
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${base}/callback`);
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', await pkceChallenge(verifier));
  authorize.searchParams.set('code_challenge_method', 'S256');

  const payload = base64url(new TextEncoder().encode(JSON.stringify({ state, verifier, origin })));
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': `${COOKIE_NAME}=${payload}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      'Cache-Control': 'no-store',
    },
  });
}

async function handleCallback(request: Request, url: URL, base: string, env: Env): Promise<Response> {
  const clear = new Headers({
    'Set-Cookie': `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`,
  });
  const fail = (error: string, status = 200, description?: string) =>
    failure(error, status, description, new Headers(clear));

  const githubError = url.searchParams.get('error');
  if (githubError) {
    // The code is rendered in the page text, so only accept GitHub's snake_case identifiers.
    const safe = /^[a-z0-9_]{1,64}$/.test(githubError) ? githubError : 'unknown_error';
    return fail(safe, 200, url.searchParams.get('error_description') ?? undefined);
  }

  const cookie = readCookie(request);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!cookie || !code || !state || state !== cookie.state) return fail('state_mismatch');
  if (!isCanonicalAllowedOrigin(cookie.origin, env)) return fail('origin_not_allowed');
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail('server_misconfigured', 500);

  const result = await exchangeToken(env, {
    code,
    redirect_uri: `${base}/callback`,
    code_verifier: cookie.verifier,
  });
  if ('error' in result) return fail(result.error, 200, result.description);
  return callbackPage({ source: AUTH_MESSAGE_SOURCE, ok: true, token: result }, cookie.origin, 200, new Headers(clear));
}

function json(body: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
    },
  });
}

async function handleRefresh(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!isCanonicalAllowedOrigin(origin, env)) return new Response('Forbidden', { status: 403 });

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      },
    });
  }

  let refreshToken: unknown;
  try {
    const body: unknown = await request.json();
    refreshToken = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).refresh_token : null;
  } catch {
    refreshToken = null;
  }
  if (typeof refreshToken !== 'string' || !refreshToken) return json({ error: 'invalid_request' }, 400, origin);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return json({ error: 'server_misconfigured' }, 500, origin);

  const result = await exchangeToken(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!('error' in result)) return json(result, 200, origin);
  if (result.error === 'token_request_failed') return json({ error: result.error }, 502, origin);
  const body: Record<string, string> = { error: result.error };
  if (result.description) body.error_description = result.description;
  return json(body, 400, origin);
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Public base URL without a trailing `/`: `PUBLIC_URL` when set, else the request origin.
 * `null` when `PUBLIC_URL` is unparsable or not HTTPS (plain HTTP only on localhost): the state cookie is `Secure`.
 */
function publicBase(request: Request, env: Env): string | null {
  if (!env.PUBLIC_URL) return new URL(request.url).origin;
  let url: URL;
  try {
    url = new URL(env.PUBLIC_URL);
  } catch {
    return null;
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname));
  return secure ? `${url.origin}${url.pathname}`.replace(/\/+$/, '') : null;
}

/** The whole auth service as one Web-standard handler. Runs on any `fetch(Request) → Response` runtime. */
export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const base = publicBase(request, env);
  if (base === null) return failure('server_misconfigured', 500);
  const url = new URL(request.url);
  const basePath = new URL(base).pathname.replace(/\/$/, '');
  if (basePath && !url.pathname.startsWith(`${basePath}/`)) return notFound();
  // Tolerate one trailing slash after a route (e.g. Next.js `trailingSlash: true`).
  const route = url.pathname.slice(basePath.length).replace(/(.)\/$/, '$1');
  switch (`${request.method} ${route}`) {
    case 'GET /health':
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    case 'GET /auth':
      return handleAuth(url, base, env);
    case 'GET /callback':
      return handleCallback(request, url, base, env);
    case 'OPTIONS /refresh':
    case 'POST /refresh':
      return handleRefresh(request, env);
    default:
      return notFound();
  }
}
