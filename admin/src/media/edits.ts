import type { MediaImage, MediaIndex, MediaUse } from './mediaIndex';
import { sanitizeSvg } from './svg';

import { applyImageEdits } from '../../../core/assets';
import { decodeUtf8 } from '../../../core/entryFile';
import { isImagePath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import { relativeSrc, uniqueAssetPath } from '../entry/changes';
import { serializeEntry } from '../entry/values';
import type { SourceChange } from '../source/local';

/** Largest image the admin uploads: below GitHub's 10 MB limit for reading a blob back through GraphQL. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
/**
 * Largest sum of new file bytes in one commit of an upload series: about 13.3 MB as base64, under the ~16 MB request
 * size at which GitHub drops a `createCommitOnBranch` call.
 */
export const MAX_BATCH_BYTES = 10 * 1024 * 1024;
/** Uploads above this size get a note: every version of a file stays in the repository's history. */
export const LARGE_IMAGE_BYTES = 2 * 1024 * 1024;

const extOf = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase();

/** Why a file cannot be uploaded as an image, or `null` when it can. */
export function imageFileError(file: { name: string; size: number }): string | null {
  if (!isImagePath(file.name)) return `${file.name}: only image files can be uploaded`;
  if (file.size > MAX_IMAGE_BYTES) return `${file.name}: images larger than 8 MB are not uploaded`;
  return null;
}

function readBytes(file: File): Promise<ArrayBuffer> {
  return typeof file.arrayBuffer === 'function' ? file.arrayBuffer() : new Response(file).arrayBuffer();
}

/** The bytes to commit for an image file; an SVG is cleaned of scripts first (`sanitizeSvg`). */
export async function imageBytes(file: File): Promise<Uint8Array> {
  const bytes = new Uint8Array(await readBytes(file));
  if (extOf(file.name) !== 'svg') return bytes;
  const decoded = decodeUtf8(bytes, file.name);
  if ('issue' in decoded) throw new Error(`${file.name}: not a valid SVG file`);
  try {
    return new TextEncoder().encode(sanitizeSvg(decoded.text));
  } catch {
    throw new Error(`${file.name}: not a valid SVG file`);
  }
}

/** New files in `folder`, named like the uploads with `-2`, `-3`… when a name is taken. */
export function uploadChanges(
  listed: Iterable<string>,
  folder: string,
  files: { name: string; bytes: Uint8Array }[],
): (SourceChange & { content: Uint8Array })[] {
  const taken = new Set(listed);
  return files.map(({ name, bytes }) => {
    const path = uniqueAssetPath(taken, folder, name);
    taken.add(path);
    return { path, content: bytes, sha: null };
  });
}

/** Splits new files into commits of at most `MAX_BATCH_BYTES` (one file per commit when a file alone is larger). */
export function batchBySize<T extends { content: Uint8Array }>(changes: T[], max = MAX_BATCH_BYTES): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const change of changes) {
    const bytes = change.content.byteLength;
    if (current.length > 0 && size + bytes > max) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(change);
    size += bytes;
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** A change to one use: a new alt and/or src. */
export type UseEdit = { use: MediaUse; alt?: string; src?: string };

/**
 * The entry files rewritten for `edits`: image fields get the new `alt`/`src` in their data (at any depth), images in
 * the body or in a nested Markdown string are changed in place (`editBodyImages`, every other byte kept). One change
 * per entry, with the sha it was read at.
 */
export function entryEdits(schema: Schema, index: MediaIndex, edits: UseEdit[]): SourceChange[] {
  const byEntry = new Map<string, UseEdit[]>();
  for (const edit of edits) byEntry.set(edit.use.entryPath, [...(byEntry.get(edit.use.entryPath) ?? []), edit]);
  const out: SourceChange[] = [];
  for (const [path, list] of byEntry) {
    const entry = index.entries.get(path);
    if (!entry) throw new Error(`${path} is not loaded`);
    const collection = schema.collections[list[0]!.use.collection]!;
    const { data, body } = applyImageEdits(entry.file.data, entry.file.body, list);
    out.push({ path, content: serializeEntry(collection, data, body, entry.keyOrder), sha: entry.sha });
  }
  return out;
}

/**
 * Replacing an image with another file: the same extension overwrites it (sha-checked, so every use sees the new
 * one); another extension adds a new file next to it, deletes the old one and points every use at the new path.
 */
export function replaceChanges(
  schema: Schema,
  index: MediaIndex,
  image: MediaImage,
  file: { name: string; bytes: Uint8Array },
): { changes: SourceChange[]; path: string } {
  if (extOf(file.name) === extOf(image.path)) {
    return { changes: [{ path: image.path, content: file.bytes, sha: image.sha }], path: image.path };
  }
  if (index.incomplete)
    throw new Error('Not every entry could be read, so not every use can be pointed at the new file');
  const base = image.name.slice(0, image.name.lastIndexOf('.'));
  const listed = new Set(index.images.map((i) => i.path));
  listed.delete(image.path);
  const path = uniqueAssetPath(listed, image.folder, `${base}.${extOf(file.name)}`);
  const rewrites = entryEdits(
    schema,
    index,
    image.uses.map((use) => ({ use, src: relativeSrc(use.entryPath, path) })),
  );
  return {
    changes: [
      { path, content: file.bytes, sha: null },
      { path: image.path, content: null, sha: image.sha },
      ...rewrites,
    ],
    path,
  };
}

/** Deletes `images`; refuses (throws) when one of them is used by an entry in `index`. */
export function deleteChanges(index: MediaIndex, paths: string[]): SourceChange[] {
  if (index.incomplete) throw new Error('Not every entry could be read, so images in use cannot be told apart');
  const byPath = new Map(index.images.map((i) => [i.path, i]));
  return paths.map((path) => {
    const image = byPath.get(path);
    if (!image) throw new Error(`${path} is not in the repository any more`);
    if (image.uses.length > 0) throw new Error(`${path} is used by ${image.uses[0]!.entryPath}`);
    return { path, content: null, sha: image.sha };
  });
}
