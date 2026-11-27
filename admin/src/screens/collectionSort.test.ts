import { describe, expect, it } from 'vitest';

import { needsAll, SORTS, sortRows, type Sortable } from './collectionSort';

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

describe('sortRows with rows whose summary is not read', () => {
  const at = (day: number) => ({ date: `2026-11-0${day}T00:00:00Z`, by: 'Mo H' });
  const unread = (slug: string, updated: Sortable['updated']): Sortable => ({
    slug,
    title: null,
    draft: null,
    updated,
  });
  const mixed = [
    unread('u-old', at(1)),
    row('b', 'Saddle', false, at(2)),
    unread('u-new', at(3)),
    row('a', 'Zip', true, null),
  ];
  const order = (key: Parameters<typeof sortRows>[1]) => sortRows(mixed, key).map((r) => r.slug);

  it('a title or status order puts them last, newest first', () => {
    expect(order('title-asc')).toEqual(['b', 'a', 'u-new', 'u-old']);
    expect(order('title-desc')).toEqual(['a', 'b', 'u-new', 'u-old']);
    expect(order('status')).toEqual(['a', 'b', 'u-new', 'u-old']);
  });

  it('a date order does not need them', () => {
    expect(order('newest')).toEqual(['u-new', 'b', 'u-old', 'a']);
  });

  it('bySlug: ties of a date or author order go by address, so a title changes nothing', () => {
    const tied = (titles: boolean) =>
      ['c', 'a', 'b'].map((slug, i) => ({ slug, title: titles ? `T${i}` : null, draft: null, updated: at(1) }));
    for (const key of ['newest', 'oldest', 'author'] as const) {
      for (const titles of [false, true]) {
        expect(sortRows(tied(titles), key, { bySlug: true }).map((r) => r.slug)).toEqual(['a', 'b', 'c']);
      }
      expect(sortRows(tied(true), key).map((r) => r.slug)).toEqual(['c', 'a', 'b']);
    }
    expect(sortRows(tied(true), 'title-asc', { bySlug: true }).map((r) => r.slug)).toEqual(['c', 'a', 'b']);
  });
});

describe('needsAll', () => {
  it('is true for the title and status orders and the Drafts chip', () => {
    const orders = SORTS.map((s) => s.key);
    expect(orders.filter((key) => needsAll(key, 'all'))).toEqual(['title-asc', 'title-desc', 'status']);
    expect(['all', 'changed', 'review', 'drafts'].filter((chip) => needsAll('newest', chip))).toEqual(['drafts']);
  });
});
