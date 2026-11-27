// Test only, imported by no source: the phase 1 list hooks, which read and parse every entry file they cover, kept as
// they were. `summaryEquivalence.test.tsx` holds the hooks over entry summaries to their rows.

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  entryFileQuery,
  entryRefs,
  useFiles,
  useSchema,
  type EntryFileData,
  type EntryListItem,
  type EntryOption,
  type Loadable,
  type PlanFile,
  type ReferrerItem,
} from './queries';

import { canReference, countReferrers, findReferrers } from '../../../core/references';
import type { Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import type { Entry } from '../../../core/validate';
import type { SearchEntry } from '../search/match';
import type { SearchEntries } from '../search/useSearchEntries';
import { useSource } from '../source/context';
import { useFileStatuses } from '../status/useFileStatus';

export function useEntriesFromFiles(collection: string): Loadable<EntryListItem[]> {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema();
  const refs = useMemo(
    () => (schema.data && files.data ? entryRefs(schema.data.schema, files.data, collection) : []),
    [schema.data, files.data, collection],
  );
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)) });

  const error = (files.data ? null : files.error) ?? schema.error;
  if (error) return { data: undefined, error, isPending: false };
  if (!schema.data || !files.data || results.some((r) => r.isPending)) {
    return { data: undefined, error: null, isPending: true };
  }
  const titleField = schema.data.schema.collections[collection]?.titleField;
  // Full files give every title and draft flag: none is `null` here.
  const items = refs.map((ref, i): EntryListItem & { title: string } => {
    const data = results[i]?.data?.file.data;
    const raw = titleField === undefined ? undefined : data?.[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : ref.slug;
    return { slug: ref.slug, path: ref.path, sha: ref.sha, title, draft: data?.draft === true };
  });
  items.sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
  return { data: items, error: null, isPending: false };
}

type CollectionRef = FileRef & { slug: string; collection: string };

function useTitledFromFiles(schema: Schema | undefined, refs: CollectionRef[]) {
  const source = useSource();
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)) });
  const options = refs.map((ref, i) => {
    const titleField = schema?.collections[ref.collection]?.titleField;
    const raw = titleField === undefined ? undefined : results[i]?.data?.file.data[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : ref.slug;
    return { ref: `${ref.collection}/${ref.slug}`, title };
  });
  return { options, pending: results.some((r) => r.isPending) };
}

export function useEntryOptionsFromFiles(collections: string[]): { options: EntryOption[]; pending: boolean } {
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const key = collections.join('\0');
  const refs = useMemo(() => {
    if (!schema || !files.data) return [];
    return key
      .split('\0')
      .filter((c) => c !== '' && Object.hasOwn(schema.collections, c))
      .flatMap((c) => entryRefs(schema, files.data, c).map((ref) => ({ ...ref, collection: c })));
  }, [schema, files.data, key]);
  const { options, pending } = useTitledFromFiles(schema, refs);
  const order = new Map(refs.map((r, i) => [r.collection, i]));
  const rank = (ref: string) => order.get(ref.slice(0, ref.indexOf('/'))) ?? 0;
  options.sort((a, b) => rank(a.ref) - rank(b.ref) || a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref));
  return { options, pending: pending || (key !== '' && (!schema || !files.data)) };
}

export function useEntryTitlesFromFiles(values: string[]): Map<string, string> {
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const key = [...new Set(values)].toSorted().join('\0');
  const refs = useMemo(() => {
    if (!schema || !files.data) return [];
    const named = new Set(key.split('\0'));
    return [...new Set([...named].map((r) => r.slice(0, r.indexOf('/'))))]
      .filter((c) => Object.hasOwn(schema.collections, c))
      .flatMap((c) => entryRefs(schema, files.data, c).map((ref) => ({ ...ref, collection: c })))
      .filter((r) => named.has(`${r.collection}/${r.slug}`));
  }, [schema, files.data, key]);
  const { options } = useTitledFromFiles(schema, refs);
  return new Map(options.map((o) => [o.ref, o.title]));
}

export function useReferrersFromFiles(ref: string): Loadable<ReferrerItem[]> {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema();
  const target = ref.slice(0, ref.indexOf('/'));
  const refs = useMemo(() => {
    if (!schema.data || !files.data) return [];
    const s = schema.data.schema;
    return Object.entries(s.collections)
      .filter(([, def]) => canReference(def, target))
      .flatMap(([c]) => entryRefs(s, files.data, c).map((r) => ({ ...r, collection: c })));
  }, [schema.data, files.data, target]);
  const results = useQueries({ queries: refs.map((r) => entryFileQuery(source, r)) });

  const error = (files.data ? null : files.error) ?? schema.error ?? results.find((r) => r.error)?.error ?? null;
  if (error) return { data: undefined, error, isPending: false };
  if (!schema.data || !files.data || results.some((r) => r.isPending)) {
    return { data: undefined, error: null, isPending: true };
  }
  const s = schema.data.schema;
  const entries = refs.map((r, i): PlanFile => {
    const { file, sha, keyOrder } = results[i]!.data!;
    return { collection: r.collection, slug: r.slug, data: file.data, body: file.body, path: r.path, sha, keyOrder };
  });
  const items = findReferrers(s, entries, ref).map(({ entry, fields }): ReferrerItem => {
    const titleField = s.collections[entry.collection]?.titleField;
    const raw = titleField === undefined ? undefined : entry.data[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : entry.slug;
    return { ref: `${entry.collection}/${entry.slug}`, title, fields, entry };
  });
  items.sort((a, b) => a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref));
  return { data: items, error: null, isPending: false };
}

const settledOf = (rs: { data: EntryFileData | undefined; status: string }[]) =>
  rs.map((r) => ({ data: r.data, pending: r.status === 'pending', failed: r.status === 'error' }));

export function useSearchEntriesFromFiles(enabled: boolean): SearchEntries {
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
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)), combine: settledOf });

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
