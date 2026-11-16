import { serializeEntryFile, type EntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { BLOCK_KEY, markdownFieldKey, type Collection, type Field } from '../../../core/schema';
import { normalizeData } from '../../../core/validate';
import { blockFields } from '../../../core/walk';

/**
 * Form state: field key → UI value (see the values table in the P6 spec §6), plus the reserved keys `draft`
 * (boolean), `__body` (body text; present when the collection has a markdown field or the file has a body) and
 * `__extra` (frontmatter keys outside the schema, carried through unchanged so validation reports them).
 */
export type FormValues = Record<string, unknown>;

export const DRAFT_KEY = 'draft';
export const BODY_KEY = '__body';
export const EXTRA_KEY = '__extra';

type Kind = 'string' | 'list' | 'boolean' | 'number' | 'json' | 'image' | 'markdown' | 'object' | 'items';

/**
 * UI-only key of a list item (`object` with `list`, `blocks`): a stable React key when items move. Never written.
 */
export const ITEM_KEY = '__key';

let itemSeq = 0;
/** A fresh `ITEM_KEY` value. */
export const newItemKey = (): string => `i${++itemSeq}`;

function kindOf(field: Field): Kind {
  switch (field.type) {
    case 'string':
      return field.list ? 'list' : 'string';
    case 'select':
    case 'reference':
      return field.multiple ? 'list' : 'string';
    case 'boolean':
    case 'number':
    case 'json':
    case 'image':
    case 'markdown':
      return field.type;
    case 'object':
      return field.list ? 'items' : 'object';
    case 'blocks':
      return 'items';
    default:
      return 'string';
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isAbsent = (v: unknown) => v === undefined || v === null;

/** `{ src?, alt? }` with only string values; anything else is kept raw. */
function isImageLike(v: unknown): v is { src?: string; alt?: string } {
  return (
    isPlainObject(v) &&
    Object.entries(v).every(([k, x]) => (k === 'src' || k === 'alt') && (typeof x === 'string' || x === undefined))
  );
}

function toUi(field: Field, v: unknown): unknown {
  switch (kindOf(field)) {
    case 'string':
      return isAbsent(v) ? '' : v;
    case 'list':
      return isAbsent(v) ? [] : v;
    case 'boolean':
      return isAbsent(v) ? undefined : v;
    case 'number':
      return isAbsent(v) ? '' : typeof v === 'number' ? String(v) : v;
    case 'json':
      return isAbsent(v) ? '' : JSON.stringify(v, null, 2);
    case 'image':
      if (isAbsent(v)) return { src: '', alt: '' };
      return isImageLike(v) ? { src: v.src ?? '', alt: v.alt ?? '' } : v;
    case 'markdown':
      return undefined;
    case 'object':
      if (isAbsent(v)) return childrenToUi((field as { fields: Record<string, Field> }).fields, {});
      return isPlainObject(v) ? childrenToUi((field as { fields: Record<string, Field> }).fields, v) : v;
    case 'items':
      if (isAbsent(v)) return [];
      return Array.isArray(v) ? v.map((item) => itemToUi(field, item)) : v;
  }
}

/** The fields of a list item: the `object`'s fields, or the item's block kind's (`undefined` for an unknown kind). */
function itemFields(field: Field, item: unknown): Record<string, Field> | undefined {
  if (field.type === 'object') return field.fields;
  if (field.type === 'blocks') return blockFields(field, item);
  return undefined;
}

/** A list item's UI value: its children's UI values plus `ITEM_KEY` (and `block`); anything else is kept raw. */
function itemToUi(field: Field, item: unknown): unknown {
  const fields = itemFields(field, item);
  if (!fields || !isPlainObject(item)) return item;
  return { [ITEM_KEY]: newItemKey(), ...childrenToUi(fields, item) };
}

/** UI values of nested fields; a nested `markdown` is a plain string. Keys outside `fields` are kept as they are. */
export function childrenToUi(fields: Record<string, Field>, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, field] of Object.entries(fields)) {
    out[key] = field.type === 'markdown' ? (typeof data[key] === 'string' ? data[key] : '') : toUi(field, data[key]);
  }
  return out;
}

/** The UI value of a new list item: an `object` item, or a block of `kind`. */
export function newItem(field: Field, kind?: string): Record<string, unknown> {
  const data = field.type === 'blocks' && kind !== undefined ? { [BLOCK_KEY]: kind } : {};
  return itemToUi(field, data) as Record<string, unknown>;
}

export function entryToForm(collection: Collection, file: EntryFile): FormValues {
  const values: FormValues = {};
  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type === 'markdown') continue;
    values[key] = toUi(field, file.data[key]);
  }
  values[DRAFT_KEY] = file.data.draft === true;
  if (markdownFieldKey(collection) !== undefined || file.body !== '') values[BODY_KEY] = file.body;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(file.data)) {
    if (key !== DRAFT_KEY && !Object.hasOwn(collection.fields, key)) extra[key] = value;
  }
  values[EXTRA_KEY] = extra;
  return values;
}

/** UI value → entry value; `undefined` means absent. */
function fromUi(field: Field, key: string, v: unknown, issues: Issue[]): unknown {
  switch (kindOf(field)) {
    case 'string':
    case 'boolean':
      return v;
    case 'list':
      return Array.isArray(v) && v.length === 0 ? undefined : v;
    case 'number': {
      if (typeof v !== 'string') return v;
      const text = v.trim();
      if (text === '') return undefined;
      const n = Number(text);
      return Number.isFinite(n) ? n : v;
    }
    case 'json': {
      if (typeof v !== 'string') return v;
      if (v.trim() === '') return undefined;
      try {
        return JSON.parse(v) as unknown;
      } catch {
        issues.push({ path: key, message: 'Invalid JSON' });
        return undefined;
      }
    }
    case 'image':
      if (isImageLike(v)) {
        const src = v.src ?? '';
        const alt = v.alt ?? '';
        return src === '' && alt === '' ? undefined : { src, alt };
      }
      return v;
    case 'markdown':
      return undefined;
    case 'object': {
      if (!isPlainObject(v)) return v;
      const fields = (field as { fields: Record<string, Field> }).fields;
      // An object whose fields are all left empty is not written at all.
      const out = normalizeData({ label: '', fields }, childrenFromUi(fields, key, v, issues));
      return Object.keys(out).length === 0 ? undefined : out;
    }
    case 'items': {
      if (!Array.isArray(v)) return v;
      if (v.length === 0) return undefined;
      return v.map((item, i) => {
        const fields = itemFields(field, item);
        if (!fields || !isPlainObject(item)) return item;
        return childrenFromUi(fields, `${key}.${i}`, item, issues);
      });
    }
  }
}

/** Nested UI values → data; absent children are left out, `ITEM_KEY` is dropped, other keys are kept. */
function childrenFromUi(
  fields: Record<string, Field>,
  at: string,
  values: Record<string, unknown>,
  issues: Issue[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === ITEM_KEY) continue;
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    let next: unknown = value;
    if (field?.type === 'markdown') next = value === '' ? undefined : value;
    else if (field) next = fromUi(field, `${at}.${key}`, value, issues);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

export function formToEntry(
  collection: Collection,
  values: FormValues,
): { data: Record<string, unknown>; body: string; issues: Issue[] } {
  const issues: Issue[] = [];
  const fields: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type === 'markdown') continue;
    const value = fromUi(field, key, values[key], issues);
    if (value !== undefined) fields[key] = value;
  }
  if (values[DRAFT_KEY] === true) fields[DRAFT_KEY] = true;
  // Extra keys go in after `normalizeData`, so an unknown `key: null` is kept as it is.
  const data = normalizeData(collection, fields);
  const extra = values[EXTRA_KEY];
  if (isPlainObject(extra)) {
    for (const [key, value] of Object.entries(extra)) {
      if (key !== DRAFT_KEY && !Object.hasOwn(collection.fields, key) && value !== undefined) data[key] = value;
    }
  }
  const body = typeof values[BODY_KEY] === 'string' ? values[BODY_KEY] : '';
  return { data, body, issues };
}

/** Key order for writing: the file's original keys (still present), then schema order, then `draft`. */
export function serializeEntry(
  collection: Collection,
  data: Record<string, unknown>,
  body: string,
  originalKeyOrder: string[],
): string {
  const order = [...new Set([...originalKeyOrder, ...Object.keys(collection.fields), DRAFT_KEY])].filter((k) =>
    Object.hasOwn(data, k),
  );
  return serializeEntryFile({ data, body }, order);
}

/** Structural equality; object key order does not matter. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

export type DataBody = { data: Record<string, unknown>; body: string };

const lf = (s: string) => s.replace(/\r\n/g, '\n');

export function isEntryChanged(a: DataBody, b: DataBody): boolean {
  return !deepEqual(a.data, b.data) || lf(a.body) !== lf(b.body);
}
