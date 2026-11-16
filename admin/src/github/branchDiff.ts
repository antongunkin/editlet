import { decodeUtf8, parseEntryFile, type EntryFile } from '../../../core/entryFile';
import { EditletError } from '../../../core/issues';
import { isImagePath, parseEntryPath, refKey } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { BranchDiffFile } from '../../../github';
import { entryDiff, type FieldDiffRow } from '../entry/diff';

type Status = BranchDiffFile['status'];

/** One changed CMS file of a branch, ready to show. */
export type FileDiff =
  | { kind: 'entry'; path: string; status: Status; ref: string; rows: FieldDiffRow[] }
  | { kind: 'text'; path: string; status: Status; before: string; after: string }
  | { kind: 'binary'; path: string; status: Status; image: boolean };

/** UTF-8 text of `bytes` (`''` when absent), or `undefined` when it does not decode. */
function textOf(bytes: Uint8Array | null, path: string): string | undefined {
  if (bytes === null) return '';
  const decoded = decodeUtf8(bytes, path);
  return 'text' in decoded ? decoded.text : undefined;
}

/** The parsed entry (`null` when absent), or `undefined` when it does not parse. */
function entryOf(bytes: Uint8Array | null, text: string): EntryFile | null | undefined {
  if (bytes === null) return null;
  try {
    return parseEntryFile(text);
  } catch (error) {
    if (error instanceof EditletError) return undefined;
    throw error;
  }
}

/**
 * `before` is the merge-base side (`null` = added), `after` the branch side (`null` = removed). A raster image (not
 * SVG) → binary. An entry path whose present sides both parse → per-field rows; else text when both sides decode as
 * UTF-8; else binary.
 */
export function fileDiff(
  schema: Schema,
  path: string,
  status: Status,
  before: Uint8Array | null,
  after: Uint8Array | null,
): FileDiff {
  // Raster images are binary even when their bytes happen to decode; SVG is text.
  if (isImagePath(path) && !path.toLowerCase().endsWith('.svg')) return { kind: 'binary', path, status, image: true };
  const beforeText = textOf(before, path);
  const afterText = textOf(after, path);
  if (beforeText === undefined || afterText === undefined) {
    return { kind: 'binary', path, status, image: isImagePath(path) };
  }
  const entry = parseEntryPath(schema, path);
  if (entry) {
    const prev = entryOf(before, beforeText);
    const next = entryOf(after, afterText);
    if (prev !== undefined && next !== undefined) {
      const rows = entryDiff(schema.collections[entry.collection]!, prev, next ?? { data: {}, body: '' });
      return { kind: 'entry', path, status, ref: refKey(entry.collection, entry.slug), rows };
    }
  }
  return { kind: 'text', path, status, before: beforeText, after: afterText };
}
