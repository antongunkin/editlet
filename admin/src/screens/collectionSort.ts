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

/** From this many entries, a list reads summaries only for the rows on screen, unless the order or chip needs all. */
export const LAZY_THRESHOLD = 200;

/** Whether the order or the chip needs a fact of every entry: its title or its draft flag. */
export function needsAll(sort: SortKey, filter: string): boolean {
  return sort === 'title-asc' || sort === 'title-desc' || sort === 'status' || filter === 'drafts';
}

/**
 * What an order needs of an entry. `title` and `draft` come from its summary: `null` until it is read. `updated` is the
 * file's last commit; `null` without a history.
 */
export interface Sortable {
  title: string | null;
  slug: string;
  draft: boolean | null;
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
      if (row.draft === null) return null;
      return row.draft ? 'Draft' : 'Published';
  }
}

const DESCENDING = new Set<SortKey>(['newest', 'title-desc']);

const BY_TITLE = new Set<SortKey>(['title-asc', 'title-desc', 'status']);

/**
 * The entries in the order of `key`. Rows without a value go last either way; under a title or status order those are
 * the rows without a summary, and they go newest first. Ties go by title, then slug. `bySlug`, for a large list, breaks
 * the ties of a date or author order by slug alone: titles arrive there one by one, and a late one moves no row.
 */
export function sortRows<T extends Sortable>(rows: T[], key: SortKey, { bySlug = false } = {}): T[] {
  const sign = DESCENDING.has(key) ? -1 : 1;
  const byTitle = BY_TITLE.has(key);
  const slugOnly = bySlug && !byTitle;
  const tie = (a: T, b: T) =>
    (slugOnly ? 0 : (a.title ?? a.slug).localeCompare(b.title ?? b.slug)) || a.slug.localeCompare(b.slug);
  // The rows without a value among themselves.
  const rest = (a: T, b: T) => {
    const x = byTitle ? (a.updated?.date ?? '') : '';
    const y = byTitle ? (b.updated?.date ?? '') : '';
    return y.localeCompare(x) || tie(a, b);
  };
  return rows.toSorted((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null || y === null) return x === y ? rest(a, b) : x === null ? 1 : -1;
    return sign * x.localeCompare(y) || tie(a, b);
  });
}
