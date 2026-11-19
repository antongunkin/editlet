import { describe, expect, it } from 'vitest';

import { issuesByField, relativeSrc, requiredFieldKeys, uniqueAssetPath } from './changes';
import { schema } from './testSchema';

import { resolveAssetPath } from '../../../core/paths';

describe('issuesByField', () => {
  it('keys issues by the first path segment; file-level and unknown-field issues are general', () => {
    expect(
      issuesByField([
        { path: 'title', message: 'Required' },
        { path: 'tags.2', message: 'Expected text' },
        { path: 'tags.3', message: 'Expected text' },
        { path: '', message: 'Body not allowed' },
        { path: 'legacy', message: 'Unknown field' },
      ]),
    ).toEqual({
      fields: { title: ['Required'], tags: ['2: Expected text', '3: Expected text'] },
      general: ['Body not allowed', 'legacy: Unknown field'],
    });
  });
});

describe('uniqueAssetPath', () => {
  it('slugifies the name, lowercases the extension and suffixes on collision', () => {
    const dir = 'cms/content/post/hello';
    expect(uniqueAssetPath(new Set([`${dir}/cover.webp`]), dir, 'Cover.WEBP')).toBe(`${dir}/cover-2.webp`);
    expect(uniqueAssetPath(new Set([`${dir}/cover.webp`, `${dir}/cover-2.webp`]), dir, 'cover.webp')).toBe(
      `${dir}/cover-3.webp`,
    );
    expect(uniqueAssetPath(new Set(), dir, 'My Photo (1).JPG')).toBe(`${dir}/my-photo-1.jpg`);
    expect(uniqueAssetPath(new Set(), dir, '!!!.png')).toBe(`${dir}/image.png`);
  });
});

describe('relativeSrc', () => {
  it('builds a src relative to the entry folder', () => {
    expect(relativeSrc('cms/content/post/hello.md', 'cms/content/post/hello/cover-2.webp')).toBe('hello/cover-2.webp');
    expect(relativeSrc('cms/content/post/a.md', 'cms/content/images/x.png')).toBe('../images/x.png');
    expect(relativeSrc('cms/content/post/a.md', 'cms/content/post/x.png')).toBe('x.png');
  });

  it('is the inverse of resolveAssetPath', () => {
    const cases: [string, string][] = [
      ['cms/content/post/hello.md', 'cms/content/post/hello/cover.webp'],
      ['cms/content/post/a.md', 'cms/content/images/x.png'],
      ['cms/content/post/a.md', 'cms/content/author/jane/a/b.png'],
      ['cms/content/home/index.md', 'cms/content/x.png'],
    ];
    for (const [entry, asset] of cases) expect(resolveAssetPath(schema, entry, relativeSrc(entry, asset))).toBe(asset);
  });
});

describe('requiredFieldKeys', () => {
  it('names the rows that still miss a required value, nested ones under their row', () => {
    const issues = [
      { path: 'title', message: 'Required' },
      { path: 'seo.title', message: 'Required' },
      { path: 'content.2.text', message: 'Required' },
      { path: 'tags', message: 'Too many' },
      { path: '', message: 'Required' },
    ];
    expect([...requiredFieldKeys(issues)].toSorted()).toEqual(['content', 'seo', 'title']);
  });
});
