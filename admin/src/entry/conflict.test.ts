import { describe, expect, it } from 'vitest';

import { conflictFields, defaultPicks, mergeConflict } from './conflict';
import { post } from './testSchema';
import { entryToForm, formToEntry } from './values';

import { excerpt } from '../diff/CompareSheet';

const base = { data: { title: 'Old', summary: 'Same', rating: 2 }, body: 'Body\n' };

describe('conflictFields', () => {
  it('lists the fields the other save changed that differ from yours, with the default pick', () => {
    const theirs = { data: { title: 'Theirs', summary: 'Theirs too', rating: 3 }, body: 'Body\n' };
    const yours = { data: { title: 'Yours', summary: 'Same', rating: 3 }, body: 'Mine\n' };
    const fields = conflictFields(post, base, theirs, yours);
    expect(fields).toEqual([
      { key: 'title', label: 'Title', type: 'string', theirs: 'Theirs', yours: 'Yours', yoursChanged: true },
      { key: 'summary', label: 'Summary', type: 'text', theirs: 'Theirs too', yours: 'Same', yoursChanged: false },
    ]);
    expect(defaultPicks(fields)).toEqual({ title: 'yours', summary: 'theirs' });
  });
});

describe('mergeConflict', () => {
  it('starts from the newer file, keeps your other edits and applies the picks', () => {
    const theirs = { data: { title: 'Theirs', summary: 'Theirs too', rating: 2 }, body: 'Body\n' };
    const yoursValues = { ...entryToForm(post, base), title: 'Yours', rating: '5', __body: 'Mine\n' };
    const yours = formToEntry(post, yoursValues);
    const merged = mergeConflict(post, base, theirs, yours, yoursValues, { title: 'theirs', summary: 'yours' });
    const entry = formToEntry(post, merged);
    // Title: picked theirs; Summary: picked yours (the old value); rating and body: only you changed them.
    expect(entry.data).toMatchObject({ title: 'Theirs', summary: 'Same', rating: 5 });
    expect(entry.body).toBe('Mine\n');
  });

  it('with the default picks, yours wins where you changed the field', () => {
    const theirs = { data: { title: 'Theirs', summary: 'Theirs too', rating: 2 }, body: 'Body\n' };
    const yoursValues = { ...entryToForm(post, base), title: 'Yours' };
    const merged = mergeConflict(post, base, theirs, formToEntry(post, yoursValues), yoursValues, {});
    expect(formToEntry(post, merged).data).toMatchObject({ title: 'Yours', summary: 'Theirs too' });
  });
});

describe('conflict edge cases', () => {
  it('values the form drops (draft: false, empty text, empty list) are no change', () => {
    const theirs = { data: { title: 'Theirs', summary: '', tags: [], draft: false, rating: 2 }, body: 'Body\n' };
    const yours = { data: { ...base.data, title: 'Yours' }, body: 'Body\n' };
    expect(conflictFields(post, base, theirs, yours).map((f) => f.key)).toEqual(['title', 'summary']);
  });

  it('a key outside the schema picked as yours is kept', () => {
    const before = { data: { ...base.data, legacy: 'a' }, body: 'Body\n' };
    const theirs = { data: { ...before.data, legacy: 'b' }, body: 'Body\n' };
    const yoursValues = entryToForm(post, before);
    const yours = formToEntry(post, yoursValues);
    expect(conflictFields(post, before, theirs, yours).map((f) => f.key)).toEqual(['legacy']);
    const merged = mergeConflict(post, before, theirs, yours, yoursValues, { legacy: 'yours' });
    expect(formToEntry(post, merged).data.legacy).toBe('a');
    const taken = mergeConflict(post, before, theirs, yours, yoursValues, { legacy: 'theirs' });
    expect(formToEntry(post, taken).data.legacy).toBe('b');
  });
});

describe('excerpt', () => {
  it('starts a long value at its first differing line', () => {
    expect(excerpt('a\nb\nc\nd', 'a\nb\nX\nd')).toBe('…\nc\nd');
    expect(excerpt('one line', 'other')).toBe('one line');
  });
});
