import type { PreviewRef } from './previewCookie';

import { FIELD_ATTR, fieldMark } from '../loader/protocol';

/** Spread onto the element that shows `field`. Marks only in a draft render (entry carries `ref`); else `{}`. */
export function editletField(
  entry: { collection: string; slug: string; ref?: PreviewRef },
  field: string,
): Record<string, string> {
  return entry.ref ? { [FIELD_ATTR]: fieldMark(`${entry.collection}/${entry.slug}`, field) } : {};
}
