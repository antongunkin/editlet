import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { SearchEntry } from './match';

import { canReference, countReferrers } from '../../../core/references';
import type { Entry } from '../../../core/validate';
import { entryFileQuery, entryRefs, useFiles, useSchema, type EntryFileData } from '../data/queries';
import { useSource } from '../source/context';
import { useFileStatuses } from '../status/useFileStatus';

const settledOf = (rs: { data: EntryFileData | undefined; status: string }[]) =>
  rs.map((r) => ({ data: r.data, pending: r.status === 'pending', failed: r.status === 'error' }));

export interface SearchEntries {
  entries: SearchEntry[];
  /** Entry files read so far (or failed): the loading line says *Loading titles: 340 of 2,000.* while `loaded < total`. */
  loaded: number;
  total: number;
  /** Entry files that did not load: those rows keep their address (*Some titles did not load.*). */
  failed: number;
}

/**
 * Every entry of every collection with its title and draft flag, from the entry files the admin reads anyway (cached by
 * sha, shared with the collection list and the reference pickers). Reads nothing while `enabled` is false: the search
 * costs nothing until it opens. A title that has not loaded yet is the address, so matching works at once. An entry
 * that can be referenced gets `uses` (who points at it, from the same files) once those files have settled. `loaded`,
 * `total` and `failed` count the reads, for the loading line.
 */
export function useSearchEntries(enabled: boolean): SearchEntries {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const statuses = useFileStatuses();
  const refs = useMemo(
    () =>
      enabled && schema && files.data
        ? Object.keys(schema.collections).flatMap((collection) =>
            entryRefs(schema, files.data, collection).map((ref) => ({ ...ref, collection })),
          )
        : [],
    [enabled, schema, files.data],
  );
  // `combine` keeps the array the same until a read changes, so the memo below does not run on every keystroke.
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)), combine: settledOf });

  // Who points at whom, once every file of the collections that can point has settled (loaded or failed): a count that
  // climbs while files load reads as wrong, and a broken file must not hide counts for good.
  const counts = useMemo(() => {
    if (!schema) return null;
    const settled = new Map<string, boolean>();
    const loaded: Entry[] = [];
    refs.forEach((ref, i) => {
      const result = results[i];
      settled.set(ref.collection, (settled.get(ref.collection) ?? true) && result?.pending !== true);
      const file = result?.data?.file;
      if (file) loaded.push({ collection: ref.collection, slug: ref.slug, data: file.data, body: file.body });
    });
    const defs = Object.entries(schema.collections);
    // The collections an entry of `target` gets a count in: every referring one has settled.
    const ready = new Set(
      defs
        .filter(([target]) => {
          const referring = defs.filter(([, def]) => canReference(def, target));
          return referring.length > 0 && referring.every(([key]) => settled.get(key) ?? true);
        })
        .map(([target]) => target),
    );
    return { ready, by: countReferrers(schema, loaded) };
  }, [schema, refs, results]);

  const entries = refs.map((ref, i): SearchEntry => {
    const definition = schema!.collections[ref.collection]!;
    const data = results[i]?.data?.file.data;
    const raw = definition.titleField === undefined ? undefined : data?.[definition.titleField];
    return {
      collection: ref.collection,
      collectionLabel: definition.label,
      slug: ref.slug,
      // A singleton's address is always `index`: its page is named by the collection.
      title: typeof raw === 'string' && raw.trim() !== '' ? raw : definition.singleton ? definition.label : ref.slug,
      draft: data?.draft === true,
      status: statuses.of(ref.path),
      uses: counts?.ready.has(ref.collection)
        ? (counts.by.get(`${ref.collection}/${ref.slug}`) ?? new Map<string, number>())
        : undefined,
    };
  });
  return {
    entries,
    loaded: results.filter((r) => !r.pending).length,
    total: refs.length,
    failed: results.filter((r) => r.failed).length,
  };
}
