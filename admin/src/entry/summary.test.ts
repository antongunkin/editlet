import { describe, expect, it } from 'vitest';

import { fieldSummary, markdownSummary } from './summary';

import type { Field } from '../../../core/schema';

describe('fieldSummary: the row line of a field', () => {
  it('says what each kind holds in one line', () => {
    const select: Field = { type: 'select', label: 'Category', options: [{ label: 'Tires', value: 'tires' }] };
    expect(fieldSummary(select, 'tires')).toBe('Tires');
    expect(
      fieldSummary({ type: 'boolean', label: 'Nav', labels: { true: 'In the header', false: 'Hidden' } }, true),
    ).toBe('In the header');
    expect(fieldSummary({ type: 'boolean', label: 'Nav' }, undefined)).toBe('');
    expect(fieldSummary({ type: 'text', label: 'Excerpt' }, 'First\nsecond')).toBe('First');
    expect(fieldSummary({ type: 'json', label: 'Links' }, '[1, 2, 3]')).toBe('3 items');
    expect(fieldSummary({ type: 'image', label: 'Cover' }, { src: './a/cover.webp', alt: 'x' })).toBe(
      'cover.webp · alt text set',
    );
    const ref: Field = { type: 'reference', label: 'Tags', collections: ['tag'], multiple: true };
    expect(fieldSummary(ref, ['tag/a', 'tag/b'], (r) => r.toUpperCase())).toBe('TAG/A, TAG/B');
    const blocks: Field = { type: 'blocks', label: 'Content', blocks: { hero: { label: 'Hero', fields: {} } } };
    expect(fieldSummary(blocks, [{ block: 'hero' }, { block: 'hero' }])).toBe('2 blocks · Hero, Hero');
  });

  it('counts the words and images of a body', () => {
    expect(markdownSummary('## Hi\n\nOne two ![a](x.png)')).toBe('3 words · 1 image');
    expect(markdownSummary('')).toBe('');
  });
});
