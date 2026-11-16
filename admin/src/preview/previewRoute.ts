// Calls to the site's preview route (Layer B, `editlet/next/preview`). The admin is same-origin with the site, so
// `credentials: 'same-origin'` lets the route set and clear its HttpOnly cookie.
import { PREVIEW_ROUTE } from '../../../loader/protocol';

const globalFetch: typeof fetch = (...args) => globalThis.fetch(...args);

/** A hung route call must not hold the route queue: it fails after this long. */
const ROUTE_TIMEOUT_MS = 10_000;

/**
 * `POST` the active branch and its head commit with the editor's token, so the site renders that commit in draft
 * mode. `true` when the route answered `204`; `false` for any other status, a network error or no answer within 10 s.
 * The token goes into the `Authorization` header only.
 */
export async function postPreview({
  branch,
  sha,
  token,
  fetch: fetchFn = globalFetch,
}: {
  branch: string;
  sha: string;
  token: string;
  fetch?: typeof fetch;
}): Promise<boolean> {
  try {
    const res = await fetchFn(PREVIEW_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ branch, sha }),
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
    return res.status === 204;
  } catch {
    return false;
  }
}

/** `DELETE`: the site turns draft mode off and clears the preview cookie. Errors are ignored. */
export async function deletePreview(fetchFn: typeof fetch = globalFetch): Promise<void> {
  try {
    await fetchFn(PREVIEW_ROUTE, {
      method: 'DELETE',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
    });
  } catch {
    // Best-effort: the cookie expires with the session anyway.
  }
}
