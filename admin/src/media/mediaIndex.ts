import type { QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { isHiddenContentPath, isImagePath, parseEntryPath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { ContentSource, FileRef } from '../../../core/source';
import { resolveSummaryImages, type EntrySummary, type SummaryImageUse } from '../../../core/summary';
import type { GitHubCache } from '../../../github';
import { entryFileQuery, useFiles, type EntryFileData } from '../data/queries';
import { fingerprintsQuery, summariesQuery, useSummaries } from '../data/summaries';
import { filesKey } from '../source/context';

/**
 * One place an entry uses an image, with the entry it is in. It comes from the entry's summary, so it has no body
 * ranges: a rewrite finds them in the full file (`entryEdits`).
 */
export type MediaUse = SummaryImageUse & { entryPath: string; collection: string; slug: string; title: string };

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
  /** The listed sha of every entry in the index, by path: what a rewrite reads and commits against. */
  shas: ReadonlyMap<string, string>;
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
 * The usage index: every listed image under contentDir with the entries that use it (image fields and body images, from
 * their summaries). `summaries` gives the entries summarized so far, by path; an entry missing from it makes the index
 * `incomplete`.
 */
export function buildMediaIndex(
  schema: Schema,
  files: FileRef[],
  summaries: ReadonlyMap<string, EntrySummary | undefined>,
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
  const shas = new Map<string, string>();
  let incomplete = false;
  for (const ref of allEntryRefs(schema, files)) {
    const summary = summaries.get(ref.path);
    if (!summary) {
      incomplete = true;
      continue;
    }
    shas.set(ref.path, ref.sha);
    const title = summary.title ?? ref.slug;
    for (const use of resolveSummaryImages(schema, ref.path, summary)) {
      const image = use.path === null ? undefined : byPath.get(use.path);
      image?.uses.push({ ...use, entryPath: ref.path, collection: ref.collection, slug: ref.slug, title });
    }
  }
  const folders = [...new Set(images.map((i) => i.folder))].toSorted();
  return { images, folders, shas, incomplete };
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

/** The usage index over the listed files, from the summary of every entry (`data/summaries.ts`). */
export function useMediaIndex(schema: Schema): MediaIndex | undefined {
  const files = useFiles();
  const refs = useMemo(() => (files.data ? allEntryRefs(schema, files.data) : []), [schema, files.data]);
  const { rows } = useSummaries(refs);
  const listed = files.data;
  return useMemo(() => {
    if (!listed) return undefined;
    return buildMediaIndex(schema, listed, new Map(refs.map((ref, i) => [ref.path, rows[i]])));
  }, [schema, listed, refs, rows]);
}

/**
 * A fresh index (the file list read now, and a summary of every entry in it), for the check right before a delete or an
 * alt text: an unchanged entry costs no read. `cache` keeps the summaries (GitHub mode; `null` in dev mode).
 */
export async function loadMediaIndex(
  client: QueryClient,
  source: ContentSource,
  schema: Schema,
  cache: GitHubCache | null,
): Promise<MediaIndex> {
  const files = await client.fetchQuery({
    queryKey: filesKey(source),
    queryFn: () => source.listFiles(),
    staleTime: 0,
  });
  const refs = allEntryRefs(schema, files);
  const fingerprints = await client.fetchQuery(fingerprintsQuery(schema));
  // One batch for all of them, so the kept summaries and the file reads go out in batches.
  const batch = await client.fetchQuery(summariesQuery(source, cache, client, refs, schema, fingerprints));
  const [error] = batch.errors.values();
  if (error) throw error;
  const summaries = refs.map(
    (ref) => [ref.path, batch.rows.get(`${ref.sha}:${fingerprints.get(ref.collection)!}`)] as const,
  );
  return buildMediaIndex(schema, files, new Map(summaries));
}

/** The listed files of the entries `uses` are in, once each: what a rewrite of those uses reads. */
export function entriesOf(index: MediaIndex, uses: MediaUse[]): FileRef[] {
  return [...new Set(uses.map((u) => u.entryPath))].map((path) => ({ path, sha: index.shas.get(path)! }));
}

/**
 * The full files of `refs`, by path, read right before a rewrite at the shas the index listed. A file that moved since
 * then keeps its listed sha here, so the commit's sha check refuses it.
 */
export async function readEntryFiles(
  client: QueryClient,
  source: ContentSource,
  refs: FileRef[],
): Promise<Map<string, EntryFileData>> {
  return new Map(
    await Promise.all(
      refs.map(async (ref) => [ref.path, await client.fetchQuery(entryFileQuery(source, ref))] as const),
    ),
  );
}
