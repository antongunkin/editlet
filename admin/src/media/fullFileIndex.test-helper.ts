// The media index as lazy loading phase 1 built it, from every entry file parsed in full. Tests only: what
// `buildMediaIndex` gives from summaries must stay equal to it (mediaIndex.equivalence.test.ts).

import { allEntryRefs, type MediaImage } from './mediaIndex';

import { findImageRefs, type ImageUse } from '../../../core/assets';
import { isHiddenContentPath, isImagePath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import type { EntryFileData } from '../data/queries';

export type FullFileUse = ImageUse & { entryPath: string; collection: string; slug: string; title: string };

export type FullFileIndex = {
  images: (Omit<MediaImage, 'uses'> & { uses: FullFileUse[] })[];
  folders: string[];
  incomplete: boolean;
};

export function buildFullFileIndex(
  schema: Schema,
  files: FileRef[],
  read: ReadonlyMap<string, EntryFileData | undefined>,
): FullFileIndex {
  const prefix = `${schema.contentDir}/`;
  const images = files
    .filter((f) => f.path.startsWith(prefix) && isImagePath(f.path) && !isHiddenContentPath(schema, f.path))
    .map((f): FullFileIndex['images'][number] => ({
      path: f.path,
      sha: f.sha,
      name: f.path.slice(f.path.lastIndexOf('/') + 1),
      folder: f.path.slice(0, f.path.lastIndexOf('/')),
      uses: [],
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(images.map((i) => [i.path, i]));
  let incomplete = false;
  for (const ref of allEntryRefs(schema, files)) {
    const entry = read.get(ref.path);
    if (!entry) {
      incomplete = true;
      continue;
    }
    const collection = schema.collections[ref.collection]!;
    const titleRaw = collection.titleField === undefined ? undefined : entry.file.data[collection.titleField];
    const title = typeof titleRaw === 'string' && titleRaw.trim() !== '' ? titleRaw : ref.slug;
    for (const use of findImageRefs(schema, collection, ref.path, entry.file.data, entry.file.body)) {
      const image = use.path === null ? undefined : byPath.get(use.path);
      image?.uses.push({ ...use, entryPath: ref.path, collection: ref.collection, slug: ref.slug, title });
    }
  }
  const folders = [...new Set(images.map((i) => i.folder))].toSorted();
  return { images, folders, incomplete };
}
