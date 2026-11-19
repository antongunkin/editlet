import { resolveAssetPath } from '../../../core/paths';
import { markdownFieldKey, type Field, type Schema } from '../../../core/schema';
import type { PreviewSnapshot, PreviewValue } from '../../../loader/protocol';
import { deepEqual, type DataBody } from '../entry/values';

export type { DataBody };

type EntryPreviews = Record<string, PreviewValue>;

const STALE: PreviewValue = { stale: true };

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function isImage(v: unknown): v is { src: string; alt?: string } {
  return typeof v === 'object' && v !== null && typeof (v as { src?: unknown }).src === 'string';
}

function textKind(f: Field): boolean {
  switch (f.type) {
    case 'string':
      return !f.list;
    case 'select':
      return !f.multiple;
    case 'text':
    case 'url':
    case 'color':
    case 'datetime':
    case 'number':
      return true;
    default:
      return false;
  }
}

async function imagePreview(
  schema: Schema,
  entryFile: string,
  before: unknown,
  after: unknown,
  readImage: (assetPath: string) => Promise<Blob | null>,
): Promise<PreviewValue> {
  if (!isImage(after)) return STALE;
  const afterPath = resolveAssetPath(schema, entryFile, after.src);
  if (afterPath === null) return STALE;
  const blob = await readImage(afterPath);
  if (blob === null) return STALE;
  const prefix = `${schema.contentDir}/`;
  let from = '';
  if (isImage(before)) {
    const p = resolveAssetPath(schema, entryFile, before.src);
    if (p !== null) from = p.slice(prefix.length);
  }
  const alt = { from: isImage(before) ? str(before.alt) : '', to: str(after.alt) };
  return alt.from !== alt.to ? { image: { from, to: blob, alt } } : { image: { from, to: blob } };
}

const lf = (s: string) => s.replace(/\r\n/g, '\n');

/**
 * Preview values for the fields that differ between `before` and `after` (every field when `before` is `null`, a new
 * entry: `from` is then `''`). `readImage` receives the REPO path of the new asset (the `resolveAssetPath` result,
 * including the `contentDir` prefix), i.e. what `source.readFile` expects. The image `from` is the content-relative
 * path of the old asset (without `contentDir/`).
 */
export async function fieldPreviews(
  schema: Schema,
  collection: string,
  entryFile: string,
  before: DataBody | null,
  after: DataBody,
  readImage: (assetPath: string) => Promise<Blob | null>,
): Promise<EntryPreviews> {
  const def = schema.collections[collection];
  const prev = before ?? { data: {}, body: '' };
  const out: EntryPreviews = {};

  if (lf(prev.body) !== lf(after.body)) out[markdownFieldKey(def) ?? 'body'] = STALE;

  for (const [key, field] of Object.entries(def.fields)) {
    if (field.type === 'markdown') continue;
    const a = prev.data[key];
    const b = after.data[key];
    if (deepEqual(a, b)) continue;
    if (textKind(field)) out[key] = { text: { from: str(a), to: str(b) } };
    else if (field.type === 'image') out[key] = await imagePreview(schema, entryFile, a, b, readImage);
    else out[key] = STALE;
  }
  return out;
}

/** A form value overrides the branch value per field, but keeps the branch `from` for `text` and `image`. */
export function mergePreviews(
  branch: Record<string, EntryPreviews>,
  form: Record<string, EntryPreviews>,
): Record<string, EntryPreviews> {
  const out: Record<string, EntryPreviews> = {};
  for (const k of Object.keys(branch)) out[k] = { ...branch[k] };
  for (const [entry, fields] of Object.entries(form)) {
    const target = (out[entry] ??= {});
    for (const [key, value] of Object.entries(fields)) {
      const old = target[key];
      if ('text' in value && old && 'text' in old) target[key] = { text: { from: old.text.from, to: value.text.to } };
      else if ('image' in value && old && 'image' in old)
        target[key] = { image: { ...value.image, from: old.image.from } };
      else target[key] = value;
    }
  }
  return out;
}

export function buildSnapshot(
  branch: string,
  entries: Record<string, EntryPreviews>,
  sessionMinutes: number,
  now: number = Date.now(),
): PreviewSnapshot {
  return { v: 1, branch, expiresAt: now + sessionMinutes * 60_000, entries };
}
