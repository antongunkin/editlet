import { cookies, draftMode } from 'next/headers';

import { isPreviewRef, PREVIEW_COOKIE, readPreviewSecret, signPreview } from './previewCookie';
import { readPreviewEnv } from './previewEnv';

export interface PreviewHandlerDeps {
  fetch?: typeof fetch;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

export interface PreviewHandlers {
  POST(req: Request): Promise<Response>;
  DELETE(): Promise<Response>;
}

function reply(status: number, message?: string): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (message === undefined) return new Response(null, { status, headers });
  headers['Content-Type'] = 'text/plain; charset=utf-8';
  return new Response(message, { status, headers });
}

function missingEnv(): string | null {
  if (!readPreviewSecret()) return 'CMS_PREVIEW_SECRET is missing or shorter than 32 characters';
  if (!process.env.CMS_GITHUB_TOKEN) return 'CMS_GITHUB_TOKEN is missing';
  if (!readPreviewEnv()) return 'EDITLET_PREVIEW is missing or malformed; turn on admin.preview in withEditlet';
  return null;
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') ?? '');
  return match ? match[1] : null;
}

async function endPreview(): Promise<Response> {
  (await draftMode()).disable();
  (await cookies()).delete({ name: PREVIEW_COOKIE, path: '/' });
  return reply(204);
}

/**
 * The preview Route Handler. `POST { branch, sha }` with the editor's GitHub token in `Authorization` checks push
 * access once, turns on draft mode and sets the signed preview cookie. `DELETE` ends the session.
 * The editor token is used for the permission call only; it is never stored, logged or put in the cookie.
 */
export function createPreviewHandlers(deps: PreviewHandlerDeps = {}): PreviewHandlers {
  const now = deps.now ?? Date.now;

  async function POST(req: Request): Promise<Response> {
    if (req.headers.get('origin') !== new URL(req.url).origin) return reply(403, 'Forbidden origin');

    const missing = missingEnv();
    if (missing) return reply(500, `Preview is not configured: ${missing}`);
    const secret = readPreviewSecret()!;
    const env = readPreviewEnv()!;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply(400, 'Body must be JSON { branch, sha }');
    }
    if (!isPreviewRef(body)) return reply(400, 'branch must be a branch name and sha a 40-character commit id');
    const { branch, sha } = body;

    const token = bearerToken(req);
    if (!token) return reply(401, 'Missing Authorization: Bearer token');

    const doFetch = deps.fetch ?? fetch;
    let canPush = false;
    try {
      const res = await doFetch(
        `https://api.github.com/repos/${encodeURIComponent(env.owner)}/${encodeURIComponent(env.repo)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          cache: 'no-store',
        },
      );
      // GitHub down or rate limited: not an answer about push access.
      if (res.status >= 500 || res.status === 429) return reply(502, `GitHub answered ${res.status}; try again`);
      if (res.ok) {
        const repo = (await res.json()) as { permissions?: { push?: unknown } } | null;
        canPush = repo?.permissions?.push === true;
      }
    } catch {
      return reply(502, 'Could not reach GitHub');
    }
    if (!canPush) return reply(403, 'No push access to the repository');

    const maxAge = Math.round(env.sessionMinutes * 60);
    const value = await signPreview({ branch, sha, exp: Math.floor(now() / 1000) + maxAge }, secret);
    (await draftMode()).enable();
    (await cookies()).set(PREVIEW_COOKIE, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge });
    return reply(204);
  }

  return { POST, DELETE: endPreview };
}

const handlers = createPreviewHandlers();

/** Re-export from `app/api/editlet/preview/route.ts`: `export { POST, DELETE } from 'editlet/next/preview'`. */
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
