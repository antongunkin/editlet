// Matching for the search sheet (docs/admin/search.md): words of the query against an entry's title and address.

/** One searchable entry: what the admin already knows of it. */
export interface SearchEntry {
  collection: string;
  /** The collection's label: the second line of its row. */
  collectionLabel: string;
  slug: string;
  /** The `titleField` value, else the slug. */
  title: string;
  draft: boolean;
}

/** Lower case, accents removed: `Évelyn` and `evelyn` are the same word. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

const words = (text: string) =>
  fold(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * How well an entry matches, lower is better; `null` when a word of the query is in neither its title nor its address.
 * 0: the title or the address is the query; 1: one starts with it; 2: a word of the title starts with the query;
 * 3: anything else that contains every word.
 */
export function rank(entry: Pick<SearchEntry, 'title' | 'slug'>, query: string): number | null {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (q === '') return null;
  const title = fold(entry.title);
  const slug = fold(entry.slug);
  const hay = `${title} ${slug}`;
  if (!q.split(' ').every((word) => hay.includes(word))) return null;
  if (title === q || slug === q) return 0;
  if (title.startsWith(q) || slug.startsWith(q)) return 1;
  if (words(entry.title).some((w) => w.startsWith(q))) return 2;
  return 3;
}

/** The entries that match, best first, ties by title then address. */
export function searchEntries(entries: SearchEntry[], query: string): SearchEntry[] {
  return entries
    .flatMap((entry) => {
      const r = rank(entry, query);
      return r === null ? [] : [{ entry, r }];
    })
    .toSorted(
      (a, b) =>
        a.r - b.r ||
        a.entry.title.localeCompare(b.entry.title) ||
        a.entry.collection.localeCompare(b.entry.collection) ||
        a.entry.slug.localeCompare(b.entry.slug),
    )
    .map(({ entry }) => entry);
}
