import { AuthError } from '../../../auth/client';
import { GitHubError } from '../../../github';

export const SESSION_EXPIRED = 'Your GitHub session expired. Sign in again.';
/** Sign-out notice when a freshly pasted token is refused before it ever worked. */
export const TOKEN_REJECTED = "GitHub didn't accept this token.";

/** Sign-out notice of the idle timeout (`sessionMinutes`). */
export function sessionIdleText(minutes: number): string {
  return `Your session ended after ${minutes} minute${minutes === 1 ? '' : 's'} without activity. Sign in again.`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local `HH:MM`. */
function clock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** One line for a GitHub-mode failure: auth, rate limit, network, else the error's own message (`IssuesError` too). */
export function errorText(error: unknown, ctx: { repo?: string } = {}): string {
  if (error instanceof AuthError) {
    if (error.code === 'forbidden') return `Your GitHub account can't write to ${ctx.repo ?? 'this repository'}`;
    if (error.code === 'unauthorized') return SESSION_EXPIRED;
  }
  if (error instanceof GitHubError) {
    if (error.code === 'rate_limited') {
      return error.retryAt === undefined
        ? 'GitHub rate limit reached. Try again later'
        : `GitHub rate limit reached. Try again at ${clock(error.retryAt)}`;
    }
    if (error.code === 'network_error') return "Can't reach GitHub";
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
