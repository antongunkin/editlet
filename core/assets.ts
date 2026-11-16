import { resolveAssetPath } from './paths';
import { markdownFieldKey, type Collection, type Schema } from './schema';
import { visitFields } from './walk';

/** `[start, end)` offsets into the body text. */
export type TextRange = readonly [number, number];

/**
 * One image in a markdown body, with the offsets needed to change its alt or src without touching the rest:
 * - `inline`: `![alt](src "title")`;
 * - `reference`: `![alt][label]`, `![alt][]` or `![alt]` plus a `[label]: src` definition (`srcRange` points into
 *   the definition, so images sharing one definition share it);
 * - `html`: `<img src="…" alt="…">`.
 */
export type BodyImage = {
  kind: 'inline' | 'reference' | 'html';
  src: string;
  /** Alt text, unescaped (markdown backslash escapes, HTML entities). */
  alt: string;
  /** The whole image (`![…](…)`, `![…][…]` or the `<img …>` tag). */
  range: TextRange;
  /** The alt text between the brackets, or the HTML attribute value; `null` for an `<img>` without `alt`. */
  altRange: TextRange | null;
  srcRange: TextRange;
  /** Reference images: the label, and whether it was written out (`full`) or taken from the alt text. */
  label?: { text: string; form: 'full' | 'collapsed' | 'shortcut' };
};

/** One place an entry uses an image file. */
export type ImageUse = {
  /**
   * The field key: an `image` field, or the `markdown` field for body images (`body` when there is none). Inside an
   * `object` or a block it is the dot path (`content.2.image`), and `at` holds the same path as parts.
   */
  field: string;
  /** Path of a nested value: the `image` field, or the Markdown string the image is in. Unset at the top level. */
  at?: (string | number)[];
  /** Label of a nested field with its place (`Image (content.2)`); unset at the top level. */
  label?: string;
  src: string;
  alt: string;
  /** Repo path `src` resolves to (`resolveAssetPath`), `null` for URLs, absolute paths and paths outside contentDir. */
  path: string | null;
  /** Set for images in the body, or in a nested Markdown string (with `at`). Ranges are inside that text. */
  body?: BodyImage;
};

/** Fenced code blocks, indented code blocks, inline code spans and HTML comments, as ranges to skip. */
function codeRanges(text: string): TextRange[] {
  const out: TextRange[] = [];
  const lines = text.split('\n');
  let pos = 0;
  let fence: { char: string; length: number; start: number } | null = null;
  let indented: number | null = null;
  let previousBlank = true;
  for (const line of lines) {
    const end = pos + line.length;
    const blank = line.trim() === '';
    if (fence) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1]![0] === fence.char && close[1]!.length >= fence.length) {
        out.push([fence.start, end]);
        fence = null;
      }
    } else {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      const isIndented = /^(?: {4}|\t)/.test(line) && !blank;
      if (indented !== null && !isIndented && !blank) {
        out.push([indented, pos]);
        indented = null;
      }
      if (open && indented === null) fence = { char: open[1]![0]!, length: open[1]!.length, start: pos };
      else if (isIndented && indented === null && previousBlank) indented = pos;
    }
    previousBlank = blank;
    pos = end + 1;
  }
  if (fence) out.push([fence.start, text.length]);
  if (indented !== null) out.push([indented, text.length]);

  const inside = (i: number) => out.some(([s, e]) => i >= s && i < e);
  const inline: TextRange[] = [];
  const spans = /(`+)|<!--/g;
  let m: RegExpExecArray | null;
  while ((m = spans.exec(text))) {
    if (inside(m.index)) continue;
    if (m[0] === '<!--') {
      const close = text.indexOf('-->', m.index + 4);
      const stop = close === -1 ? text.length : close + 3;
      inline.push([m.index, stop]);
      spans.lastIndex = stop;
      continue;
    }
    const run = m[1]!;
    const closer = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
    closer.lastIndex = m.index + run.length;
    const close = closer.exec(text);
    if (!close) continue;
    inline.push([m.index, close.index + run.length]);
    spans.lastIndex = close.index + run.length;
  }
  return [...out, ...inline];
}

/** The text with every code range replaced by spaces, so offsets stay the same and nothing inside matches. */
function maskCode(text: string): string {
  let masked = text;
  for (const [s, e] of codeRanges(text)) {
    masked = masked.slice(0, s) + masked.slice(s, e).replace(/[^\n]/g, ' ') + masked.slice(e);
  }
  return masked;
}

const isEscaped = (text: string, i: number) => {
  let n = 0;
  while (i - 1 - n >= 0 && text[i - 1 - n] === '\\') n++;
  return n % 2 === 1;
};

const unescapeMarkdown = (s: string) => s.replace(/\\([!-/:-@[-`{-~])/g, '$1');

const decodeEntities = (s: string) =>
  s.replace(/&(quot|amp|lt|gt|#39|apos);/g, (_, e: string) =>
    e === 'quot' ? '"' : e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : "'",
  );

/** Reference labels match case-insensitively with whitespace collapsed. */
const normalizeLabel = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();

/** Index of the `]` closing the `[` at `open` (nested brackets allowed), or -1. */
function closingBracket(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '\n' && text[i + 1] === '\n') return -1;
    if (isEscaped(text, i)) continue;
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

/** `(dest "title")` starting at `open`: the destination's range and text, and the index after `)`; null if not one. */
function inlineDestination(text: string, open: number): { range: TextRange; src: string; end: number } | null {
  let i = open + 1;
  while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
  let start = i;
  let stop: number;
  if (text[i] === '<') {
    const close = text.indexOf('>', i);
    if (close === -1 || text.slice(i, close).includes('\n')) return null;
    start = i + 1;
    stop = close;
    i = close + 1;
  } else {
    let depth = 0;
    while (i < text.length && !/\s/.test(text[i]!)) {
      if (text[i] === '(' && !isEscaped(text, i)) depth++;
      else if (text[i] === ')' && !isEscaped(text, i)) {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    stop = i;
  }
  while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === '(') {
    const closeChar = quote === '(' ? ')' : quote;
    let j = i + 1;
    while (j < text.length && (text[j] !== closeChar || isEscaped(text, j))) j++;
    if (j >= text.length) return null;
    i = j + 1;
    while (text[i] === ' ' || text[i] === '\t' || text[i] === '\n') i++;
  }
  if (text[i] !== ')') return null;
  return { range: [start, stop], src: unescapeMarkdown(text.slice(start, stop)), end: i + 1 };
}

type Definition = { range: TextRange; src: string };

/** `[label]: dest "title"` lines, first definition of a label wins. */
function definitions(masked: string): Map<string, Definition> {
  const out = new Map<string, Definition>();
  const re = /^ {0,3}\[((?:\\.|[^\]\\])+)\]:[ \t]*(?:\n[ \t]*)?(<[^>\n]*>|\S+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked))) {
    const label = normalizeLabel(m[1]!);
    if (label === '' || out.has(label)) continue;
    const raw = m[2]!;
    const destStart = m.index + m[0].length - raw.length;
    const angle = raw.startsWith('<');
    const start = angle ? destStart + 1 : destStart;
    const stop = angle ? destStart + raw.length - 1 : destStart + raw.length;
    out.set(label, { range: [start, stop], src: unescapeMarkdown(masked.slice(start, stop)) });
  }
  return out;
}

function markdownImages(masked: string, defs: Map<string, Definition>): BodyImage[] {
  const out: BodyImage[] = [];
  let from = 0;
  for (;;) {
    const at = masked.indexOf('![', from);
    if (at === -1) return out;
    from = at + 2;
    if (isEscaped(masked, at)) continue;
    const close = closingBracket(masked, at + 1);
    if (close === -1) continue;
    const altRange: TextRange = [at + 2, close];
    const altText = masked.slice(at + 2, close);
    const alt = unescapeMarkdown(altText);
    const next = masked[close + 1];
    if (next === '(') {
      const dest = inlineDestination(masked, close + 1);
      if (dest) {
        out.push({ kind: 'inline', src: dest.src, alt, range: [at, dest.end], altRange, srcRange: dest.range });
        from = dest.end;
        continue;
      }
    }
    let label: BodyImage['label'];
    let end = close + 1;
    if (next === '[') {
      const labelClose = closingBracket(masked, close + 1);
      if (labelClose !== -1) {
        const text = masked.slice(close + 2, labelClose);
        label = text.trim() === '' ? { text: altText, form: 'collapsed' } : { text, form: 'full' };
        end = labelClose + 1;
      }
    }
    label ??= { text: altText, form: 'shortcut' };
    const def = defs.get(normalizeLabel(label.text));
    if (!def) continue;
    out.push({ kind: 'reference', src: def.src, alt, range: [at, end], altRange, srcRange: def.range, label });
    from = end;
  }
}

function htmlImages(masked: string): BodyImage[] {
  const out: BodyImage[] = [];
  const tags = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tags.exec(masked))) {
    const tag = m[0];
    const attrs = /\s(src|alt)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi;
    let src: { range: TextRange; value: string } | undefined;
    let alt: { range: TextRange; value: string } | undefined;
    let a: RegExpExecArray | null;
    while ((a = attrs.exec(tag))) {
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      const quoted = a[2] !== undefined || a[3] !== undefined;
      const valueStart = m.index + a.index + a[0].length - value.length - (quoted ? 1 : 0);
      const entry = { range: [valueStart, valueStart + value.length] as TextRange, value: decodeEntities(value) };
      if (a[1]!.toLowerCase() === 'src') src ??= entry;
      else alt ??= entry;
    }
    if (!src) continue;
    out.push({
      kind: 'html',
      src: src.value,
      alt: alt?.value ?? '',
      range: [m.index, m.index + tag.length],
      altRange: alt?.range ?? null,
      srcRange: src.range,
    });
  }
  return out;
}

/** Every image in a markdown body (code blocks, inline code and HTML comments skipped), in document order. */
export function findBodyImages(body: string): BodyImage[] {
  const masked = maskCode(body);
  const images = [...markdownImages(masked, definitions(masked)), ...htmlImages(masked)];
  return images.toSorted((a, b) => a.range[0] - b.range[0]);
}

/** Images an entry uses: its `image` fields (with a `src`), then the images in its body. */
export function findImageRefs(
  schema: Schema,
  collection: Collection,
  entryPath: string,
  data: Record<string, unknown>,
  body: string,
): ImageUse[] {
  const out: ImageUse[] = [];
  visitFields(collection.fields, data, (field, v, at) => {
    const nested = at.length > 1 ? { at, label: `${field.label} (${at.slice(0, -1).join('.')})` } : {};
    if (field.type === 'markdown' && typeof v === 'string') {
      for (const image of findBodyImages(v)) {
        const use = {
          src: image.src,
          alt: image.alt,
          path: resolveAssetPath(schema, entryPath, image.src),
          body: image,
        };
        out.push({ field: at.join('.'), ...nested, at, ...use });
      }
      return;
    }
    if (field.type !== 'image' || typeof v !== 'object' || v === null) return;
    const { src, alt } = v as { src?: unknown; alt?: unknown };
    if (typeof src !== 'string' || src === '') return;
    out.push({
      field: at.join('.'),
      ...nested,
      src,
      alt: typeof alt === 'string' ? alt : '',
      path: resolveAssetPath(schema, entryPath, src),
    });
  });
  const bodyField = markdownFieldKey(collection) ?? 'body';
  for (const image of findBodyImages(body)) {
    out.push({
      field: bodyField,
      src: image.src,
      alt: image.alt,
      path: resolveAssetPath(schema, entryPath, image.src),
      body: image,
    });
  }
  return out;
}

const escapeAlt = (alt: string) => alt.replace(/[\\[\]]/g, '\\$&');
const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A markdown destination: wrapped in `<…>` when it has spaces, parentheses or angle brackets. */
const markdownDestination = (src: string) => (/[\s()<>]/.test(src) ? `<${src.replace(/[<>]/g, '\\$&')}>` : src);

export type BodyImageEdit = { image: BodyImage; alt?: string; src?: string };

type Splice = { range: TextRange; text: string };

function altSplice(image: BodyImage, alt: string): Splice {
  if (image.kind === 'html') {
    if (image.altRange) return { range: image.altRange, text: escapeAttr(alt) };
    // `<img` is four characters: the new attribute goes right after it.
    const at = image.range[0] + 4;
    return { range: [at, at], text: ` alt="${escapeAttr(alt)}"` };
  }
  // A collapsed or shortcut reference takes its label from the alt: write the label out so it still resolves.
  if (image.kind === 'reference' && image.label && image.label.form !== 'full') {
    return { range: image.range, text: `![${escapeAlt(alt)}][${image.label.text}]` };
  }
  return { range: image.altRange!, text: escapeAlt(alt) };
}

function srcSplice(body: string, image: BodyImage, src: string): Splice {
  if (image.kind === 'html') return { range: image.srcRange, text: escapeAttr(src) };
  const [s, e] = image.srcRange;
  // An angle-bracket destination keeps its brackets (they sit outside `srcRange`).
  const angled = body[s - 1] === '<' && body[e] === '>';
  const text = angled ? src.replace(/[<>]/g, '\\$&') : markdownDestination(src);
  return { range: image.srcRange, text };
}

/**
 * The body with the given images' alt and/or src replaced; every other byte stays. Edits that hit the same range
 * (several images sharing one reference definition) are applied once. Ranges come from `findBodyImages(body)`.
 */
export function editBodyImages(body: string, edits: BodyImageEdit[]): string {
  const splices = new Map<string, Splice>();
  for (const { image, alt, src } of edits) {
    for (const splice of [
      alt === undefined ? null : altSplice(image, alt),
      src === undefined ? null : srcSplice(body, image, src),
    ]) {
      if (splice) splices.set(`${splice.range[0]}:${splice.range[1]}`, splice);
    }
  }
  const ordered = [...splices.values()].toSorted((a, b) => b.range[0] - a.range[0] || b.range[1] - a.range[1]);
  let out = body;
  let floor = Infinity;
  for (const { range, text } of ordered) {
    // A splice inside one already applied (an alt within a rewritten reference) is covered by that one.
    if (range[1] > floor) continue;
    out = out.slice(0, range[0]) + text + out.slice(range[1]);
    floor = range[0];
  }
  return out;
}

/** A change to one image use (`findImageRefs`): a new `alt` and/or `src`. */
export type ImageUseEdit = { use: ImageUse; alt?: string; src?: string };

type DataPath = (string | number)[];

function getAt(data: unknown, path: DataPath): unknown {
  return path.reduce<unknown>(
    (v, k) => (v !== null && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined),
    data,
  );
}

/** A copy of `data` with `path` set to `value`; the objects and arrays along the path are copied, nothing else. */
function setAt(data: unknown, path: DataPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const copy = (Array.isArray(data) ? [...data] : { ...(data as object) }) as Record<string | number, unknown>;
  copy[head!] = setAt(copy[head!], rest, value);
  return copy;
}

/**
 * One entry's data and body with `edits` applied (all uses of the same entry): image fields get the new `alt`/`src`
 * at any depth, images in the body or in a nested Markdown string are changed in place (`editBodyImages`, every other
 * byte kept). The inputs are not changed.
 */
export function applyImageEdits(
  data: Record<string, unknown>,
  body: string,
  edits: ImageUseEdit[],
): { data: Record<string, unknown>; body: string } {
  let out: Record<string, unknown> = { ...data };
  const bodyEdits: BodyImageEdit[] = [];
  // Nested Markdown strings: their image edits, by the string's path.
  const textEdits = new Map<string, { at: DataPath; edits: BodyImageEdit[] }>();
  for (const { use, alt, src } of edits) {
    if (use.body && use.at) {
      const key = use.at.join('.');
      const group = textEdits.get(key) ?? { at: use.at, edits: [] };
      group.edits.push({ image: use.body, alt, src });
      textEdits.set(key, group);
    } else if (use.body) bodyEdits.push({ image: use.body, alt, src });
    else {
      const at = use.at ?? [use.field];
      const value = getAt(out, at) as { src: string; alt: string };
      const next = { ...value, ...(src === undefined ? {} : { src }), ...(alt === undefined ? {} : { alt }) };
      out = setAt(out, at, next) as Record<string, unknown>;
    }
  }
  for (const { at, edits: group } of textEdits.values()) {
    out = setAt(out, at, editBodyImages(String(getAt(out, at)), group)) as Record<string, unknown>;
  }
  return { data: out, body: bodyEdits.length > 0 ? editBodyImages(body, bodyEdits) : body };
}
