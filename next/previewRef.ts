import { cookies, draftMode } from 'next/headers';

import { PREVIEW_COOKIE, readPreviewSecret, verifyPreview, type PreviewRef } from './previewCookie';

export type { PreviewRef } from './previewCookie';

/**
 * The ref a draft render reads, or `undefined` for a normal render. Defined only when draft mode is on and the
 * preview cookie verifies with `CMS_PREVIEW_SECRET` and has not expired. Call it outside `"use cache"` scopes and pass
 * the result to the reader (and to cached helpers as an argument).
 */
export async function previewRef(): Promise<PreviewRef | undefined> {
  if (!(await draftMode()).isEnabled) return undefined;
  const secret = readPreviewSecret();
  if (!secret) return undefined;
  const value = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!value) return undefined;
  return (await verifyPreview(value, secret)) ?? undefined;
}
