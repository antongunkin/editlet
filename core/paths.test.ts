import { describe, expect, it } from 'vitest';

import { EditletError } from './issues';
import {
  IMAGE_EXTENSIONS,
  entryFilePath,
  entryPath,
  isCanonicalPath,
  isHiddenContentPath,
  isImagePath,
  isValidSlug,
  parseEntryPath,
  parseRefKey,
  refKey,
  resolveAssetPath,
  slugify,
} from './paths';
import { loadSchema } from './schema';

const s = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } },
    homePage: { label: 'Home', singleton: true, fields: { title: { type: 'string', label: 'Title' } } },
  },
});

describe('slugs', () => {
  it('validates', () => {
    expect(isValidSlug('a-b1')).toBe(true);
    for (const bad of ['', 'A', 'a--b', '-a', 'a-', 'a b']) expect(isValidSlug(bad)).toBe(false);
  });
  it('slugifies', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
    expect(slugify('  --a--b-- ')).toBe('a-b');
    expect(slugify('Café')).toBe('caf');
  });
});

describe('entryPath', () => {
  it('builds paths', () => {
    expect(entryPath(s, 'post', 'hello-world')).toBe('cms/content/post/hello-world.md');
    expect(entryPath(s, 'homePage')).toBe('cms/content/homePage/index.md');
    expect(entryPath(s, 'homePage', 'ignored')).toBe('cms/content/homePage/index.md');
  });
  it('throws EditletError on bad input', () => {
    expect(() => entryPath(s, 'post', 'Hello World')).toThrow(EditletError);
    expect(() => entryPath(s, 'post')).toThrow(EditletError);
    expect(() => entryPath(s, 'nope', 'a')).toThrow(EditletError);
    expect(() => entryPath(s, 'toString', 'a')).toThrow(EditletError);
  });
});

describe('entryFilePath', () => {
  it('builds the raw path without validating', () => {
    expect(entryFilePath(s, 'post', 'Bad Slug')).toBe('cms/content/post/Bad Slug.md');
    expect(entryFilePath(s, 'homePage', 'other')).toBe('cms/content/homePage/index.md');
    expect(entryFilePath(s, 'nope', 'a')).toBe('cms/content/nope/a.md');
    expect(entryFilePath(s, 'toString', 'a')).toBe('cms/content/toString/a.md');
  });
});

describe('parseEntryPath', () => {
  it('round-trips', () => {
    expect(parseEntryPath(s, 'cms/content/post/hello.md')).toEqual({ collection: 'post', slug: 'hello' });
    expect(parseEntryPath(s, 'cms/content/homePage/index.md')).toEqual({ collection: 'homePage', slug: 'index' });
  });
  it('does not check slug regex', () => {
    expect(parseEntryPath(s, 'cms/content/post/Bad Name.md')).toEqual({ collection: 'post', slug: 'Bad Name' });
  });
  it('rejects non-entries', () => {
    for (const p of [
      'cms/content/post/a/b.md',
      'other/x.md',
      'cms/content/nope/a.md',
      'cms/content/post/a.json',
      'cms/content/post/a.MD',
      'cms/content/homePage/other.md',
      'cms/content/toString/a.md',
      './cms/content/post/a.md',
      'cms/content/post/../post/a.md',
      'cms//content/post/a.md',
      'cms\\content\\post\\a.md',
      'cms/content/post/.md',
    ])
      expect(parseEntryPath(s, p)).toBeNull();
  });
});

describe('resolveAssetPath', () => {
  const f = 'cms/content/post/a.md';
  it('resolves relative to the entry dir', () => {
    expect(resolveAssetPath(s, f, 'a/cover.webp')).toBe('cms/content/post/a/cover.webp');
    expect(resolveAssetPath(s, f, './x.png')).toBe('cms/content/post/x.png');
    expect(resolveAssetPath(s, f, '../homePage/hero.png')).toBe('cms/content/homePage/hero.png');
  });
  it('returns null for unsafe or escaping', () => {
    for (const src of [
      '../../../etc/passwd',
      '../../x.png',
      '/x.png',
      '',
      'https://x.com/a.png',
      'data:image/png;base64,AA',
      'a\\b.png',
      '..',
      '.',
    ])
      expect(resolveAssetPath(s, f, src)).toBeNull();
  });
});

describe('refs and images', () => {
  it('refKey / parseRefKey', () => {
    expect(refKey('post', 'hello')).toBe('post/hello');
    expect(parseRefKey('post/hello')).toEqual({ collection: 'post', slug: 'hello' });
    for (const r of ['post', '/a', 'a/', 'a/b/c', 'a/Bad']) expect(parseRefKey(r)).toBeNull();
  });
  it('isImagePath', () => {
    expect(IMAGE_EXTENSIONS).toEqual(['webp', 'png', 'jpg', 'jpeg', 'avif', 'gif', 'svg']);
    expect(isImagePath('a/B.PNG')).toBe(true);
    expect(isImagePath('a.md')).toBe(false);
    expect(isImagePath('png')).toBe(false);
  });
});

describe('isCanonicalPath', () => {
  it.each(['a', 'a/b.md', 'cms/content/post/x.webp', 'a.b/c'])('accepts %j', (p) => {
    expect(isCanonicalPath(p)).toBe(true);
  });

  it.each(['', '/a', 'a/', 'a//b', './a', 'a/./b', '../a', 'a/..', 'a\\b', 'a\0b', 'C:/x', 'a/b:c', 'https://x'])(
    'rejects %j',
    (p) => {
      expect(isCanonicalPath(p)).toBe(false);
    },
  );
});

describe('isHiddenContentPath', () => {
  it('flags dot segments below contentDir only', () => {
    expect(isHiddenContentPath(s, 'cms/content/post/.gitkeep')).toBe(true);
    expect(isHiddenContentPath(s, 'cms/content/.drafts/a.md')).toBe(true);
    expect(isHiddenContentPath(s, 'cms/content/post/a.md')).toBe(false);
    const dotDir = loadSchema({ contentDir: '.content', git: { baseBranch: 'main' }, collections: {} });
    expect(isHiddenContentPath(dotDir, '.content/a/b.md')).toBe(false);
  });
});
