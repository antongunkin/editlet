import { describe, expect, it } from 'vitest';

import { fold, rank, searchEntries, type SearchEntry } from './match';

const entry = (title: string, slug: string, collection = 'post'): SearchEntry => ({
  collection,
  collectionLabel: collection,
  slug,
  title,
  draft: false,
});

describe('fold', () => {
  it('ignores case and accents', () => {
    expect(fold('Évelyn ÅNGSTRÖM')).toBe('evelyn angstrom');
  });
});

describe('rank', () => {
  const tires = entry('Tires for a rigid bike', 'best-26-inch-tires');

  it('needs every word of the query in the title or the address', () => {
    expect(rank(tires, 'rigid tir')).not.toBeNull();
    expect(rank(tires, 'inch bike')).not.toBeNull();
    expect(rank(tires, 'rigid wheel')).toBeNull();
    expect(rank(tires, '   ')).toBeNull();
  });

  it('ranks the title or address equal to the query, then a start, then a word, then the rest', () => {
    expect(rank(entry('Tires', 'x'), 'tires')).toBe(0);
    expect(rank(entry('Tires for a bike', 'x'), 'tires')).toBe(1);
    expect(rank(entry('x', 'tires-guide'), 'tires')).toBe(1);
    expect(rank(entry('Five tires', 'x'), 'tires')).toBe(2);
    expect(rank(entry('Retires', 'x'), 'tires')).toBe(3);
  });
});

describe('searchEntries', () => {
  it('lists the best matches first and ties by title', () => {
    const list = [
      entry('Retires', 'retires'),
      entry('Five tires', 'five-tires'),
      entry('Tires for a bike', 'bike'),
      entry('Tires', 'tires', 'tag'),
      entry('Other', 'other'),
    ];
    expect(searchEntries(list, 'tires').map((e) => e.title)).toEqual([
      'Tires',
      'Tires for a bike',
      'Five tires',
      'Retires',
    ]);
  });

  it('finds an entry by its address and does not match nothing', () => {
    const list = [entry('Hello', 'best-26-inch-tires')];
    expect(searchEntries(list, '26 inch')).toHaveLength(1);
    expect(searchEntries(list, '')).toEqual([]);
  });
});
