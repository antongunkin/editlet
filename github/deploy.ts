export interface DeployHookResult {
  /** `null` = the response could not be read (CORS or network). The request may still have been delivered. */
  ok: boolean | null;
  status: number | null;
}

/** Throws `TypeError` for an unparsable or non-https deploy hook URL. */
export function assertDeployHookUrl(url: string): void {
  let protocol: string;
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new TypeError('Deploy hook URL must be https');
  }
  if (protocol !== 'https:') throw new TypeError('Deploy hook URL must be https');
}

/**
 * Calls a deploy hook (Vercel, Netlify, Cloudflare Pages). HTTPS only; a bare `POST` with no headers and no body, so
 * the browser treats it as a simple CORS request. Deliberately does not use the GitHub client: the token must never
 * reach the hook host.
 */
export async function triggerDeployHook(
  url: string,
  options: { fetch?: typeof fetch } = {},
): Promise<DeployHookResult> {
  assertDeployHookUrl(url);
  const doFetch = options.fetch ?? globalThis.fetch;
  try {
    const res = await doFetch(url, { method: 'POST' });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: null, status: null };
  }
}
