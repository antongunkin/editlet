const SVG_NS = 'http://www.w3.org/2000/svg';

/** Elements that run script or embed other documents. */
const DROP_ELEMENTS = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'handler', 'listener']);
/** Animation elements that can rewrite an attribute; dropped when they target a link or an event handler. */
const ANIMATE_ELEMENTS = new Set(['set', 'animate', 'animatemotion', 'animatetransform']);

/** A link that stays inside the file (`#id`) or embeds a raster image (`data:image/png…`, not SVG). */
const isSafeLink = (value: string) => {
  const v = value.trim().toLowerCase();
  return v.startsWith('#') || (/^data:image\/(png|jpe?g|gif|webp|avif);/.test(v) && !v.includes('svg'));
};

/**
 * Removes what can run code when the SVG is opened from the site's origin: `<script>`, `<foreignObject>` and other
 * embedding elements, `on*` handlers, links that leave the file (`href`, `xlink:href`), and animations that would set
 * them. Returns the text unchanged when there was nothing to remove. Throws when the text is not an SVG document.
 */
export function sanitizeSvg(text: string): string {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (doc.getElementsByTagName('parsererror').length > 0 || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new Error('Not a valid SVG file');
  }
  let changed = false;
  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (!el.isConnected) continue;
    const name = el.localName.toLowerCase();
    const target = el.getAttribute('attributeName')?.toLowerCase() ?? '';
    if (
      DROP_ELEMENTS.has(name) ||
      (ANIMATE_ELEMENTS.has(name) && (target.endsWith('href') || target.startsWith('on')))
    ) {
      el.remove();
      changed = true;
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.localName.toLowerCase();
      if (attrName.startsWith('on') || (attrName === 'href' && !isSafeLink(attr.value))) {
        el.removeAttributeNode(attr);
        changed = true;
      }
    }
  }
  return changed ? new XMLSerializer().serializeToString(doc) : text;
}
