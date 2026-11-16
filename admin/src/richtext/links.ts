/**
 * A link or image URL the editor accepts: relative paths, `#anchors`, `http(s):`, `mailto:` and `tel:`. Anything else
 * with a scheme (`javascript:`, `data:`, `vbscript:`…) is refused.
 */
export function isSafeHref(href: string): boolean {
  // Browsers ignore whitespace and control characters inside a scheme (`java\tscript:`), so drop them first.
  const compact = [...href].filter((c) => c.charCodeAt(0) > 0x20 && c.charCodeAt(0) !== 0x7f).join('');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (!scheme) return true;
  return ['http', 'https', 'mailto', 'tel'].includes(scheme[1]!.toLowerCase());
}
