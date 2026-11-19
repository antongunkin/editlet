import { fileStatusLabel, type FileStatus } from '../status/labels';

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
  /** The file's status (`useFileStatuses`): *Unsaved*, *In review* or *Changed*; `null` or none when it has none. */
  status?: FileStatus | null;
  /**
   * How many saved entries point at it, by referring collection; `undefined` for an entry nothing can reference, and
   * while the referring files still load.
   */
  uses?: ReadonlyMap<string, number>;
}

/** What a referring collection's entries are called in a count (*post*, *posts*): from the collection's labels. */
export type CollectionNoun = (collection: string) => { one: string; many: string } | undefined;

/**
 * The row's second line: the collection, *Draft*, and how much it is used. One referring collection that has a plural
 * name reads *4 posts* (*1 post*); anything else *Used by 5 entries* (*Used by 1 entry*). Nothing at zero.
 */
export function entrySub(entry: SearchEntry, noun?: CollectionNoun): string {
  const parts = [entry.collectionLabel];
  if (entry.draft) parts.push('Draft');
  if (entry.status) parts.push(fileStatusLabel(entry.status));
  const by = entry.uses ? [...entry.uses] : [];
  const used = by.reduce((sum, [, n]) => sum + n, 0);
  if (used > 0) {
    const names = by.length === 1 ? noun?.(by[0]![0]) : undefined;
    parts.push(
      names ? `${used} ${used === 1 ? names.one : names.many}` : `Used by ${used} ${used === 1 ? 'entry' : 'entries'}`,
    );
  }
  return parts.join(' · ');
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
 * How well a row matches, lower is better; `null` when a word of the query is in neither its title nor its keywords.
 * 0: the title or a keyword is the query; 1: one starts with it; 2: a word of the title starts with the query;
 * 3: anything else that contains every word. Entries match by title and address, actions by label and keywords.
 */
export function rankText(title: string, keywords: readonly string[], query: string): number | null {
  const q = fold(query).trim().replace(/\s+/g, ' ');
  if (q === '') return null;
  const t = fold(title);
  const keys = keywords.map(fold);
  const hay = [t, ...keys].join(' ');
  if (!q.split(' ').every((word) => hay.includes(word))) return null;
  if (t === q || keys.includes(q)) return 0;
  if (t.startsWith(q) || keys.some((k) => k.startsWith(q))) return 1;
  if (words(title).some((w) => w.startsWith(q))) return 2;
  return 3;
}

/** How well an entry matches its title and address (`rankText`). */
export function rank(entry: Pick<SearchEntry, 'title' | 'slug'>, query: string): number | null {
  return rankText(entry.title, [entry.slug], query);
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
