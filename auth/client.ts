import { AUTH_MESSAGE_SOURCE, type AuthMessage, type TokenResponse } from './protocol.ts';

export interface AuthSession {
  accessToken: string;
  tokenType: string;
  /** Epoch ms on the browser clock. `null` means the token never expires. */
  expiresAt: number | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: number | null;
}

export class AuthError extends Error {
  code: string;
  description?: string;

  constructor(code: string, description?: string) {
    super(description ?? code);
    this.name = 'AuthError';
    this.code = code;
    this.description = description;
  }
}

const POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const REFRESH_SKEW_MS = 5 * 60_000;

function toSession(token: TokenResponse, now: number): AuthSession {
  if (typeof token !== 'object' || token === null || typeof token.access_token !== 'string' || !token.access_token) {
    throw new TypeError('invalid token');
  }
  return {
    accessToken: token.access_token,
    tokenType: token.token_type,
    expiresAt: token.expires_in ? now + token.expires_in * 1000 : null,
    refreshToken: token.refresh_token ?? null,
    refreshTokenExpiresAt: token.refresh_token_expires_in ? now + token.refresh_token_expires_in * 1000 : null,
  };
}

function isAuthMessage(data: unknown): data is AuthMessage {
  return typeof data === 'object' && data !== null && (data as { source?: unknown }).source === AUTH_MESSAGE_SOURCE;
}

/** `<workerUrl>/<route>`, keeping any path on `workerUrl` (the handler may be mounted under a route). */
function endpoint(workerUrl: string, route: string): URL {
  const base = new URL(workerUrl);
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/${route}`;
  base.search = '';
  base.hash = '';
  return base;
}

/** Call synchronously from a click handler, before any `await`, or popup blockers will stop it. */
export function startLogin(options: { workerUrl: string; timeoutMs?: number }): Promise<AuthSession> {
  let workerOrigin: string;
  let url: URL;
  try {
    workerOrigin = new URL(options.workerUrl).origin;
    url = endpoint(options.workerUrl, 'auth');
  } catch {
    return Promise.reject(new AuthError('invalid_worker_url'));
  }
  url.searchParams.set('origin', location.origin);

  const popup = window.open(url.toString(), 'editlet-auth', 'popup,width=600,height=720');
  if (!popup) return Promise.reject(new AuthError('popup_blocked'));

  return new Promise<AuthSession>((resolve, reject) => {
    let settled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      finish();
    };

    function onMessage(event: MessageEvent): void {
      if (event.origin !== workerOrigin || event.source !== popup || !isAuthMessage(event.data)) return;
      const message = event.data;
      if (message.ok) {
        let session: AuthSession;
        try {
          session = toSession(message.token, Date.now());
        } catch {
          settle(() => reject(new AuthError('token_request_failed')));
          return;
        }
        settle(() => resolve(session));
      } else {
        settle(() => reject(new AuthError(message.error, message.description)));
      }
    }

    window.addEventListener('message', onMessage);
    poll = setInterval(() => {
      if (popup.closed) settle(() => reject(new AuthError('popup_closed')));
    }, POLL_MS);
    timer = setTimeout(
      () =>
        settle(() => {
          try {
            popup.close();
          } catch {
            // The popup may already be gone or cross-origin; the timeout still applies.
          }
          reject(new AuthError('timeout'));
        }),
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
  });
}

/** Refresh tokens are single-use: store the returned session, including its new refresh token. */
export async function refresh(options: { workerUrl: string; refreshToken: string }): Promise<AuthSession> {
  let refreshUrl: string;
  try {
    refreshUrl = endpoint(options.workerUrl, 'refresh').toString();
  } catch {
    throw new AuthError('invalid_worker_url');
  }
  let response: Response;
  try {
    response = await fetch(refreshUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: options.refreshToken }),
    });
  } catch {
    throw new AuthError('network_error');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthError('token_request_failed');
  }

  const data = (body ?? {}) as Partial<TokenResponse> & { error?: unknown; error_description?: unknown };
  if (typeof data.error === 'string') {
    throw new AuthError(data.error, typeof data.error_description === 'string' ? data.error_description : undefined);
  }
  if (!response.ok || typeof data.access_token !== 'string') throw new AuthError('token_request_failed');
  return toSession(data as TokenResponse, Date.now());
}

export function needsRefresh(session: AuthSession, now: number = Date.now()): boolean {
  return session.expiresAt !== null && now >= session.expiresAt - REFRESH_SKEW_MS;
}
