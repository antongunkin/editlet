import type { AuthSession } from '../../../auth/client';
import { EDITLET_SOURCE } from '../../../loader/protocol';

/**
 * The session as the admin holds it. Stored in `sessionStorage` (this tab only) without the refresh token: any script
 * on the site's origin can read storage, so the long-lived refresh token stays in memory (`AuthProvider`) and storage
 * only ever holds an access token that expires within hours. `lastActiveAt` drives the idle timeout.
 */
export type StoredSession = AuthSession & { method: 'oauth' | 'token'; lastActiveAt: number };

export const SESSION_KEY = `${EDITLET_SOURCE}:session:v2`;
/**
 * The P8 first-cut key in `localStorage` (it held the refresh token); removed on load. It predates the Editlet rename,
 * so it keeps the old `octocms` prefix on purpose.
 */
export const LEGACY_SESSION_KEY = 'octocms:session:v1';

const isNullableNumber = (v: unknown): boolean => v === null || typeof v === 'number';

/**
 * The stored session, with `refreshToken` / `refreshTokenExpiresAt` always `null`; `null` if missing or malformed. A
 * `lastActiveAt` in the future (clock change, tampering) counts as `now`.
 */
export function readSession(storage: Storage, now: number = Date.now()): StoredSession | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSession> | null;
    if (
      typeof s !== 'object' ||
      s === null ||
      typeof s.accessToken !== 'string' ||
      !s.accessToken ||
      typeof s.tokenType !== 'string' ||
      !isNullableNumber(s.expiresAt) ||
      typeof s.lastActiveAt !== 'number' ||
      (s.method !== 'oauth' && s.method !== 'token')
    ) {
      return null;
    }
    return {
      accessToken: s.accessToken,
      tokenType: s.tokenType,
      expiresAt: s.expiresAt ?? null,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      method: s.method,
      lastActiveAt: Math.min(s.lastActiveAt, now),
    };
  } catch {
    return null;
  }
}

/** Writes everything but the refresh token. */
export function writeSession(storage: Storage, session: StoredSession): void {
  const { accessToken, tokenType, expiresAt, method, lastActiveAt } = session;
  storage.setItem(SESSION_KEY, JSON.stringify({ accessToken, tokenType, expiresAt, method, lastActiveAt }));
}

export function clearSession(storage: Storage): void {
  storage.removeItem(SESSION_KEY);
}

/** A personal access token: never expires, cannot be refreshed. */
export function tokenSession(token: string, now: number = Date.now()): StoredSession {
  return {
    accessToken: token,
    tokenType: 'bearer',
    expiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
    method: 'token',
    lastActiveAt: now,
  };
}

/** The editor has not used the admin (`lastActiveAt`) for longer than `minutes`. */
export function isIdle(session: StoredSession, minutes: number, now: number = Date.now()): boolean {
  return now - session.lastActiveAt > minutes * 60_000;
}

/** fetch that retries a 401 once after `onRefresh()` returns a new token; a second 401 (or no refresh) → onUnauthorized(). */
export function authFetch(
  base: typeof fetch,
  hooks: { onRefresh(): Promise<string | null>; onUnauthorized(): void },
): typeof fetch {
  return async (input, init) => {
    const first = await base(input, init);
    if (first.status !== 401) return first;
    const token = await hooks.onRefresh();
    if (!token) {
      hooks.onUnauthorized();
      return first;
    }
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('Authorization', `Bearer ${token}`);
    const second = await base(input, { ...init, headers });
    if (second.status === 401) hooks.onUnauthorized();
    return second;
  };
}
