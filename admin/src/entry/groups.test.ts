import { describe, expect, it } from 'vitest';

import { groupOf, groupTabs } from './groups';

const GROUPS = [
  { key: 'content', label: 'Content', fields: ['title', 'body'] },
  { key: 'media', label: 'Media', fields: ['cover'] },
  { key: 'settings', label: 'Settings', fields: ['showInNav'] },
];

describe('groupOf', () => {
  it('finds the group of a field, and puts an unknown key in the first', () => {
    expect(groupOf(GROUPS, 'cover')).toBe('media');
    expect(groupOf(GROUPS, '__body')).toBe('content');
    expect(groupOf([], 'x')).toBe('');
  });
});

describe('groupTabs', () => {
  it('marks a group invalid over changed, and leaves a clean one unmarked', () => {
    expect(
      groupTabs(GROUPS, [
        { key: 'title', changed: true },
        { key: 'body', error: ['Required'] },
        { key: 'cover', changed: true },
        { key: 'showInNav', error: [] },
      ]),
    ).toEqual([
      { key: 'content', label: 'Content', mark: 'invalid' },
      { key: 'media', label: 'Media', mark: 'changed' },
      { key: 'settings', label: 'Settings', mark: undefined },
    ]);
  });
});
