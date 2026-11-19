import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from './auth';
import { readSession, SESSION_KEY } from './session';
import { SignIn } from './SignIn';

import { AuthError, startLogin, type AuthSession } from '../../../auth/client';
import { createTestQueryClient } from '../test/render';
import { BridgeProvider } from '../useRoute';

vi.mock('../../../auth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/client')>();
  return { ...actual, startLogin: vi.fn() };
});

const login = vi.mocked(startLogin);
const AUTH_URL = 'https://auth.test/api';

const oauthSession: AuthSession = {
  accessToken: 'gho_1',
  tokenType: 'bearer',
  expiresAt: Date.now() + 3_600_000,
  refreshToken: 'ghr_1',
  refreshTokenExpiresAt: null,
};

function SessionProbe() {
  const { session } = useAuth();
  return <output aria-label="session">{session ? session.method : 'none'}</output>;
}

function renderSignIn({ authUrl, win }: { authUrl?: string; win?: Window } = {}) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <BridgeProvider win={win}>
        <AuthProvider authUrl={authUrl} storage={window.sessionStorage}>
          <SessionProbe />
          <SignIn authUrl={authUrl} repo="o/r" />
        </AuthProvider>
      </BridgeProvider>
    </QueryClientProvider>,
  );
}

/** A `startLogin` result the test settles by hand. */
function deferred() {
  let resolve!: (s: AuthSession) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<AuthSession>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const github = () => screen.getByRole('button', { name: 'Sign in with GitHub' });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  login.mockReset();
});

describe('SignIn', () => {
  it('calls startLogin synchronously in the click and stores the session', async () => {
    const pending = deferred();
    login.mockReturnValue(pending.promise);
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith({ workerUrl: AUTH_URL });
    expect(screen.getByText('Finish signing in in the GitHub window…')).toBeDefined();

    await act(async () => pending.resolve(oauthSession));
    await waitFor(() => expect(screen.getByLabelText('session').textContent).toBe('oauth'));
    expect(readSession(window.sessionStorage)).toEqual({
      ...oauthSession,
      refreshToken: null,
      method: 'oauth',
      lastActiveAt: expect.any(Number),
    });
    expect(window.sessionStorage.getItem(SESSION_KEY)).not.toContain('ghr_1');
  });

  it('resolves a path-only authUrl against the page origin', () => {
    login.mockReturnValue(new Promise(() => {}));
    renderSignIn({ authUrl: '/api/auth' });
    fireEvent.click(github());
    expect(login).toHaveBeenCalledWith({ workerUrl: `${window.location.origin}/api/auth` });
  });

  it('Cancel returns to idle and ignores the pending result', async () => {
    const pending = deferred();
    login.mockReturnValue(pending.promise);
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(github()).toBeDefined();

    await act(async () => pending.resolve(oauthSession));
    expect(screen.getByLabelText('session').textContent).toBe('none');
    expect(readSession(window.sessionStorage)).toBeNull();
  });

  it('popup_blocked shows the blocked copy and Try again starts a new login', async () => {
    login.mockRejectedValueOnce(new AuthError('popup_blocked'));
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    expect(await screen.findByText('Your browser blocked the sign-in window.')).toBeDefined();

    login.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('popup_closed goes back to idle without an error', async () => {
    login.mockRejectedValueOnce(new AuthError('popup_closed'));
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    await waitFor(() => expect(github()).toBeDefined());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('access_denied says the sign-in was cancelled', async () => {
    login.mockRejectedValueOnce(new AuthError('access_denied'));
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    expect(await screen.findByText('GitHub sign-in was cancelled.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('origin_not_allowed names the origin to allow, with no retry', async () => {
    login.mockRejectedValueOnce(new AuthError('origin_not_allowed'));
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    const alert = await screen.findByRole('alert');
    expect(window.location.origin).toContain('http://localhost');
    expect(alert.textContent).toBe(
      `This site isn't set up for sign-in yet. Add ${window.location.origin} to ALLOWED_ORIGINS of the auth handler.`,
    );
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('other codes show the code with Try again', async () => {
    login.mockRejectedValueOnce(new AuthError('timeout'));
    renderSignIn({ authUrl: AUTH_URL });

    fireEvent.click(github());
    expect(await screen.findByText('Sign-in failed (timeout).')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDefined();
  });

  it('with an authUrl the token form opens from "Use a personal access token"', () => {
    renderSignIn({ authUrl: AUTH_URL });
    expect(screen.queryByLabelText('Personal access token')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a personal access token' }));
    expect(screen.getByLabelText('Personal access token')).toBeDefined();
  });

  it('after origin_not_allowed the token form does not offer the popup again', async () => {
    login.mockRejectedValue(new AuthError('origin_not_allowed'));
    renderSignIn({ authUrl: AUTH_URL });
    fireEvent.click(github());
    expect(await screen.findByText(/isn't set up for sign-in yet/)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Use a personal access token' }));
    expect(screen.getByLabelText('Personal access token')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub instead' })).toBeNull();
  });

  it('without an authUrl only the token form is offered and it stores a token session', async () => {
    renderSignIn();
    expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();

    const input = screen.getByLabelText('Personal access token') as HTMLInputElement;
    expect(input.type).toBe('password');
    const link = screen.getByRole('link', { name: 'Create a token' });
    expect(link.getAttribute('href')).toBe('https://github.com/settings/personal-access-tokens/new');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(
      screen.getByText('Needs Contents and Pull requests (read and write), Deployments (read).', { exact: false }),
    ).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Sign in to edit' })).toBeDefined();

    const use = screen.getByRole('button', { name: 'Use token' }) as HTMLButtonElement;
    expect(use.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '  github_pat_1  ' } });
    fireEvent.click(use);

    await waitFor(() => expect(screen.getByLabelText('session').textContent).toBe('token'));
    expect(readSession(window.sessionStorage)).toMatchObject({ accessToken: 'github_pat_1', method: 'token' });
    expect(login).not.toHaveBeenCalled();
  });
});
