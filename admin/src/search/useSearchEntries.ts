import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { SearchEntry } from './match';

import { entryFileQuery, entryRefs, useFiles, useSchema } from '../data/queries';
import { useSource } from '../source/context';

/**
 * Every entry of every collection with its title and draft flag, from the entry files the admin reads anyway (cached by
 * sha, shared with the collection list and the reference pickers). Reads nothing while `enabled` is false: the search
 * costs nothing until it opens. A title that has not loaded yet is the address, so matching works at once.
 */
export function useSearchEntries(enabled: boolean): SearchEntry[] {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const refs = useMemo(
    () =>
      enabled && schema && files.data
        ? Object.keys(schema.collections).flatMap((collection) =>
            entryRefs(schema, files.data, collection).map((ref) => ({ ...ref, collection })),
          )
        : [],
    [enabled, schema, files.data],
  );
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)) });
  return refs.map((ref, i) => {
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
    };
  });
}
