import { describe, expect, it, vi } from 'vitest';

import { authFetch, isIdle, readSession, SESSION_KEY, tokenSession, writeSession, type StoredSession } from './session';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const HOUR = 3_600_000;
function session(over: Partial<StoredSession> = {}): StoredSession {
  return {
    accessToken: 'a1',
    tokenType: 'bearer',
    expiresAt: Date.now() + HOUR,
    refreshToken: 'r1',
    refreshTokenExpiresAt: Date.now() + 10 * HOUR,
    method: 'oauth',
    lastActiveAt: 1_000,
    ...over,
  };
}

describe('session storage', () => {
  it('stores the session under the v2 key without the refresh token', () => {
    const storage = memoryStorage();
    const s = session();
    writeSession(storage, s);
    expect(SESSION_KEY).toMatch(/:session:v2$/);
    expect(JSON.parse(storage.getItem(SESSION_KEY)!)).toEqual({
      accessToken: 'a1',
      tokenType: 'bearer',
      expiresAt: s.expiresAt,
      method: 'oauth',
      lastActiveAt: 1_000,
    });
    expect(storage.getItem(SESSION_KEY)).not.toContain('r1');
    expect(readSession(storage)).toEqual({ ...s, refreshToken: null, refreshTokenExpiresAt: null });
  });

  it('ignores a refresh token found in storage', () => {
    const storage = memoryStorage();
    storage.setItem(SESSION_KEY, JSON.stringify({ ...session(), refreshToken: 'r9' }));
    expect(readSession(storage)?.refreshToken).toBeNull();
  });

  it('clamps a lastActiveAt in the future to now', () => {
    const storage = memoryStorage();
    writeSession(storage, session({ lastActiveAt: 5_000 }));
    expect(readSession(storage, 2_000)?.lastActiveAt).toBe(2_000);
    expect(readSession(storage, 9_000)?.lastActiveAt).toBe(5_000);
  });

  it('returns null for corrupted or malformed JSON', () => {
    const storage = memoryStorage();
    storage.setItem(SESSION_KEY, '{nope');
    expect(readSession(storage)).toBeNull();
    storage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 5 }));
    expect(readSession(storage)).toBeNull();
    const { lastActiveAt: _, ...noActivity } = session();
    storage.setItem(SESSION_KEY, JSON.stringify(noActivity));
    expect(readSession(storage)).toBeNull();
  });

  it('builds a PAT session', () => {
    expect(tokenSession('ghp_x', 5)).toEqual({
      accessToken: 'ghp_x',
      tokenType: 'bearer',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      method: 'token',
      lastActiveAt: 5,
    });
  });

  it('isIdle: more than the given minutes since the last activity', () => {
    const s = session({ lastActiveAt: 0 });
    expect(isIdle(s, 60, 60 * 60_000)).toBe(false);
    expect(isIdle(s, 60, 60 * 60_000 + 1)).toBe(true);
    expect(isIdle(s, 5, 6 * 60_000)).toBe(true);
  });
});

describe('authFetch', () => {
  it('retries a 401 once with the refreshed token', async () => {
    const base = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('no', { status: 401 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const onUnauthorized = vi.fn();
    const f = authFetch(base, { onRefresh: async () => 'new', onUnauthorized });
    const res = await f('https://api.test/x', { headers: { Authorization: 'Bearer old' } });
    expect(res.status).toBe(200);
    expect(new Headers(base.mock.calls[1]![1]!.headers).get('Authorization')).toBe('Bearer new');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('calls onUnauthorized when there is no token to refresh to', async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 401 }));
    const onUnauthorized = vi.fn();
    const f = authFetch(base, { onRefresh: async () => null, onUnauthorized });
    const res = await f('https://api.test/x');
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('calls onUnauthorized after a second 401', async () => {
    const base = vi.fn<typeof fetch>().mockResolvedValue(new Response('no', { status: 401 }));
    const onUnauthorized = vi.fn();
    const f = authFetch(base, { onRefresh: async () => 'new', onUnauthorized });
    const res = await f('https://api.test/x');
    expect(res.status).toBe(401);
    expect(base).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
