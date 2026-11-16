// DOM patcher: applies a preview snapshot to the site page. Marks first (data-*-field), then value matching scoped to
// entry containers. Writes only through nodeValue/textContent, src, srcset, alt and document.title; never HTML.
import { ENTRY_ATTR, EDITLET_SOURCE, FIELD_ATTR, fieldMark, type PreviewSnapshot } from '../protocol';

export const PILL_ATTR = `data-${EDITLET_SOURCE}-preview-pill`;
const SKIP = `dialog[data-${EDITLET_SOURCE}], [${PILL_ATTR}]`;

export type PatchResult = { patched: number; pending: number; restore(): void };

const skipped = (n: Node): boolean => {
  const el = n instanceof Element ? n : n.parentElement;
  return !!el?.closest(SKIP);
};

export function applySnapshot(doc: Document, snapshot: PreviewSnapshot, objectUrl: (b: Blob) => string): PatchResult {
  type Written<T> = { orig: T; written: T };
  const texts = new Map<Node, Written<string | null>>();
  const children = new Map<Element, { orig: Node[]; inserted: Node[] }>();
  const attrs = new Map<Element, Map<string, Written<string | null>>>();
  let title: Written<string> | undefined;
  let patched = 0;
  let pending = 0;

  const writeText = (n: Node, to: string): boolean => {
    const orig = texts.has(n) ? texts.get(n)!.orig : n.nodeValue;
    n.nodeValue = to;
    texts.set(n, { orig, written: n.nodeValue });
    return true;
  };
  const setElementText = (el: Element, to: string): boolean => {
    const only = el.childNodes.length === 1 ? el.firstChild : null;
    if (only && only.nodeType === 3) return writeText(only, to);
    const prev = children.get(el);
    const orig = prev ? prev.orig : [...el.childNodes];
    el.textContent = to;
    children.set(el, { orig, inserted: [...el.childNodes] });
    return true;
  };
  const setAttr = (el: Element, name: string, value: string | null): void => {
    let m = attrs.get(el);
    if (!m) attrs.set(el, (m = new Map()));
    // `has`, not `??`: an attribute absent before the first patch keeps its `null` original.
    const orig = m.has(name) ? m.get(name)!.orig : el.getAttribute(name);
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    m.set(name, { orig, written: value });
  };
  const setImage = (img: Element, value: { to: Blob; alt?: { to: string } }): boolean => {
    setAttr(img, 'src', objectUrl(value.to));
    setAttr(img, 'srcset', null);
    if (value.alt) setAttr(img, 'alt', value.alt.to);
    return true;
  };

  const hasMarks = [...doc.querySelectorAll(`[${FIELD_ATTR}]`)].some((e) => !skipped(e));
  for (const [ref, fields] of Object.entries(snapshot.entries)) {
    const scopes: Element[] = [...doc.querySelectorAll(`[${ENTRY_ATTR}]`)].filter(
      (e) => e.getAttribute(ENTRY_ATTR) === ref,
    );
    if (!scopes.length && doc.body) scopes.push(doc.body);

    for (const [field, value] of Object.entries(fields)) {
      if ('stale' in value) {
        pending++;
        continue;
      }
      let changed = false;
      if (hasMarks) {
        const mark = fieldMark(ref, field);
        for (const el of doc.querySelectorAll(`[${FIELD_ATTR}]`)) {
          if (el.getAttribute(FIELD_ATTR) !== mark || skipped(el)) continue;
          if ('text' in value) changed = setElementText(el, value.text.to) || changed;
          else {
            const img = el.tagName === 'IMG' ? el : el.querySelector('img');
            if (img) changed = setImage(img, value.image) || changed;
          }
        }
      } else if ('text' in value) {
        const from = value.text.from.trim();
        const to = value.text.to;
        if (from === '') {
          pending++;
          continue;
        }
        for (const scope of scopes) {
          const walker = doc.createTreeWalker(scope, 4 /* SHOW_TEXT */);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (texts.has(n) || skipped(n) || n.nodeValue?.trim() !== from) continue;
            const v = n.nodeValue!;
            const lead = v.slice(0, v.length - v.trimStart().length);
            const trail = v.slice(v.trimEnd().length);
            changed = writeText(n, lead + to + trail) || changed;
          }
        }
        if (doc.title === from) {
          const orig = title ? title.orig : doc.title;
          doc.title = to;
          title = { orig, written: doc.title };
          changed = true;
        }
      } else {
        const { from } = value.image;
        const enc = encodeURIComponent(from);
        for (const scope of scopes) {
          for (const img of scope.querySelectorAll('img')) {
            if (skipped(img)) continue;
            const hay = `${img.getAttribute('src') ?? ''} ${img.getAttribute('srcset') ?? ''}`;
            if (from && (hay.includes(from) || hay.includes(enc))) changed = setImage(img, value.image) || changed;
          }
        }
      }
      if (changed) patched++;
      else pending++;
    }
  }

  return {
    patched,
    pending,
    restore() {
      for (const [n, t] of texts) if (n.nodeValue === t.written) n.nodeValue = t.orig;
      texts.clear();
      for (const [el, c] of children) {
        const now = [...el.childNodes];
        if (now.length === c.inserted.length && now.every((x, i) => x === c.inserted[i])) el.replaceChildren(...c.orig);
      }
      children.clear();
      for (const [el, m] of attrs) {
        for (const [k, t] of m) {
          if (el.getAttribute(k) !== t.written) continue;
          if (t.orig === null) el.removeAttribute(k);
          else el.setAttribute(k, t.orig);
        }
      }
      attrs.clear();
      if (title && doc.title === title.written) doc.title = title.orig;
      title = undefined;
    },
  };
}
