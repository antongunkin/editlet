import { describe, expect, it } from 'vitest';

import { sortRows, type Sortable } from './collectionSort';

const row = (slug: string, title: string, draft: boolean, updated: Sortable['updated']): Sortable => ({
  slug,
  title,
  draft,
  updated,
});
const rows = [
  row('a', 'Brakes', false, { date: '2026-11-01T00:00:00Z', by: 'Mo H' }),
  row('b', 'Saddle', true, { date: '2026-11-10T00:00:00Z', by: 'Dana K' }),
  row('c', 'Hubs', false, null),
  row('d', 'Paint', false, { date: '2026-10-01T00:00:00Z', by: 'Dana K' }),
];
const slugs = (key: Parameters<typeof sortRows>[1]) => sortRows(rows, key).map((r) => r.slug);

describe('sortRows', () => {
  it('newest first and oldest first by the last commit; no history last either way', () => {
    expect(slugs('newest')).toEqual(['b', 'a', 'd', 'c']);
    expect(slugs('oldest')).toEqual(['d', 'a', 'b', 'c']);
  });

  it('by title, both ways', () => {
    expect(slugs('title-asc')).toEqual(['a', 'c', 'd', 'b']);
    expect(slugs('title-desc')).toEqual(['b', 'd', 'c', 'a']);
  });

  it('by author A–Z (ties by title), no history last', () => {
    expect(slugs('author')).toEqual(['d', 'b', 'a', 'c']);
  });

  it('by status: drafts first, then by title', () => {
    expect(slugs('status')).toEqual(['b', 'a', 'c', 'd']);
  });
});
