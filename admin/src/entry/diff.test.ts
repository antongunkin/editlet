import { describe, expect, it } from 'vitest';

import { entryDiff, formKeyOf } from './diff';
import { author, post } from './testSchema';

describe('entryDiff', () => {
  const before = { data: { title: 'Old', tags: ['a'], rating: 2 }, body: 'Hi\n' };

  it('lists only title when only the title changed', () => {
    const rows = entryDiff(post, before, { ...before, data: { ...before.data, title: 'New' } });
    expect(rows).toEqual([{ key: 'title', label: 'Title', type: 'string', before: 'Old', after: 'New' }]);
  });

  it('lists the body with the markdown field key and label', () => {
    expect(entryDiff(post, before, { ...before, body: 'Bye\n' })).toEqual([
      { key: 'body', label: 'Body', type: 'markdown', before: 'Hi\n', after: 'Bye\n' },
    ]);
  });

  it('renders values as text: absent empty, scalars via String, objects as YAML', () => {
    const rows = entryDiff(post, before, {
      data: { title: 'Old', tags: ['a', 'b'], rating: 3, published: false, cover: { src: 'x.png', alt: 'X' } },
      body: 'Hi\n',
    });
    expect(rows).toEqual([
      { key: 'tags', label: 'Tags', type: 'string', before: '- a', after: '- a\n- b' },
      { key: 'published', label: 'Published', type: 'boolean', before: '', after: 'false' },
      { key: 'rating', label: 'Rating', type: 'number', before: '2', after: '3' },
      { key: 'cover', label: 'Cover', type: 'image', before: '', after: 'src: x.png\nalt: X' },
    ]);
  });

  it('lists extra keys and draft last', () => {
    const rows = entryDiff(
      author,
      { data: { name: 'J', legacy: 1 }, body: '' },
      { data: { name: 'J', draft: true }, body: '' },
    );
    expect(rows).toEqual([
      { key: 'legacy', label: 'legacy', type: 'unknown', before: '1', after: '' },
      { key: 'draft', label: 'Draft', type: 'boolean', before: '', after: 'true' },
    ]);
  });

  it('treats a missing before as an empty entry', () => {
    const rows = entryDiff(post, null, { data: { title: 'New' }, body: 'Hi' });
    expect(rows.map((r) => [r.key, r.before, r.after])).toEqual([
      ['title', '', 'New'],
      ['body', '', 'Hi'],
    ]);
  });

  it('is empty when nothing changed', () => {
    expect(entryDiff(post, before, { data: { rating: 2, tags: ['a'], title: 'Old' }, body: 'Hi\n' })).toEqual([]);
  });
});

describe('formKeyOf', () => {
  it('maps a diff row to the form key that holds it', () => {
    expect(formKeyOf(post, 'title')).toBe('title');
    expect(formKeyOf(post, 'body')).toBe('__body');
    expect(formKeyOf(post, '__body')).toBe('__body');
    expect(formKeyOf(post, 'draft')).toBe('draft');
    expect(formKeyOf(post, 'legacy')).toBeNull();
    expect(formKeyOf(post, 'constructor')).toBeNull();
  });
});
