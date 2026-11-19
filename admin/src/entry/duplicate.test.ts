import { describe, expect, it } from 'vitest';

import { copyData, copySlug, titleKey } from './duplicate';

import type { Collection } from '../../../core/schema';

const POST: Collection = {
  label: 'Post',
  fields: {
    tags: { type: 'string', label: 'Tags', list: true },
    title: { type: 'string', label: 'Title', required: true },
    body: { type: 'markdown', label: 'Body' },
  },
} as Collection;

describe('copySlug', () => {
  it('adds -copy, then counts, and keeps copies of a copy in one family', () => {
    expect(copySlug('tires', new Set())).toBe('tires-copy');
    expect(copySlug('tires', new Set(['tires-copy']))).toBe('tires-copy-2');
    expect(copySlug('tires', new Set(['tires-copy', 'tires-copy-2']))).toBe('tires-copy-3');
    expect(copySlug('tires-copy', new Set(['tires-copy']))).toBe('tires-copy-2');
    expect(copySlug('tires-copy-2', new Set(['tires-copy', 'tires-copy-2']))).toBe('tires-copy-3');
  });
});

describe('copyData', () => {
  it('adds (copy) to the title, copies every other value, and makes the copy a draft', () => {
    const data = { title: 'Tires for a rigid bike', tags: ['a'] };
    const copy = copyData(POST, data);
    expect(copy).toEqual({ title: 'Tires for a rigid bike (copy)', tags: ['a'], draft: true });
    expect(copy.tags).not.toBe(data.tags);
  });

  it('uses titleField when the collection names one, and leaves an entry without a title as it is', () => {
    const named = { ...POST, titleField: 'name', fields: { ...POST.fields, name: { type: 'string', label: 'Name' } } };
    expect(titleKey(named as Collection, { title: 'x', name: 'Dana' })).toBe('name');
    expect(copyData(named as Collection, { name: 'Dana' })).toEqual({ name: 'Dana (copy)', draft: true });
    expect(copyData(POST, { tags: ['a'] })).toEqual({ tags: ['a'], draft: true });
  });
});
