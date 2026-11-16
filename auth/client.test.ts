import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthError, needsRefresh, refresh, startLogin, type AuthSession } from './client.ts';

const workerUrl = 'https://auth.example';
const token = {
  access_token: 'ghu_x',
  token_type: 'bearer',
  scope: '',
  expires_in: 28800,
  refresh_token: 'ghr_y',
  refresh_token_expires_in: 15897600,
};

interface FakePopup {
  closed: boolean;
  close: ReturnType<typeof vi.fn>;
}

function deliver(data: unknown, popup: object, origin = workerUrl): void {
  const event = new MessageEvent('message', { data, origin });
  Object.defineProperty(event, 'source', { value: popup });
  window.dispatchEvent(event);
}

function successMessage(t: Record<string, unknown> = token) {
  return { source: 'editlet-auth', ok: true, token: t };
}

describe('startLogin', () => {
  let popup: FakePopup;
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    popup = { closed: false, close: vi.fn() };
    openSpy = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens the popup synchronously with the origin param', () => {
    const promise = startLogin({ workerUrl });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      `https://auth.example/auth?origin=${encodeURIComponent(location.origin)}`,
      'editlet-auth',
      'popup,width=600,height=720',
    );
    deliver(successMessage(), popup);
    return promise;
  });

  it('tolerates a trailing slash on workerUrl', async () => {
    const promise = startLogin({ workerUrl: 'https://auth.example/' });
    expect(openSpy.mock.calls[0]![0]).toBe(`https://auth.example/auth?origin=${encodeURIComponent(location.origin)}`);
    deliver(successMessage(), popup);
    await promise;
  });

  it('keeps a path on workerUrl (handler mounted under a route)', async () => {
    const promise = startLogin({ workerUrl: 'https://auth.example/api/editlet/oauth/' });
    expect(openSpy.mock.calls[0]![0]).toBe(
      `https://auth.example/api/editlet/oauth/auth?origin=${encodeURIComponent(location.origin)}`,
    );
    deliver(successMessage(), popup);
    await promise;
  });

  it('rejects with invalid_worker_url instead of throwing synchronously', async () => {
    let promise: Promise<AuthSession> | undefined;
    expect(() => (promise = startLogin({ workerUrl: 'not a url' }))).not.toThrow();
    await expect(promise).rejects.toMatchObject({ name: 'AuthError', code: 'invalid_worker_url' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['missing token', { source: 'editlet-auth', ok: true }],
    ['token without access_token', { source: 'editlet-auth', ok: true, token: { token_type: 'bearer' } }],
  ])('rejects a malformed ok message (%s) with token_request_failed', async (_name, message) => {
    const promise = startLogin({ workerUrl });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'token_request_failed' });
    deliver(message, popup);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with popup_blocked when window.open returns null', async () => {
    openSpy.mockReturnValue(null);
    await expect(startLogin({ workerUrl })).rejects.toMatchObject({ name: 'AuthError', code: 'popup_blocked' });
  });

  it('resolves with a session computed from relative expiries', async () => {
    const promise = startLogin({ workerUrl });
    deliver(successMessage(), popup);
    await expect(promise).resolves.toEqual({
      accessToken: 'ghu_x',
      tokenType: 'bearer',
      expiresAt: 1_000_000 + 28_800_000,
      refreshToken: 'ghr_y',
      refreshTokenExpiresAt: 1_000_000 + 15_897_600_000,
    });
  });

  it('uses nulls when the token has no expiry fields', async () => {
    const promise = startLogin({ workerUrl });
    deliver(successMessage({ access_token: 'ghu_x', token_type: 'bearer', scope: '' }), popup);
    await expect(promise).resolves.toEqual({
      accessToken: 'ghu_x',
      tokenType: 'bearer',
      expiresAt: null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
    });
  });

  it('ignores untrusted messages and still resolves on a valid one', async () => {
    const promise = startLogin({ workerUrl });
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    deliver(successMessage(), popup, 'https://evil.example');
    deliver(successMessage(), {});
    deliver({ source: 'other', ok: true, token }, popup);
    deliver('editlet-auth', popup);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    deliver(successMessage(), popup);
    await expect(promise).resolves.toMatchObject({ accessToken: 'ghu_x' });
  });

  it('rejects with the worker error and description', async () => {
    const promise = startLogin({ workerUrl });
    deliver({ source: 'editlet-auth', ok: false, error: 'access_denied', description: 'User said no' }, popup);
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'access_denied', description: 'User said no', message: 'User said no' });
  });

  it('message defaults to the code without a description', async () => {
    const promise = startLogin({ workerUrl });
    deliver({ source: 'editlet-auth', ok: false, error: 'access_denied' }, popup);
    await expect(promise).rejects.toMatchObject({ code: 'access_denied', message: 'access_denied' });
  });

  it('rejects with popup_closed when the popup is closed', async () => {
    const promise = startLogin({ workerUrl });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'popup_closed' });
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('rejects with timeout after 5 minutes by default', async () => {
    const promise = startLogin({ workerUrl });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await assertion;
  });

  it('closes the popup on timeout', async () => {
    const promise = startLogin({ workerUrl, timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(popup.close).toHaveBeenCalledTimes(1);
  });

  it('still times out when popup.close throws', async () => {
    popup.close.mockImplementation(() => {
      throw new Error('gone');
    });
    const promise = startLogin({ workerUrl, timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('honours timeoutMs', async () => {
    const promise = startLogin({ workerUrl, timeoutMs: 1000 });
    const assertion = expect(promise).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it('stays resolved when the popup closes right after success, and cleans up', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const promise = startLogin({ workerUrl });
    deliver(successMessage(), popup);
    popup.closed = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(promise).resolves.toMatchObject({ accessToken: 'ghu_x' });
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up timers and listener after a failure', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const promise = startLogin({ workerUrl });
    deliver({ source: 'editlet-auth', ok: false, error: 'access_denied' }, popup);
    await promise.catch(() => undefined);
    expect(removeSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('posts the refresh token and resolves a session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(token), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = await refresh({ workerUrl, refreshToken: 'ghr_y' });
    expect(fetchMock).toHaveBeenCalledWith('https://auth.example/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"refresh_token":"ghr_y"}',
    });
    expect(session.accessToken).toBe('ghu_x');
    expect(session.expiresAt).toBe(1_000_000 + 28_800_000);
  });

  it('maps error JSON to AuthError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'bad_refresh_token', error_description: 'expired' }), { status: 400 }),
        ),
    );
    await expect(refresh({ workerUrl, refreshToken: 'x' })).rejects.toMatchObject({
      code: 'bad_refresh_token',
      description: 'expired',
    });
  });

  it('posts under a path on workerUrl', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'ghu_x', token_type: 'bearer', scope: '' }));
    vi.stubGlobal('fetch', fetchMock);
    await refresh({ workerUrl: 'https://auth.example/api/editlet/oauth', refreshToken: 'ghr_y' });
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://auth.example/api/editlet/oauth/refresh');
  });

  it('rejects with invalid_worker_url for a bad workerUrl', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(refresh({ workerUrl: 'not a url', refreshToken: 'x' })).rejects.toMatchObject({
      code: 'invalid_worker_url',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a fetch rejection to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(refresh({ workerUrl, refreshToken: 'x' })).rejects.toMatchObject({ code: 'network_error' });
  });

  it('maps non-JSON responses to token_request_failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })));
    await expect(refresh({ workerUrl, refreshToken: 'x' })).rejects.toMatchObject({ code: 'token_request_failed' });
  });

  it('maps JSON without error or access_token to token_request_failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(refresh({ workerUrl, refreshToken: 'x' })).rejects.toMatchObject({ code: 'token_request_failed' });
  });
});

describe('needsRefresh', () => {
  const base: AuthSession = {
    accessToken: 'a',
    tokenType: 'bearer',
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
  };

  it('is false when the token never expires', () => {
    expect(needsRefresh(base, 9e12)).toBe(false);
  });

  it('applies a 5 minute skew', () => {
    const session = { ...base, expiresAt: 10_000_000 };
    expect(needsRefresh(session, 10_000_000 - 6 * 60_000)).toBe(false);
    expect(needsRefresh(session, 10_000_000 - 4 * 60_000)).toBe(true);
  });

  it('defaults now to Date.now()', () => {
    expect(needsRefresh({ ...base, expiresAt: Date.now() - 1 })).toBe(true);
  });
});
