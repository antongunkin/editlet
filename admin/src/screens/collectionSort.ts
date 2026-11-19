/** The orders a collection's list offers (FigCraft *Posts · sort*): the old table's four columns, each way. */
export type SortKey = 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'author' | 'status';

export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'title-asc', label: 'Title A–Z' },
  { key: 'title-desc', label: 'Title Z–A' },
  { key: 'author', label: 'By author' },
  { key: 'status', label: 'By status' },
];

/** Newest change first: the order of Contentful, Storyblok and Payload. */
export const DEFAULT_SORT: SortKey = 'newest';

/** What an order needs of an entry. `updated` is the file's last commit; `null` without a history. */
export interface Sortable {
  title: string;
  slug: string;
  draft: boolean;
  updated: { date: string; by: string } | null;
}

/** An entry's value for `key`; `null` (no history yet, or none) sorts last in both directions. */
function sortValue(row: Sortable, key: SortKey): string | null {
  switch (key) {
    case 'newest':
    case 'oldest':
      return row.updated?.date ?? null;
    case 'title-asc':
    case 'title-desc':
      return row.title;
    case 'author':
      return row.updated?.by ?? null;
    case 'status':
      return row.draft ? 'Draft' : 'Published';
  }
}

const DESCENDING = new Set<SortKey>(['newest', 'title-desc']);

/** The entries in the order of `key`; ties go by title, then slug. Rows without a value go last either way. */
export function sortRows<T extends Sortable>(rows: T[], key: SortKey): T[] {
  const sign = DESCENDING.has(key) ? -1 : 1;
  return rows.toSorted((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * x.localeCompare(y) || a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
  });
}
