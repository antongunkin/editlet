import { useMemo } from 'react';

import type { SearchEntry } from './match';

import { canReference } from '../../../core/references';
import { countReferrersFromSummaries, type SummaryRow } from '../../../core/summary';
import { entryRefs, useFiles, useSchema } from '../data/queries';
import { useSummaries, type SummaryRef } from '../data/summaries';
import { useFileStatuses } from '../status/useFileStatus';

const NO_REFS: SummaryRef[] = [];

export interface SearchEntries {
  entries: SearchEntry[];
  /** Entries summarized so far (or failed): the loading line says *Loading titles: 340 of 2,000.* while `loaded < total`. */
  loaded: number;
  total: number;
  /** Entry files that did not load: those rows keep their address (*Some titles did not load.*). */
  failed: number;
}

/**
 * Every entry of every collection with its title and draft flag, from entry summaries (`data/summaries.ts`, shared with
 * the collection list and the reference pickers). `list` lists them from the file list alone (nothing while false);
 * `read` asks for their summaries, so the search costs no file until something is typed. A title that has not loaded
 * yet is the address, so matching works at once. An entry that can be referenced gets `uses` (who points at it, from
 * the same summaries) once those have settled. `loaded`, `total` and `failed` count the summaries asked for, for the
 * loading line.
 */
export function useSearchEntries(list: boolean, read: boolean): SearchEntries {
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const statuses = useFileStatuses();
  const refs = useMemo(
    () =>
      list && schema && files.data
        ? Object.keys(schema.collections).flatMap((collection) =>
            entryRefs(schema, files.data, collection).map((ref) => ({ ...ref, collection })),
          )
        : [],
    [list, schema, files.data],
  );
  // The result stays the same object until a summary changes, so the memo below does not run on every keystroke.
  const summaries = useSummaries(read ? refs : NO_REFS);

  // Who points at whom, once every entry of the collections that can point has settled (loaded or failed): a count that
  // climbs while files load reads as wrong, and a broken file must not hide counts for good.
  const counts = useMemo(() => {
    if (!schema || !read) return null;
    const settled = new Map<string, boolean>();
    const loaded: SummaryRow[] = [];
    refs.forEach((ref, i) => {
      const summary = summaries.rows[i];
      const done = summary !== undefined || summaries.errors[i] !== null;
      settled.set(ref.collection, (settled.get(ref.collection) ?? true) && done);
      if (summary) loaded.push({ collection: ref.collection, slug: ref.slug, summary });
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
    return { ready, by: countReferrersFromSummaries(schema, loaded) };
  }, [schema, read, refs, summaries]);

  const entries = refs.map((ref, i): SearchEntry => {
    const definition = schema!.collections[ref.collection]!;
    const summary = summaries.rows[i];
    return {
      collection: ref.collection,
      collectionLabel: definition.label,
      slug: ref.slug,
      // A singleton's address is always `index`: its page is named by the collection.
      title: summary?.title ?? (definition.singleton ? definition.label : ref.slug),
      draft: summary?.draft === true,
      status: statuses.of(ref.path),
      uses: counts?.ready.has(ref.collection)
        ? (counts.by.get(`${ref.collection}/${ref.slug}`) ?? new Map<string, number>())
        : undefined,
    };
  });
  return { entries, loaded: summaries.loaded, total: summaries.total, failed: summaries.failed };
}
