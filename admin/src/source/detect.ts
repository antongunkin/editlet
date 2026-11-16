import { DEV_API_BASE } from '../../../core/devApi';
import type { Issue } from '../../../core/issues';

export type DetectedMode = { mode: 'local' } | { mode: 'local-broken'; issues: Issue[] } | { mode: 'github' };

/**
 * Probes `GET <base>/files`: `200` → local; `500` with `{ issues }` → local with a broken schema; anything else or a
 * network error → github.
 */
export async function detectMode(
  fetchFn: typeof fetch = globalThis.fetch.bind(globalThis),
  base = DEV_API_BASE,
): Promise<DetectedMode> {
  try {
    const res = await fetchFn(`${base}/files`);
    if (res.status === 200) return { mode: 'local' };
    if (res.status === 500) {
      const body = (await res.json()) as { issues?: unknown };
      if (Array.isArray(body?.issues)) return { mode: 'local-broken', issues: body.issues as Issue[] };
    }
  } catch {
    // Network error or a non-JSON 500: not the dev API.
  }
  return { mode: 'github' };
}
