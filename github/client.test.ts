import { describe, expect, it, vi } from 'vitest';

import { createGitHubClient, encodeRef, GitHubError } from './client.ts';

import { AuthError } from '../auth/client.ts';

type Err = { code: string; retryAt?: number; graphqlErrors: { type: string }[] };
const fail = (p: Promise<unknown>): Promise<Err> =>
  p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e) => e as Err,
  );
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

function setup(responses: (Response | (() => Promise<Response>))[], opts: { now?: () => number } = {}) {
  let i = 0;
  const fetchMock = vi.fn(async () => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return typeof r === 'function' ? r() : r.clone();
  });
  const sleep = vi.fn(async () => {});
  const client = createGitHubClient({
    token: 't',
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
    now: opts.now ?? (() => 1_000_000),
  });
  return { client, fetchMock, sleep };
}

describe('github client', () => {
  it('sends auth, accept and api-version headers', async () => {
    const { client, fetchMock } = setup([json({ ok: 1 }), json({ data: { a: 1 } })]);
    await client.rest('GET', '/repos/o/r', { query: { per_page: 5, x: undefined } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r?per_page=5');
    expect(init.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: 'Bearer t',
    });
    const data = await client.graphql<{ a: number }>('query { a }', { v: 1 });
    expect(data).toEqual({ a: 1 });
    const [gurl, ginit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(gurl).toBe('https://api.github.com/graphql');
    expect(ginit.method).toBe('POST');
    expect(JSON.parse(ginit.body as string)).toEqual({ query: 'query { a }', variables: { v: 1 } });
  });

  it('token getter is called per request', async () => {
    const tokens = ['a', 'b'];
    const fetchMock = vi.fn(async (..._a: unknown[]) => json({}));
    const client = createGitHubClient({ token: () => tokens.shift()!, fetch: fetchMock as unknown as typeof fetch });
    await client.rest('GET', '/x');
    await client.rest('GET', '/x');
    const auth = fetchMock.mock.calls.map(
      (c) => (c as unknown as [string, RequestInit])[1].headers as Record<string, string>,
    );
    expect(auth.map((h) => h.Authorization)).toEqual(['Bearer a', 'Bearer b']);
  });

  it('maps 401 to AuthError unauthorized', async () => {
    const { client } = setup([json({ message: 'Bad credentials' }, 401)]);
    const err = await fail(client.rest('GET', '/x'));
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('unauthorized');
  });

  it('maps permission 403 to AuthError forbidden', async () => {
    const { client } = setup([json({ message: 'Resource not accessible' }, 403)]);
    const err = await fail(client.rest('GET', '/x'));
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('forbidden');
  });

  it('maps 404 and other statuses', async () => {
    const a = await setup([json({ message: 'Not Found' }, 404)])
      .client.rest('GET', '/x')
      .catch((e) => e as Err);
    expect(a).toMatchObject({ code: 'not_found', status: 404 });
    const b = await setup([json({ message: 'boom' }, 500)])
      .client.rest('GET', '/x')
      .catch((e) => e as Err);
    expect(b).toMatchObject({ code: 'http_error', status: 500, message: 'boom' });
  });

  it('includes validation errors[].message in a 422 message', async () => {
    const err = await setup([
      json({ message: 'Validation Failed', errors: [{ message: 'No commits between main and editlet/x' }] }, 422),
    ])
      .client.rest('POST', '/x')
      .catch((e) => e as Err);
    expect(err).toMatchObject({ code: 'http_error', status: 422 });
    expect((err as Error).message).toBe('Validation Failed: No commits between main and editlet/x');
  });

  it('retries a secondary rate limit after retry-after', async () => {
    const { client, sleep, fetchMock } = setup([
      json({ message: 'slow down' }, 403, { 'retry-after': '2' }),
      json({ ok: true }),
    ]);
    await expect(client.rest('GET', '/x')).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up when the wait is over 60 s', async () => {
    const now = 1_000_000;
    const reset = String(Math.floor(now / 1000) + 3600);
    const { client, fetchMock } = setup(
      [json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset })],
      { now: () => now },
    );
    const err = await fail(client.rest('GET', '/x'));
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe('rate_limited');
    expect(err.retryAt).toBe(now + (Number(reset) * 1000 - now));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops after 3 attempts', async () => {
    const { client, fetchMock } = setup([json({ message: 'x' }, 429, { 'retry-after': '1' })]);
    const err = await fail(client.rest('GET', '/x'));
    expect(err.code).toBe('rate_limited');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('graphql errors throw graphql_error with the list', async () => {
    const { client } = setup([json({ data: null, errors: [{ type: 'STALE_DATA', message: 'x' }] })]);
    const err = await fail(client.graphql('mutation { m }'));
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe('graphql_error');
    expect(err.graphqlErrors[0].type).toBe('STALE_DATA');
  });

  it('graphql FORBIDDEN errors throw AuthError forbidden', async () => {
    const { client } = setup([
      json({
        data: { createCommitOnBranch: null },
        errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible' }],
      }),
    ]);
    const err = await fail(client.graphql('mutation { m }'));
    expect(err).toBeInstanceOf(AuthError);
    expect(err.code).toBe('forbidden');
    expect((err as unknown as Error).message).toBe('Resource not accessible');
  });

  it('retries graphql RATE_LIMITED errors', async () => {
    const { client, sleep } = setup([
      json({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'limited' }] }),
      json({ data: { ok: 1 } }),
    ]);
    await expect(client.graphql('query { a }')).resolves.toEqual({ ok: 1 });
    expect(sleep).toHaveBeenCalledWith(60_000);
  });

  it('writes run one at a time', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { client, fetchMock } = setup(
      [async () => (await gate, json({ n: 1 })), json({ n: 2 })].map((x) => x as never),
    );
    const p1 = client.rest('POST', '/a');
    const p2 = client.rest('POST', '/b');
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('the 81st write in a minute waits', async () => {
    const { client, sleep } = setup([json({})]);
    for (let i = 0; i < 80; i++) await client.rest('POST', '/w');
    expect(sleep).not.toHaveBeenCalled();
    await client.rest('POST', '/w');
    expect(sleep).toHaveBeenCalledTimes(1);
    expect((sleep.mock.calls[0] as unknown as [number])[0]).toBeCloseTo(60_000, -2);
  });

  it('reads run at most 6 at a time', async () => {
    let active = 0;
    let max = 0;
    const fetchMock = vi.fn(async () => {
      active++;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return json({});
    });
    const client = createGitHubClient({ token: 't', fetch: fetchMock as unknown as typeof fetch });
    await Promise.all(Array.from({ length: 12 }, () => client.rest('GET', '/x')));
    expect(max).toBe(6);
  });

  it('network failure → network_error', async () => {
    const client = createGitHubClient({
      token: 't',
      fetch: (async () => {
        throw new TypeError('Failed to fetch');
      }) as unknown as typeof fetch,
    });
    const err = await fail(client.rest('GET', '/x'));
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe('network_error');
  });

  it('a body dropped mid-read → network_error', async () => {
    const dropped = {
      status: 200,
      headers: new Headers(),
      arrayBuffer: async () => {
        throw new TypeError('network error');
      },
    } as unknown as Response;
    const client = createGitHubClient({ token: 't', fetch: (async () => dropped) as unknown as typeof fetch });
    const err = await fail(client.rest('GET', '/x'));
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.code).toBe('network_error');
  });

  it('raw returns bytes, 204 returns undefined, body is JSON-encoded, fresh sets no-cache', async () => {
    const bytes = new Uint8Array([0, 255, 10]);
    const { client, fetchMock } = setup([new Response(bytes, { status: 200 }), new Response(null, { status: 204 })]);
    const out = await client.rest<Uint8Array>('GET', '/b', {
      raw: true,
      accept: 'application/vnd.github.raw+json',
      fresh: true,
    });
    expect(Array.from(out)).toEqual([0, 255, 10]);
    const init0 = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init0.cache).toBe('no-cache');
    expect((init0.headers as Record<string, string>).Accept).toBe('application/vnd.github.raw+json');
    await expect(client.rest('DELETE', '/d', { body: { a: 1 } })).resolves.toBeUndefined();
    const init1 = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(init1.body).toBe('{"a":1}');
    expect((init1.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('encodeRef encodes segments and keeps slashes', () => {
    expect(encodeRef('editlet/a b')).toBe('editlet/a%20b');
  });
});
