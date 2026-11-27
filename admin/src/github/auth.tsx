import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { SESSION_EXPIRED, sessionIdleText, TOKEN_REJECTED } from './errors';
import {
  authFetch,
  clearSession,
  isIdle,
  LEGACY_SESSION_KEY,
  readSession,
  tokenSession,
  writeSession,
  type StoredSession,
} from './session';

import { AuthError, needsRefresh, refresh, startLogin, type AuthSession } from '../../../auth/client';
import { GitHubError } from '../../../github';
import { DEFAULT_SESSION_MINUTES } from '../../config';

/**
 * The GitHub sign-in of this tab: the access token in `sessionStorage`, the refresh token in memory only (see
 * `session.ts`). Ends after `sessionMinutes` without the editor using the admin (clicks and typing).
 */
export interface Auth {
  session: StoredSession | null;
  /** Why the last sign-out happened (e.g. the session expired); cleared by the next sign-in. */
  notice: string | null;
  /**
   * The session ended by itself (idle, expired, refused by GitHub), not by `signOut`. The query cache is kept, so the
   * open screen can stay under a sign-in overlay and go on after the same account signs in again.
   */
  lapsed: boolean;
  /**
   * Opens the GitHub popup (synchronously, so call it straight from a click) and stores the session it returns.
   * Rejects with the `AuthError` of the popup. After `signal` aborts, the result is dropped.
   */
  signIn(authUrl: string, options?: { signal?: AbortSignal }): Promise<void>;
  /**
   * Stores a personal access token as the session. If GitHub refuses it before any request with it succeeded, the
   * sign-out notice says the token was not accepted (instead of "expired").
   */
  signInWithToken(token: string): void;
  /** Clears the stored session, the in-memory refresh token, the query cache and the cached content (`onForget`). */
  signOut(notice?: string): void;
  /**
   * Calls `listener` when this session's content must leave this computer: on a sign-out (`signOut`) and on an account
   * switch (`forgetContent`). Not on a lapsed session. Returns the function that removes it. Unsaved edits are not the
   * listeners' business: they stay.
   */
  onForget(listener: () => void): () => void;
  /** Calls the `onForget` listeners now: the sign-in that replaces the account (a different login, or none to tell). */
  forgetContent(): void;
  /**
   * The access token, refreshed first when it is about to expire. A refused refresh signs out; a refresh that could
   * not reach the auth handler keeps the session and rejects with `GitHubError('network_error')`. Without a refresh
   * token in memory (after a reload) the access token is used until it expires, then this signs out. An idle session
   * signs out too.
   */
  getToken(): Promise<string>;
  /** `fetch` that retries a `401` once after a forced refresh, and signs out when that does not help. */
  fetch: typeof fetch;
}

const AuthContext = createContext<Auth | null>(null);

const globalFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** Stand-in when `sessionStorage` is blocked: the session lasts for this page only. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

function defaultStorage(): Storage {
  try {
    return window.sessionStorage;
  } catch {
    return memoryStorage();
  }
}

/** Activity is written to storage at most this often; the in-memory time is exact. */
const ACTIVITY_WRITE_MS = 60_000;
/** How often an open admin checks the idle timeout. */
const IDLE_CHECK_MS = 30_000;
/**
 * Input that counts as using the admin. GitHub requests do not: polls and refetches run with nobody at the keyboard.
 * Captured on the admin's own window, so a component that stops propagation still counts.
 */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const;

/** Refresh failures that say nothing about the session (handler unreachable or broken): keep it and retry later. */
const TRANSIENT_REFRESH_ERRORS = new Set(['network_error', 'token_request_failed', 'server_misconfigured']);

/** Transient: one of those codes, or not an `AuthError` at all. Any other `AuthError` code means sign out. */
function isTransientRefreshError(error: unknown): boolean {
  return !(error instanceof AuthError) || TRANSIENT_REFRESH_ERRORS.has(error.code);
}

/** `authUrl` may be a path; the auth client needs an absolute URL. */
function absoluteUrl(authUrl: string): string {
  return new URL(authUrl, window.location.origin).toString();
}

/** The stored form of `grant`: no refresh token. */
function toStored(grant: AuthSession, method: StoredSession['method'], lastActiveAt: number): StoredSession {
  return { ...grant, refreshToken: null, refreshTokenExpiresAt: null, method, lastActiveAt };
}

export function AuthProvider({
  authUrl,
  fetch: baseFetch = globalFetch,
  storage,
  sessionMinutes = DEFAULT_SESSION_MINUTES,
  children,
}: {
  /** The auth handler (`config.json` `authUrl`); needed to refresh OAuth sessions. */
  authUrl?: string;
  fetch?: typeof fetch;
  /** Default `window.sessionStorage`. */
  storage?: Storage;
  /** Idle timeout (`config.json` `sessionMinutes`). */
  sessionMinutes?: number;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const store = useMemo(() => storage ?? defaultStorage(), [storage]);
  const [state, setState] = useState((): { session: StoredSession | null; notice: string | null; lapsed: boolean } => {
    const stored = readSession(store);
    if (stored && isIdle(stored, sessionMinutes)) {
      try {
        clearSession(store);
      } catch {
        // Blocked storage: nothing to clear.
      }
      return { session: null, notice: sessionIdleText(sessionMinutes), lapsed: true };
    }
    return { session: stored, notice: null, lapsed: false };
  });
  /** The session for callbacks that run outside render (token getter, fetch hooks); `lastActiveAt` = last written. */
  const sessionRef = useRef(state.session);
  /** The last activity, exact (storage gets it at most once a minute). */
  const activeAt = useRef(state.session?.lastActiveAt ?? 0);
  /** The OAuth refresh token: in memory only, never in storage. `null` for a PAT or after a reload. */
  const refreshToken = useRef<string | null>(null);
  const renewing = useRef<Promise<StoredSession> | null>(null);
  /** A pasted token that GitHub has not accepted yet (no non-`401` answer with it in this tab). */
  const unverifiedToken = useRef(false);
  /** The `onForget` listeners (the workspace's cache). */
  const forgetters = useRef(new Set<() => void>());

  useEffect(() => {
    // The P8 first cut kept the session, refresh token included, in `localStorage`.
    try {
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // Storage blocked: nothing stored there either.
    }
  }, []);

  /** Writes the session; a refused write leaves it working in this page only. */
  const persist = useCallback(
    (session: StoredSession) => {
      try {
        writeSession(store, session);
      } catch {
        // Storage blocked or full.
      }
    },
    [store],
  );

  /** `grant` from the popup or a refresh: the refresh token goes to memory, the rest to storage and state. */
  const signedIn = useCallback(
    (
      grant: AuthSession,
      method: StoredSession['method'],
      options: { unverified?: boolean; lastActiveAt?: number } = {},
    ): StoredSession => {
      const lastActiveAt = options.lastActiveAt ?? Date.now();
      const session = toStored(grant, method, lastActiveAt);
      refreshToken.current = grant.refreshToken;
      unverifiedToken.current = options.unverified === true;
      activeAt.current = lastActiveAt;
      sessionRef.current = session;
      persist(session);
      setState({ session, notice: null, lapsed: false });
      return session;
    },
    [persist],
  );

  const onForget = useCallback((listener: () => void): (() => void) => {
    forgetters.current.add(listener);
    return () => void forgetters.current.delete(listener);
  }, []);
  const forgetContent = useCallback(() => {
    for (const listener of forgetters.current) {
      try {
        listener();
      } catch {
        // Best effort: a listener that fails does not block the sign-out.
      }
    }
  }, []);

  /** Drops the session. `lapsed`: it ended by itself, so the query cache (and the open screen) stays. */
  const drop = useCallback(
    (notice: string | null, lapsed: boolean) => {
      try {
        clearSession(store);
      } catch {
        // Storage blocked: nothing stored.
      }
      sessionRef.current = null;
      refreshToken.current = null;
      renewing.current = null;
      unverifiedToken.current = false;
      setState({ session: null, notice, lapsed });
      if (lapsed) return;
      // Nothing read with the old session may show to the next one, and nothing it cached stays on this computer.
      queryClient.clear();
      forgetContent();
    },
    [store, queryClient, forgetContent],
  );
  const signOut = useCallback((notice?: string) => drop(notice ?? null, false), [drop]);
  const lapse = useCallback((notice: string) => drop(notice, true), [drop]);

  /** Signs out when the session is idle; `true` if it did. */
  const endIfIdle = useCallback((): boolean => {
    const current = sessionRef.current;
    if (!current || !isIdle({ ...current, lastActiveAt: activeAt.current }, sessionMinutes)) return false;
    lapse(sessionIdleText(sessionMinutes));
    return true;
  }, [sessionMinutes, lapse]);

  /** Input in the admin: the session is in use. */
  const touch = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    const now = Date.now();
    activeAt.current = now;
    if (now - current.lastActiveAt < ACTIVITY_WRITE_MS) return;
    const next = { ...current, lastActiveAt: now };
    sessionRef.current = next;
    persist(next);
  }, [persist]);

  /** Writes the exact activity time now (the tab is going away or hidden; the throttle may have held it back). */
  const flush = useCallback(() => {
    const current = sessionRef.current;
    if (!current || current.lastActiveAt === activeAt.current) return;
    const next = { ...current, lastActiveAt: activeAt.current };
    sessionRef.current = next;
    persist(next);
  }, [persist]);

  const signedInNow = state.session !== null;
  useEffect(() => {
    if (!signedInNow) return;
    const timer = setInterval(endIfIdle, IDLE_CHECK_MS);
    const options = { capture: true, passive: true };
    for (const type of ACTIVITY_EVENTS) window.addEventListener(type, touch, options);
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      clearInterval(timer);
      for (const type of ACTIVITY_EVENTS) window.removeEventListener(type, touch, options);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [signedInNow, endIfIdle, touch, flush]);

  /** One refresh at a time, with the in-memory refresh token. */
  const renew = useCallback((): Promise<StoredSession> => {
    if (renewing.current) return renewing.current;
    const token = refreshToken.current;
    const refreshed = (async () => {
      if (!authUrl) throw new AuthError('invalid_worker_url');
      if (!token) throw new AuthError('bad_refresh_token');
      return refresh({ workerUrl: absoluteUrl(authUrl), refreshToken: token });
    })();
    // A sign-out while this runs resets `renewing`: the late result then changes nothing here.
    const promise = refreshed.then(
      (grant) => {
        // Signed out meanwhile: the token answers the request that asked, nothing is stored or kept.
        if (renewing.current !== promise) return toStored(grant, 'oauth', activeAt.current);
        renewing.current = null;
        // A refresh follows a request, not the editor: the idle clock stays.
        return signedIn(grant, 'oauth', { lastActiveAt: activeAt.current });
      },
      (error: unknown) => {
        const transient = isTransientRefreshError(error);
        if (renewing.current === promise) {
          renewing.current = null;
          if (!transient) lapse(SESSION_EXPIRED);
        }
        // The request fails like any other that can't reach GitHub; the session and the open form stay.
        if (transient) throw new GitHubError('network_error', "Can't reach the sign-in service to refresh the session");
        throw new AuthError('unauthorized', SESSION_EXPIRED);
      },
    );
    renewing.current = promise;
    return promise;
  }, [authUrl, signedIn, lapse]);

  const getToken = useCallback(async (): Promise<string> => {
    const current = sessionRef.current;
    if (!current) throw new AuthError('unauthorized', SESSION_EXPIRED);
    if (endIfIdle()) throw new AuthError('unauthorized', sessionIdleText(sessionMinutes));
    if (current.method === 'token' || !needsRefresh(current)) return current.accessToken;
    if (refreshToken.current) return (await renew()).accessToken;
    // After a reload: no refresh token here, so the access token lasts until it expires.
    if (current.expiresAt !== null && Date.now() < current.expiresAt) return current.accessToken;
    lapse(SESSION_EXPIRED);
    throw new AuthError('unauthorized', SESSION_EXPIRED);
  }, [endIfIdle, sessionMinutes, renew, lapse]);

  const fetchWithAuth = useMemo(() => {
    const accepting: typeof fetch = async (input, init) => {
      const res = await baseFetch(input, init);
      if (res.status !== 401) unverifiedToken.current = false;
      return res;
    };
    return authFetch(accepting, {
      async onRefresh() {
        const current = sessionRef.current;
        if (!current || current.method === 'token' || !refreshToken.current) return null;
        try {
          return (await renew()).accessToken;
        } catch (error) {
          if (error instanceof GitHubError) throw error; // transient: the request fails, the session stays
          return null; // `renew` signed out already
        }
      },
      onUnauthorized: () => lapse(unverifiedToken.current ? TOKEN_REJECTED : SESSION_EXPIRED),
    });
  }, [baseFetch, renew, lapse]);

  const signIn = useCallback(
    (url: string, options: { signal?: AbortSignal } = {}): Promise<void> => {
      let workerUrl: string;
      try {
        workerUrl = absoluteUrl(url);
      } catch {
        return Promise.reject(new AuthError('invalid_worker_url'));
      }
      return startLogin({ workerUrl }).then((result) => {
        if (options.signal?.aborted) return;
        signedIn(result, 'oauth');
      });
    },
    [signedIn],
  );

  const signInWithToken = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      if (!trimmed) return;
      signedIn(tokenSession(trimmed), 'token', { unverified: true });
    },
    [signedIn],
  );

  const auth = useMemo(
    (): Auth => ({
      session: state.session,
      notice: state.notice,
      lapsed: state.lapsed,
      signIn,
      signInWithToken,
      signOut,
      onForget,
      forgetContent,
      getToken,
      fetch: fetchWithAuth,
    }),
    [state, signIn, signInWithToken, signOut, onForget, forgetContent, getToken, fetchWithAuth],
  );

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}

/**
 * Runs `listener` while the component is mounted, whenever the session's content is forgotten (`Auth.onForget`).
 * Does nothing outside an `AuthProvider` (the workspace also renders on its own, in tests).
 */
export function useOnForget(listener: () => void): void {
  const onForget = useContext(AuthContext)?.onForget;
  useEffect(() => {
    if (!onForget) return;
    return onForget(listener);
  }, [onForget, listener]);
}
