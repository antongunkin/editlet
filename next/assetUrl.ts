/** Public URL prefix under which the dev server and the build copy serve content-directory files. */
export const CONTENT_URL = '/editlet/content/';

/**
 * Turns an image `src` (relative to the entry's folder) into its public URL. Absolute URLs, root-relative paths,
 * fragments and sources escaping the content directory are returned unchanged.
 */
export function assetUrl(entry: { collection: string }, src: string): string {
  if (src === '' || /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(src)) return src;
  const url = new URL(src, `http://x${CONTENT_URL}${entry.collection}/`);
  return url.pathname.startsWith(CONTENT_URL) ? url.pathname : src;
}
