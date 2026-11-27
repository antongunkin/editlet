import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth, type Auth } from './auth';
import { errorText } from './errors';
import {
  LEGACY_SESSION_KEY,
  readSession,
  SESSION_KEY,
  tokenSession,
  writeSession,
  type StoredSession,
} from './session';
import { activeBranchKey } from './workspace';

import { AuthError, refresh, startLogin, type AuthSession } from '../../../auth/client';
import { GitHubError } from '../../../github';
import { withEditletRoute } from '../../../loader/protocol';
import { IssuesError } from '../data/queries';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { createTestQueryClient, findCta, HOME_LOADED, rowText, saveReview, setField } from '../test/render';

vi.mock('../../../auth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/client')>();
  return { ...actual, refresh: vi.fn(), startLogin: vi.fn() };
});

const refreshMock = vi.mocked(refresh);
const loginMock = vi.mocked(startLogin);
const AUTH_URL = 'https://auth.test/api';
const MINUTE = 60_000;

/** What GitHub hands out on sign-in or refresh. */
function grant(accessToken: string, refreshToken: string | null, over: Partial<AuthSession> = {}): AuthSession {
  return {
    accessToken,
    tokenType: 'bearer',
    expiresAt: Date.now() + 60 * MINUTE,
    refreshToken,
    refreshTokenExpiresAt: null,
    ...over,
  };
}

/** A stored OAuth session (as after a reload: no refresh token in this page). */
function storedOauth(over: Partial<StoredSession> = {}): StoredSession {
  return {
    ...grant('gho_old', null),
    method: 'oauth',
    lastActiveAt: Date.now(),
    ...over,
  };
}

/** Renders an AuthProvider over `sessionStorage` and hands back the latest `Auth` value. */
function renderAuth(props: { authUrl?: string; fetch?: typeof fetch; sessionMinutes?: number } = {}) {
  const current: { auth: Auth | null } = { auth: null };
  function Probe() {
    const auth = useAuth();
    current.auth = auth;
    return (
      <>
        <output aria-label="session">{auth.session ? auth.session.accessToken : 'none'}</output>
        <output aria-label="notice">{auth.notice ?? ''}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={createTestQueryClient()}>
      <AuthProvider storage={window.sessionStorage} {...props}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return () => current.auth!;
}

/** Signs in through the (mocked) GitHub popup. */
async function signInOauth(auth: () => Auth, session: AuthSession) {
  loginMock.mockResolvedValueOnce(session);
  await act(() => auth().signIn(AUTH_URL));
}

const sessionText = () => screen.getByLabelText('session').textContent;
const noticeText = () => screen.getByLabelText('notice').textContent;
const stored = () => readSession(window.sessionStorage);
const ok = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  refreshMock.mockReset();
  loginMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('AuthProvider', () => {
  it('starts from the session stored in sessionStorage', () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderAuth();
    expect(sessionText()).toBe('pat_1');
  });

  it('removes the old localStorage session on mount', () => {
    expect(LEGACY_SESSION_KEY).toBe('octocms:session:v1'); // the key P8 actually wrote, before the rename
    window.localStorage.setItem(LEGACY_SESSION_KEY, JSON.stringify({ accessToken: 'x', refreshToken: 'ghr_x' }));
    window.localStorage.setItem('other', 'kept');
    renderAuth();
    expect(window.localStorage.getItem(LEGACY_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem('other')).toBe('kept');
    expect(sessionText()).toBe('none');
  });

  it('signInWithToken stores a token session; signOut clears it and keeps the notice', () => {
    const auth = renderAuth();
    act(() => auth().signInWithToken(' pat_3 '));
    expect(sessionText()).toBe('pat_3');
    expect(stored()?.method).toBe('token');
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();

    act(() => auth().signOut('Bye.'));
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Bye.');
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it('getToken returns a token session as is', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const auth = renderAuth();
    expect(await auth().getToken()).toBe('pat_1');
  });

  it('signIn stores the access token only; the refresh token stays in memory and rotates there', async () => {
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old', { expiresAt: Date.now() + MINUTE }));
    expect(sessionText()).toBe('gho_old');
    expect(stored()).toMatchObject({ accessToken: 'gho_old', method: 'oauth', refreshToken: null });
    expect(window.sessionStorage.getItem(SESSION_KEY)).not.toContain('ghr_');

    refreshMock.mockResolvedValueOnce(grant('gho_new', 'ghr_new', { expiresAt: Date.now() + MINUTE }));
    let tokens: string[] = [];
    await act(async () => {
      tokens = await Promise.all([auth().getToken(), auth().getToken()]);
    });
    expect(tokens).toEqual(['gho_new', 'gho_new']);
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledWith({ workerUrl: AUTH_URL, refreshToken: 'ghr_old' });
    expect(stored()).toMatchObject({ accessToken: 'gho_new', refreshToken: null });
    expect(window.sessionStorage.getItem(SESSION_KEY)).not.toContain('ghr_');
    expect(sessionText()).toBe('gho_new');

    // The next refresh uses the rotated refresh token from memory.
    refreshMock.mockResolvedValueOnce(grant('gho_3', 'ghr_3'));
    await act(async () => {
      expect(await auth().getToken()).toBe('gho_3');
    });
    expect(refreshMock).toHaveBeenLastCalledWith({ workerUrl: AUTH_URL, refreshToken: 'ghr_new' });
  });

  it('a refused refresh signs out with the expired notice', async () => {
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old', { expiresAt: Date.now() + MINUTE }));
    refreshMock.mockRejectedValue(new AuthError('bad_refresh_token'));

    await act(async () => {
      await expect(auth().getToken()).rejects.toMatchObject({ code: 'unauthorized' });
    });
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your GitHub session expired. Sign in again.');
    expect(stored()).toBeNull();
  });

  it('a refresh that cannot reach the handler keeps the session and fails with a GitHub network error', async () => {
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old', { expiresAt: Date.now() + MINUTE }));
    const before = stored();

    for (const code of ['network_error', 'token_request_failed', 'server_misconfigured']) {
      refreshMock.mockRejectedValueOnce(new AuthError(code));
      let error: unknown;
      await act(async () => {
        error = await auth()
          .getToken()
          .catch((e: unknown) => e);
      });
      expect(error).toBeInstanceOf(GitHubError);
      expect(errorText(error)).toBe("Can't reach GitHub");
      expect(sessionText()).toBe('gho_old');
      expect(noticeText()).toBe('');
      expect(stored()).toEqual(before);
    }
    // The refresh token is still there for the next try.
    refreshMock.mockResolvedValueOnce(grant('gho_new', 'ghr_new'));
    await act(async () => {
      expect(await auth().getToken()).toBe('gho_new');
    });
    expect(refreshMock).toHaveBeenLastCalledWith({ workerUrl: AUTH_URL, refreshToken: 'ghr_old' });
  });

  it('a sign-out while a refresh is in flight stays signed out', async () => {
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old', { expiresAt: Date.now() + MINUTE }));
    let finish!: (s: AuthSession) => void;
    refreshMock.mockImplementation(() => new Promise((resolve) => (finish = resolve)));

    let pending!: Promise<string>;
    act(() => {
      pending = auth().getToken();
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    act(() => auth().signOut());
    await act(async () => {
      finish(grant('gho_new', 'ghr_new'));
      await pending.catch(() => undefined);
    });
    expect(stored()).toBeNull();
    expect(sessionText()).toBe('none');
  });

  it('sign out forgets the refresh token', async () => {
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old'));
    act(() => auth().signOut());
    // Signed in again without a refresh token: an expired access token can't be refreshed with the old one.
    await signInOauth(auth, grant('gho_2', null, { expiresAt: Date.now() - 1 }));
    await act(async () => {
      await expect(auth().getToken()).rejects.toMatchObject({ code: 'unauthorized' });
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(noticeText()).toBe('Your GitHub session expired. Sign in again.');
  });

  it('after a reload (no refresh token in memory) the stored access token is used until it expires', async () => {
    writeSession(window.sessionStorage, storedOauth({ expiresAt: Date.now() + MINUTE }));
    const auth = renderAuth({ authUrl: AUTH_URL });
    expect(await auth().getToken()).toBe('gho_old');
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('after a reload an expired access token signs out with the expired notice', async () => {
    writeSession(window.sessionStorage, storedOauth({ expiresAt: Date.now() - 1 }));
    const auth = renderAuth({ authUrl: AUTH_URL });
    await act(async () => {
      await expect(auth().getToken()).rejects.toMatchObject({ code: 'unauthorized' });
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your GitHub session expired. Sign in again.');
    expect(stored()).toBeNull();
  });

  it('after a reload a 401 signs out without a refresh', async () => {
    writeSession(window.sessionStorage, storedOauth());
    const base = vi.fn(async () => new Response('{}', { status: 401 }));
    const auth = renderAuth({ authUrl: AUTH_URL, fetch: base as unknown as typeof fetch });
    await act(async () => {
      expect((await auth().fetch('https://api.github.com/user')).status).toBe(401);
    });
    expect(refreshMock).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(1);
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your GitHub session expired. Sign in again.');
  });

  it('fetch: a 401 with a token session signs out with the expired notice', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const base = vi.fn(async () => new Response('{}', { status: 401 }));
    const auth = renderAuth({ fetch: base as unknown as typeof fetch });

    let status = 0;
    await act(async () => {
      status = (await auth().fetch('https://api.github.com/user')).status;
    });
    expect(status).toBe(401);
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your GitHub session expired. Sign in again.');
  });

  it('fetch: a 401 with an oauth session is retried after a forced refresh', async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      return new Response('{}', { status: auth === 'Bearer gho_new' ? 200 : 401 });
    });
    const auth = renderAuth({ authUrl: AUTH_URL, fetch: base as unknown as typeof fetch });
    await signInOauth(auth, grant('gho_old', 'ghr_old'));
    refreshMock.mockResolvedValue(grant('gho_new', 'ghr_new'));

    let status = 0;
    await act(async () => {
      const res = await auth().fetch('https://api.github.com/user', { headers: { Authorization: 'Bearer gho_old' } });
      status = res.status;
    });
    expect(status).toBe(200);
    expect(sessionText()).toBe('gho_new');
  });
});

describe('idle timeout', () => {
  it('typing and clicking keep the session alive past 60 minutes; 60 idle minutes end it', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const start = Date.now();
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderAuth();

    for (const input of [
      () => fireEvent.keyDown(document.body, { key: 'a' }),
      () => fireEvent.pointerDown(document.body),
    ]) {
      act(() => vi.advanceTimersByTime(40 * MINUTE));
      input();
      expect(sessionText()).toBe('pat_1');
    }
    act(() => vi.advanceTimersByTime(40 * MINUTE));
    fireEvent.keyDown(document.body, { key: 'b' });
    expect(Date.now() - start).toBe(120 * MINUTE);
    expect(sessionText()).toBe('pat_1');
    expect(stored()?.lastActiveAt).toBe(start + 120 * MINUTE);

    act(() => vi.advanceTimersByTime(59 * MINUTE));
    expect(sessionText()).toBe('pat_1');
    act(() => vi.advanceTimersByTime(2 * MINUTE));
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your session ended after 60 minutes without activity. Sign in again.');
    expect(stored()).toBeNull();
  });

  it('GitHub requests (a deployment poll, a refetch) do not extend the session', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const start = Date.now();
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const auth = renderAuth({ fetch: ok });

    for (let minute = 10; minute <= 50; minute += 10) {
      act(() => vi.advanceTimersByTime(10 * MINUTE));
      await act(async () => {
        expect((await auth().fetch('https://api.github.com/repos/o/r/deployments')).status).toBe(200);
      });
    }
    expect(stored()?.lastActiveAt).toBe(start);
    act(() => vi.advanceTimersByTime(11 * MINUTE));
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your session ended after 60 minutes without activity. Sign in again.');
  });

  it('a token refresh does not extend the session', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const start = Date.now();
    const auth = renderAuth({ authUrl: AUTH_URL });
    await signInOauth(auth, grant('gho_old', 'ghr_old', { expiresAt: Date.now() + 40 * MINUTE }));
    act(() => vi.advanceTimersByTime(40 * MINUTE));
    refreshMock.mockResolvedValueOnce(grant('gho_new', 'ghr_new'));
    await act(async () => {
      expect(await auth().getToken()).toBe('gho_new');
    });
    expect(stored()).toMatchObject({ accessToken: 'gho_new', lastActiveAt: start });
    act(() => vi.advanceTimersByTime(21 * MINUTE));
    expect(sessionText()).toBe('none');
  });

  it('input counts in the capture phase, also when a child stops propagation; the wheel counts too', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderAuth();
    const child = document.createElement('input');
    document.body.append(child);
    child.addEventListener('keydown', (event) => event.stopPropagation());
    act(() => vi.advanceTimersByTime(50 * MINUTE));
    fireEvent.keyDown(child, { key: 'a' });
    act(() => vi.advanceTimersByTime(50 * MINUTE));
    fireEvent.wheel(document.body);
    act(() => vi.advanceTimersByTime(50 * MINUTE));
    expect(sessionText()).toBe('pat_1');
    child.remove();
  });

  it('pagehide and a hidden tab write the activity time the throttle held back', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const start = Date.now();
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderAuth();
    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(stored()?.lastActiveAt).toBe(start);
    fireEvent(window, new Event('pagehide'));
    expect(stored()?.lastActiveAt).toBe(start + 20_000);

    act(() => vi.advanceTimersByTime(20_000));
    fireEvent.keyDown(document.body, { key: 'b' });
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    fireEvent(document, new Event('visibilitychange'));
    expect(stored()?.lastActiveAt).toBe(start + 20_000);
    visibility.mockReturnValue('hidden');
    fireEvent(document, new Event('visibilitychange'));
    expect(stored()?.lastActiveAt).toBe(start + 40_000);
    visibility.mockRestore();
  });

  it('a lapse keeps the query cache and says so; Sign out clears it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const auth = renderAuth();
    expect(auth().lapsed).toBe(false);
    act(() => vi.advanceTimersByTime(61 * MINUTE));
    expect(auth().session).toBeNull();
    expect(auth().lapsed).toBe(true);
    act(() => auth().signInWithToken('pat_2'));
    expect(auth().lapsed).toBe(false);
    act(() => auth().signOut());
    expect(auth().lapsed).toBe(false);
  });

  it('onForget: a sign-out and an account switch call the listener, a lapse does not, an unsubscribed one stays out', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const listener = vi.fn();
    const other = vi.fn();
    const auth = renderAuth();
    let unsubscribe = () => {};
    act(() => {
      auth().onForget(listener);
      unsubscribe = auth().onForget(other);
    });
    act(() => auth().signInWithToken('pat_3'));
    act(() => vi.advanceTimersByTime(61 * MINUTE));
    expect(auth().lapsed).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    act(() => auth().signInWithToken('pat_4'));
    act(() => auth().signOut());
    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);

    unsubscribe();
    act(() => auth().forgetContent());
    expect(listener).toHaveBeenCalledTimes(2);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('writes the activity time at most once a minute', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const start = Date.now();
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderAuth();
    act(() => vi.advanceTimersByTime(30_000));
    fireEvent.keyDown(document.body, { key: 'a' });
    expect(stored()?.lastActiveAt).toBe(start);
    act(() => vi.advanceTimersByTime(31_000));
    fireEvent.pointerDown(document.body);
    expect(stored()?.lastActiveAt).toBe(start + 61_000);
  });

  it('sign-in starts the clock', async () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 11, 9, 0) });
    const auth = renderAuth();
    act(() => vi.advanceTimersByTime(30 * MINUTE));
    act(() => auth().signInWithToken('pat_1'));
    expect(stored()?.lastActiveAt).toBe(Date.now());
    act(() => vi.advanceTimersByTime(59 * MINUTE));
    expect(sessionText()).toBe('pat_1');
  });

  it('getToken checks it before a request, with a custom sessionMinutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 11, 9, 0) });
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const auth = renderAuth({ sessionMinutes: 5 });
    vi.setSystemTime(Date.now() + 4 * MINUTE);
    expect(await auth().getToken()).toBe('pat_1');
    vi.setSystemTime(Date.now() + 5 * MINUTE + 1);
    await act(async () => {
      await expect(auth().getToken()).rejects.toMatchObject({ code: 'unauthorized' });
    });
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your session ended after 5 minutes without activity. Sign in again.');
  });

  it('a stored session idle for too long is over on load', () => {
    writeSession(window.sessionStorage, tokenSession('pat_1', Date.now() - 61 * MINUTE));
    renderAuth();
    expect(sessionText()).toBe('none');
    expect(noticeText()).toBe('Your session ended after 60 minutes without activity. Sign in again.');
    expect(stored()).toBeNull();
  });
});

describe('App in github mode', () => {
  it('without a github config shows the not-configured screen', async () => {
    renderLiveApp(siteFetch(null));
    expect(await screen.findByText('Editing on the live site is not set up.', { exact: false })).toBeDefined();
    expect(screen.getByText('docs/admin/production.md')).toBeDefined();
  });

  it('a config without github is not configured either', async () => {
    renderLiveApp(siteFetch({ authUrl: AUTH_URL }));
    expect(await screen.findByText('Editing on the live site is not set up.', { exact: false })).toBeDefined();
  });

  it('without a session shows the sign-in screen', async () => {
    renderLiveApp(siteFetch(LIVE_CONFIG));
    expect(await screen.findByLabelText('Personal access token')).toBeDefined();
  });

  it('a signed-in user without push access gets the no-access screen and can sign out', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, createAdminFakeGitHub({ push: false })));

    expect(await screen.findByText("Your GitHub account can't write to o/r", { exact: false })).toBeDefined();
    act(() => screen.getByRole('button', { name: 'Sign out' }).click());
    expect(await screen.findByLabelText('Personal access token')).toBeDefined();
    expect(readSession(window.sessionStorage)).toBeNull();
  });

  it('a repo GitHub does not show gets the cannot-access screen', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    const github = createAdminFakeGitHub();
    const hidden = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (href === 'https://api.github.com/repos/o/r') return Response.json({ message: 'Not Found' }, { status: 404 });
      return github.fetch(input, init);
    }) as typeof fetch;
    renderLiveApp(siteFetch(LIVE_CONFIG, { ...github, fetch: hidden }));

    expect(await screen.findByRole('heading', { name: "Can't open o/r" })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeDefined();
  });

  it('a freshly pasted token that GitHub refuses says so instead of "expired"', async () => {
    renderLiveApp(siteFetch(LIVE_CONFIG));
    const input = (await screen.findByLabelText('Personal access token')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use token' }));
    expect(await screen.findByText("GitHub didn't accept this token.")).toBeDefined();
    expect(screen.queryByText('Your GitHub session expired. Sign in again.')).toBeNull();
    expect(readSession(window.sessionStorage)).toBeNull();
  });

  it('a bad stored token signs out to the sign-in screen with the expired notice', async () => {
    writeSession(window.sessionStorage, tokenSession('bad'));
    renderLiveApp(siteFetch(LIVE_CONFIG));
    expect(await screen.findByText('Your GitHub session expired. Sign in again.')).toBeDefined();
    expect(readSession(window.sessionStorage)).toBeNull();
  });

  it('a stored session idle for longer than config sessionMinutes opens the sign-in screen with the notice', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1', Date.now() - 6 * MINUTE));
    renderLiveApp(siteFetch({ ...LIVE_CONFIG, sessionMinutes: 5 }));
    expect(
      await screen.findByText('Your session ended after 5 minutes without activity. Sign in again.'),
    ).toBeDefined();
    expect(screen.getByLabelText('Personal access token')).toBeDefined();
    expect(readSession(window.sessionStorage)).toBeNull();
  });

  it('the default idle timeout is 60 minutes', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1', Date.now() - 61 * MINUTE));
    renderLiveApp(siteFetch(LIVE_CONFIG));
    expect(
      await screen.findByText('Your session ended after 60 minutes without activity. Sign in again.'),
    ).toBeDefined();
  });

  it('a session within config sessionMinutes stays', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1', Date.now() - 50 * MINUTE));
    renderLiveApp(siteFetch({ ...LIVE_CONFIG, sessionMinutes: 90 }));
    expect(await screen.findByRole('main')).toBeDefined();
    expect(screen.queryByLabelText('Personal access token')).toBeNull();
  });

  it('a user with push access gets the shell over main', async () => {
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, createAdminFakeGitHub({ push: true })));

    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('link', { name: HOME_LOADED })).toBeDefined();
  });
});

/** The text of `path` at the head of `branch` on the fake. */
function fileAt(fake: ReturnType<typeof createAdminFakeGitHub>, branch: string, path: string): string {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path)!;
  return new TextDecoder().decode(fake.state.blobs.get(sha));
}

const ENTRY = 'cms/content/post/hello-world.md';

/** post/hello-world open on `editlet/a` with an unsaved title, as `pat_1`. `/user` answers `someone` for `pat_other`. */
async function dirtyEntry() {
  const github = createAdminFakeGitHub();
  github.state.refs.set('editlet/a', github.state.refs.get('main')!);
  const control = { revoked: false };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const auth = new Headers(init?.headers).get('authorization');
    if (control.revoked && auth === 'Bearer pat_1')
      return Response.json({ message: 'Bad credentials' }, { status: 401 });
    if (href === 'https://api.github.com/user' && auth === 'Bearer pat_other') {
      return Response.json({ login: 'someone', avatar_url: 'https://avatars.test/someone.png' });
    }
    return github.fetch(input, init);
  }) as typeof globalThis.fetch;
  window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post/hello-world'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, { ...github, fetch }));
  const main = await screen.findByRole('main');
  await within(main).findByRole('button', { name: /^Title/ });
  await setField('Title', 'Unsaved edit');
  return { github, control, main, form: main.querySelector('[data-editlet="screen"]')! };
}

/** Pastes `token` into the sign-in dialog. */
function useToken(dialog: HTMLElement, token: string) {
  const open = within(dialog).queryByRole('button', { name: 'Use a personal access token' });
  if (open) fireEvent.click(open);
  fireEvent.change(within(dialog).getByLabelText('Personal access token'), { target: { value: token } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use token' }));
}

describe('a session that ends by itself keeps the open form', () => {
  it('idle: sign in again over the form, then Save commits the kept edit', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { github, form } = await dirtyEntry();

    act(() => vi.advanceTimersByTime(61 * MINUTE));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Sign in again' })).toBeDefined();
    expect(
      within(dialog).getByText('Your session ended after 60 minutes without activity. Sign in again.'),
    ).toBeDefined();
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(form.isConnected).toBe(true);
    expect(form.textContent).toContain('Unsaved edit');
    expect(readSession(window.sessionStorage)).toBeNull();

    useToken(dialog, 'pat_2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(form.isConnected).toBe(true);
    expect(form.textContent).toContain('Unsaved edit');

    fireEvent.click(await findCta(/^Save/));
    await saveReview();
    await waitFor(() => expect(fileAt(github, 'editlet/a', ENTRY)).toContain('title: Unsaved edit'));
    expect(fileAt(github, 'main', ENTRY)).toContain('title: Hello world');
  });

  it('a 401 lapses too; a different account then gets a fresh admin, not the old form', async () => {
    const { control, form } = await dirtyEntry();
    control.revoked = true;
    // Opening *Your changes* reads the branches and CODEOWNERS: the 401 may come before or after its Save.
    fireEvent.click(await findCta(/^Save/));

    const dialog = await screen.findByRole('dialog', { name: 'Sign in again' });
    expect(within(dialog).getByText('Your GitHub session expired. Sign in again.')).toBeDefined();
    expect(form.isConnected).toBe(true);

    useToken(dialog, 'pat_other');
    await waitFor(() => expect(form.isConnected).toBe(false));
    await within(await screen.findByRole('main')).findByRole('button', { name: /^Title/ });
    await waitFor(() => expect(rowText('Title')).toContain('Hello world'));
    expect(screen.queryByRole('dialog', { name: 'Sign in again' })).toBeNull();
  });

  it('a token GitHub refuses in the dialog asks again and keeps the form', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { form } = await dirtyEntry();
    act(() => vi.advanceTimersByTime(61 * MINUTE));
    useToken(await screen.findByRole('dialog'), 'bad');
    expect(await screen.findByText("GitHub didn't accept this token.")).toBeDefined();
    expect(screen.getByRole('dialog', { name: 'Sign in again' })).toBeDefined();
    expect(form.isConnected).toBe(true);
    expect(form.textContent).toContain('Unsaved edit');
  });

  it('Sign out from the account menu still leaves for the sign-in screen', async () => {
    const { form } = await dirtyEntry();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // The account sheet is Home's: leave the entry, the collection and All content first.
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    fireEvent.click(
      await screen.findByRole('heading', { name: /^Posts?$/ }).then(() => screen.getByRole('link', { name: 'Back' })),
    );
    fireEvent.click(
      await screen
        .findByRole('heading', { name: 'All content' })
        .then(() => screen.getByRole('link', { name: 'Back' })),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to edit' })).toBeDefined();
    expect(form.isConnected).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a refresh that cannot reach the auth handler', () => {
  it('keeps the session and the open, edited entry, and the save says GitHub is unreachable', async () => {
    const github = createAdminFakeGitHub();
    const mainHead = github.state.refs.get('main')!;
    github.state.refs.set('editlet/a', mainHead);
    // Once `expired` is set GitHub answers 401 to the old token: the admin forces a refresh, which fails offline.
    let expired = false;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (expired && auth === 'Bearer gho_old') return Response.json({ message: 'Bad credentials' }, { status: 401 });
      return github.fetch(input, init);
    }) as typeof globalThis.fetch;
    refreshMock.mockRejectedValue(new AuthError('network_error'));

    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');
    window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post/hello-world'));
    // Signed in in this page, so the refresh token is in memory.
    loginMock.mockResolvedValue(grant('gho_old', 'ghr_old'));
    renderLiveApp(siteFetch({ ...LIVE_CONFIG, authUrl: AUTH_URL }, { ...github, fetch }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }));

    const main = await screen.findByRole('main');
    await within(main).findByRole('button', { name: /^Title/ });
    const before = readSession(window.sessionStorage);
    expect(before).toMatchObject({ accessToken: 'gho_old', method: 'oauth' });
    await setField('Title', 'Unsaved edit');
    const form = main.querySelector('[data-editlet="screen"]')!;
    expired = true;
    fireEvent.click(await findCta(/^Save/));
    await saveReview();

    expect(await within(main).findByText("Can't reach GitHub")).toBeDefined();
    expect(refreshMock).toHaveBeenCalledWith({ workerUrl: AUTH_URL, refreshToken: 'ghr_old' });
    expect(form.isConnected).toBe(true);
    expect(rowText('Title')).toContain('Unsaved edit');
    expect(screen.queryByLabelText('Personal access token')).toBeNull();
    expect(readSession(window.sessionStorage)).toEqual(before);
    expect(github.state.refs.get('editlet/a')).toBe(mainHead);
  });
});

describe('errorText', () => {
  it('maps auth, rate limit and network failures, else the message', () => {
    expect(errorText(new AuthError('forbidden'), { repo: 'o/r' })).toBe("Your GitHub account can't write to o/r");
    expect(errorText(new AuthError('unauthorized'))).toBe('Your GitHub session expired. Sign in again.');
    const at = new Date(2026, 10, 11, 9, 5).getTime();
    expect(errorText(new GitHubError('rate_limited', 'limited', { retryAt: at }))).toBe(
      'GitHub rate limit reached. Try again at 09:05',
    );
    expect(errorText(new GitHubError('network_error', 'fetch failed'))).toBe("Can't reach GitHub");
    expect(errorText(new IssuesError([{ path: 'title', message: 'Required' }]))).toBe('title: Required');
    expect(errorText(new GitHubError('not_found', 'Not Found'))).toBe('Not Found');
    expect(errorText('plain')).toBe('plain');
  });
});
