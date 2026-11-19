import { useQueries, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { findImageRefs, type ImageUse } from '../../../core/assets';
import { isHiddenContentPath, isImagePath, parseEntryPath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { ContentSource, FileRef } from '../../../core/source';
import { entryFileQuery, useFiles, type EntryFileData } from '../data/queries';
import { filesKey, useSource } from '../source/context';

/** One place an entry uses an image, with the entry it is in. */
export type MediaUse = ImageUse & { entryPath: string; collection: string; slug: string; title: string };

export type MediaImage = {
  path: string;
  sha: string;
  /** The file name (last path segment). */
  name: string;
  /** The folder it is in, without a trailing slash. */
  folder: string;
  uses: MediaUse[];
};

export type MediaIndex = {
  /** Image files under contentDir (hidden ones skipped), sorted by path. */
  images: MediaImage[];
  /** Folders that hold images, sorted. */
  folders: string[];
  /** Entry files by path, as read (for rewriting alt and src). */
  entries: Map<string, EntryFileData>;
  /** Some entries are not read yet (or failed to read): uses may be missing, so nothing counts as unused. */
  incomplete: boolean;
};

export type MediaFilter = 'all' | 'used' | 'unused' | 'missing-alt';

/** Where uploads from the Media screen go when no folder is picked. */
export const mediaFolder = (schema: Schema) => `${schema.contentDir}/media`;

const folderOf = (path: string) => path.slice(0, path.lastIndexOf('/'));

/** Listed entry files of every collection (hidden paths skipped). */
export function allEntryRefs(schema: Schema, files: FileRef[]): (FileRef & { collection: string; slug: string })[] {
  const out: (FileRef & { collection: string; slug: string })[] = [];
  for (const ref of files) {
    if (isHiddenContentPath(schema, ref.path)) continue;
    const parsed = parseEntryPath(schema, ref.path);
    if (parsed) out.push({ ...ref, ...parsed });
  }
  return out;
}

/**
 * The usage index: every listed image under contentDir with the entries that use it (image fields and body images,
 * `findImageRefs`). `read` gives the entry files read so far; entries missing from it make the index `incomplete`.
 */
export function buildMediaIndex(
  schema: Schema,
  files: FileRef[],
  read: ReadonlyMap<string, EntryFileData | undefined>,
): MediaIndex {
  const prefix = `${schema.contentDir}/`;
  const images = files
    .filter((f) => f.path.startsWith(prefix) && isImagePath(f.path) && !isHiddenContentPath(schema, f.path))
    .map((f): MediaImage => ({
      path: f.path,
      sha: f.sha,
      name: f.path.slice(f.path.lastIndexOf('/') + 1),
      folder: folderOf(f.path),
      uses: [],
    }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(images.map((i) => [i.path, i]));
  const entries = new Map<string, EntryFileData>();
  let incomplete = false;
  for (const ref of allEntryRefs(schema, files)) {
    const entry = read.get(ref.path);
    if (!entry) {
      incomplete = true;
      continue;
    }
    entries.set(ref.path, entry);
    const collection = schema.collections[ref.collection]!;
    const titleRaw = collection.titleField === undefined ? undefined : entry.file.data[collection.titleField];
    const title = typeof titleRaw === 'string' && titleRaw.trim() !== '' ? titleRaw : ref.slug;
    for (const use of findImageRefs(schema, collection, ref.path, entry.file.data, entry.file.body)) {
      const image = use.path === null ? undefined : byPath.get(use.path);
      image?.uses.push({ ...use, entryPath: ref.path, collection: ref.collection, slug: ref.slug, title });
    }
  }
  const folders = [...new Set(images.map((i) => i.folder))].toSorted();
  return { images, folders, entries, incomplete };
}

export const isUsed = (image: MediaImage) => image.uses.length > 0;
export const hasMissingAlt = (image: MediaImage) => image.uses.some((u) => u.alt.trim() === '');
/** The uses of an image whose alt text is blank (the alt queue writes its one text into these only). */
export const blankUses = (image: MediaImage | undefined): MediaUse[] =>
  image?.uses.filter((u) => u.alt.trim() === '') ?? [];

export function matchesFilter(image: MediaImage, filter: MediaFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'used':
      return isUsed(image);
    case 'unused':
      return !isUsed(image);
    case 'missing-alt':
      return hasMissingAlt(image);
  }
}

/** Case-insensitive search over the path and the alt texts. */
export function matchesQuery(image: MediaImage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return image.path.toLowerCase().includes(q) || image.uses.some((u) => u.alt.toLowerCase().includes(q));
}

export function filterCounts(images: MediaImage[]): Record<MediaFilter, number> {
  return {
    all: images.length,
    used: images.filter(isUsed).length,
    unused: images.filter((i) => !isUsed(i)).length,
    'missing-alt': images.filter(hasMissingAlt).length,
  };
}

const dataOf = (rs: { data: EntryFileData | undefined }[]) => rs.map((r) => r.data);

/** The usage index over the listed files, reading every entry through the shared entry-file cache (by sha). */
export function useMediaIndex(schema: Schema): MediaIndex | undefined {
  const source = useSource();
  const files = useFiles();
  const refs = useMemo(() => (files.data ? allEntryRefs(schema, files.data) : []), [schema, files.data]);
  const results = useQueries({
    queries: refs.map((ref) => entryFileQuery(source, ref)),
    combine: dataOf,
  });
  const listed = files.data;
  return useMemo(() => {
    if (!listed) return undefined;
    const read = new Map(refs.map((ref, i) => [ref.path, results[i]]));
    return buildMediaIndex(schema, listed, read);
  }, [schema, listed, refs, results]);
}

/** A fresh index (file list and entries read now), for the check right before a delete. */
export async function loadMediaIndex(client: QueryClient, source: ContentSource, schema: Schema): Promise<MediaIndex> {
  const files = await client.fetchQuery({
    queryKey: filesKey(source),
    queryFn: () => source.listFiles(),
    staleTime: 0,
  });
  const refs = allEntryRefs(schema, files);
  const read = await Promise.all(refs.map((ref) => client.fetchQuery(entryFileQuery(source, ref))));
  return buildMediaIndex(schema, files, new Map(refs.map((ref, i) => [ref.path, read[i]])));
}
