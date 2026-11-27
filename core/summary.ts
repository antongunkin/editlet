// Entry summaries (docs/core/summary.md): what a list knows about an entry, derived once per blob sha and schema
// fingerprint. Pure: Web APIs only. The one place that decides what a summary holds.

import { findImageRefs, type ImageUse } from './assets';
import type { EntryFile } from './entryFile';
import { entryFilePath, parseRefKey, resolveAssetPath } from './paths';
import { entryReferences, matchReferrers, tallyReferrers, type EntryRefs } from './references';
import type { Schema } from './schema';
import { validateEntry } from './validate';

export const SUMMARY_VERSION = 1;

export interface EntrySummary {
  v: typeof SUMMARY_VERSION;
  /** `titleField`'s value when it is a non-empty string, else `null` (the row shows the slug, or a singleton's label). */
  title: string | null;
  draft: boolean;
  /** `entryReferences` (`core/references.ts`): every `collection/slug` value, with its dot path. */
  refs: { field: string; ref: string }[];
  /** `findImageRefs` (`core/assets.ts`) without the path-dependent parts: `path` and `body` ranges are left out. */
  images: { field: string; at?: (string | number)[]; label?: string; src: string; alt: string }[];
  /** How many `validateEntry` issues the file has with no ctx: schema and file only, never existence. */
  issues: number;
}

/** An image of a summary with `src` resolved for one entry path: `ImageUse` without the `body` ranges. */
export type SummaryImageUse = Omit<ImageUse, 'body'>;

/**
 * The summary of one entry file of `collection`. Nothing in it depends on the entry's slug or path, because it is kept
 * by blob sha and two files can share a blob. So `issues` never includes `validateEntry`'s slug rule: a caller that
 * needs it checks the slug of the path. A collection the schema lacks gives an empty summary with that one issue.
 */
export function summarizeEntry(schema: Schema, collection: string, file: EntryFile): EntrySummary {
  const { data, body } = file;
  const def = Object.hasOwn(schema.collections, collection) ? schema.collections[collection] : undefined;
  const raw = def?.titleField === undefined ? undefined : data[def.titleField];
  // `index` passes the slug rule of a singleton and of any other collection.
  const issues = validateEntry(schema, { collection, slug: 'index', data, body }, {}).length;
  // Only `path` depends on the entry path, and it is left out: any path in the collection will do.
  const images = def ? findImageRefs(schema, def, entryFilePath(schema, collection, 'index'), data, body) : [];
  return {
    v: SUMMARY_VERSION,
    title: typeof raw === 'string' && raw.trim() !== '' ? raw : null,
    draft: data.draft === true,
    refs: def ? entryReferences(def, data) : [],
    images: images.map(({ field, at, label, src, alt }) => ({
      field,
      ...(at === undefined ? {} : { at }),
      ...(label === undefined ? {} : { label }),
      src,
      alt,
    })),
    issues,
  };
}

/** JSON with the keys of every object sorted, so the same value always gives the same text. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

const encoder = new TextEncoder();

/**
 * SHA-1 hex (16 chars) of `SUMMARY_VERSION`, the collection's definition and every top-level schema key but
 * `collections`. `object` and `blocks` fields are inline in the definition and a summary reads no other collection, so
 * a change elsewhere keeps the fingerprint. Keys are sorted: reordering fields keeps it too.
 */
export async function summaryFingerprint(schema: Schema, collection: string): Promise<string> {
  const { collections, ...rest } = schema;
  const def = Object.hasOwn(collections, collection) ? collections[collection] : null;
  const text = stableJson({ v: SUMMARY_VERSION, collection: def, rest });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', encoder.encode(text)));
  return Array.from(digest.subarray(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The summary's images for the entry at `entryPath`: the same `path` values `findImageRefs` gives for that path. */
export function resolveSummaryImages(schema: Schema, entryPath: string, summary: EntrySummary): SummaryImageUse[] {
  return summary.images.map((image) => ({ ...image, path: resolveAssetPath(schema, entryPath, image.src) }));
}

/**
 * The entries a delete can give a new issue to, when the schema stays: of `rows`, the paths whose summary names an entry
 * whose file is in `deleted` (`validateEntry`'s `entryExists`) or has an `image` field resolving to a path in `deleted`
 * (`fileExists`). Nothing else of an entry depends on other files, and body and Markdown images are not validated. The
 * caller leaves the batch's own paths out of `rows`.
 */
export function deleteSuspects(
  schema: Schema,
  rows: Iterable<SummaryRow & { path: string }>,
  deleted: ReadonlySet<string>,
): Set<string> {
  const refDeleted = ({ ref }: { ref: string }) => {
    const target = parseRefKey(ref);
    return target !== null && deleted.has(entryFilePath(schema, target.collection, target.slug));
  };
  const out = new Set<string>();
  for (const { path, collection, summary } of rows) {
    const fields = Object.hasOwn(schema.collections, collection) ? schema.collections[collection].fields : {};
    // TODO: share `mayBeImageField` (`admin/src/model/problems.ts`) from core, to leave nested Markdown images out too.
    // Until then every nested image counts: a suspect too many costs one read, a missed one lets a broken delete in.
    const inImageField = ({ field, at = [field] }: SummaryImageUse) =>
      at.length > 1 || fields[at[0]!]?.type === 'image';
    const broken =
      summary.refs.some(refDeleted) ||
      resolveSummaryImages(schema, path, summary).some(
        (image) => image.path !== null && deleted.has(image.path) && inImageField(image),
      );
    if (broken) out.add(path);
  }
  return out;
}

/** One listed entry with its summary. */
export interface SummaryRow {
  collection: string;
  slug: string;
  summary: EntrySummary;
}

const toRefs = (row: SummaryRow): EntryRefs => ({ collection: row.collection, refs: row.summary.refs });

/** `countReferrers` (`core/references.ts`) from summaries. */
export function countReferrersFromSummaries(
  schema: Schema,
  rows: Iterable<SummaryRow>,
): Map<string, Map<string, number>> {
  return tallyReferrers(schema, Array.from(rows, toRefs));
}

/** `findReferrers` (`core/references.ts`) from summaries: `entry` is the row. */
export function findReferrersFromSummaries<R extends SummaryRow>(
  schema: Schema,
  rows: Iterable<R>,
  ref: string,
): { entry: R; fields: string[] }[] {
  const refsOf = (r: R) => (Object.hasOwn(schema.collections, r.collection) ? r.summary.refs : undefined);
  return matchReferrers(rows, refsOf, ref).map(({ item, fields }) => ({ entry: item, fields }));
}
