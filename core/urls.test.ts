import { describe, expect, it } from 'vitest';

import { loadSchema, type Schema } from './schema';
import { entryUrl, matchEntryUrls, URL_PLACEHOLDERS, urlPatternIssues } from './urls';

const SHAPE = `url must be a path from the site's root, for example "/posts/{slug}"`;
const fields = { title: { type: 'string', label: 'Title' } };

function schemaWith(collections: Record<string, { url?: string; singleton?: boolean }>): Schema {
  return loadSchema({
    contentDir: 'cms/content',
    git: { baseBranch: 'main' },
    collections: Object.fromEntries(Object.entries(collections).map(([key, c]) => [key, { label: key, ...c, fields }])),
  });
}

describe('urlPatternIssues', () => {
  it.each(['/', '/posts/{slug}', '/posts/{slug}/', '/{slug}', '/blog/post-{slug}.html', '/a_b~c/(x)/'])(
    'accepts %j',
    (pattern) => {
      expect(urlPatternIssues(pattern, false)).toEqual([]);
    },
  );

  it.each([
    'posts/{slug}',
    '',
    '/posts//{slug}',
    '/posts/../{slug}',
    '/posts/./{slug}',
    '/posts/..',
    '/posts?x={slug}',
    '/posts#{slug}',
    '/posts/%20{slug}',
    '/posts/a b/{slug}',
    '/pöst/{slug}',
    '/posts\\{slug}',
    '/posts/{slug',
    '/posts/slug}',
    '/a"b/{slug}',
    '/<x>/{slug}',
    '/a`b/{slug}',
    `/${'a'.repeat(200)}`,
  ])('rejects the shape of %j', (pattern) => {
    expect(urlPatternIssues(pattern, false)).toContain(SHAPE);
  });

  it('takes exactly 200 characters', () => {
    expect(urlPatternIssues(`/${'a'.repeat(199)}`, false)).toEqual([]);
  });

  it.each(['/editlet/x', '/editlet', '/editlet/', '/__editlet', '/__editlet/files'])('rejects %j as reserved', (p) => {
    expect(urlPatternIssues(p, false)).toEqual(['url cannot be under /editlet/ or /__editlet']);
  });

  it('allows a path that only starts like a reserved one', () => {
    expect(urlPatternIssues('/editlets/{slug}', false)).toEqual([]);
    expect(urlPatternIssues('/__editlets/{slug}', false)).toEqual([]);
  });

  it.each(['/posts/[slug]', '/posts/[...slug]/', '/posts/:slug', '/:lang/posts/{slug}'])(
    'rejects the route syntax in %j',
    (p) => {
      expect(urlPatternIssues(p, false)).toContain(
        'write the slug as {slug}, not as a route segment like [slug] or :slug',
      );
    },
  );

  it('allows a colon or brackets inside a segment', () => {
    expect(urlPatternIssues('/a:b/{slug}', false)).toEqual([]);
    expect(urlPatternIssues('/a[1]/{slug}', false)).toEqual([]);
  });

  it('names unknown placeholders and a repeated {slug}', () => {
    expect(URL_PLACEHOLDERS).toEqual(['slug']);
    expect(urlPatternIssues('/{title}', false)).toEqual(['unknown placeholder "{title}" (use {slug})']);
    expect(urlPatternIssues('/{slug}/{slug}', false)).toEqual(['{slug} can appear only once']);
  });

  it('rejects {slug} in a singleton, and takes its fixed path', () => {
    expect(urlPatternIssues('/about/{slug}', true)).toEqual(['a singleton has one page: url cannot use {slug}']);
    expect(urlPatternIssues('/about', true)).toEqual([]);
  });
});

describe('entryUrl', () => {
  const schema = schemaWith({
    post: { url: '/posts/{slug}' },
    note: { url: '/notes/{slug}/' },
    section: { url: '/' },
    home: { url: '/', singleton: true },
    author: {},
  });

  it('fills in {slug}, keeping a trailing /', () => {
    expect(entryUrl(schema, 'post', 'tires')).toBe('/posts/tires');
    expect(entryUrl(schema, 'note', 'tires')).toBe('/notes/tires/');
  });

  it('gives null for a slug that is not valid, and fills in $ patterns literally', () => {
    expect(entryUrl(schema, 'post', '/evil.test')).toBeNull();
    expect(entryUrl(schema, 'post', 'Tires')).toBeNull();
    expect(entryUrl(schema, 'post', '')).toBeNull();
    expect(entryUrl(schema, 'post', "$'")).toBeNull();
    expect(entryUrl(schemaWith({ x: { url: '/$&/{slug}' } }), 'x', 'a')).toBe('/$&/a');
  });

  it('gives the fixed path without {slug}, and null without url', () => {
    expect(entryUrl(schema, 'section', 'intro')).toBe('/');
    expect(entryUrl(schema, 'home', 'index')).toBe('/');
    expect(entryUrl(schema, 'author', 'jane')).toBeNull();
    expect(entryUrl(schema, 'missing', 'x')).toBeNull();
  });
});

describe('matchEntryUrls', () => {
  it('matches exactly, with a trailing / on either side', () => {
    const schema = schemaWith({ post: { url: '/posts/{slug}' }, note: { url: '/notes/{slug}/' } });
    expect(matchEntryUrls(schema, '/posts/tires')).toEqual([{ collection: 'post', slug: 'tires' }]);
    expect(matchEntryUrls(schema, '/posts/tires/')).toEqual([{ collection: 'post', slug: 'tires' }]);
    expect(matchEntryUrls(schema, '/notes/a')).toEqual([{ collection: 'note', slug: 'a' }]);
    expect(matchEntryUrls(schema, '/notes/a/')).toEqual([{ collection: 'note', slug: 'a' }]);
  });

  it('matches nothing for another path or an invalid slug', () => {
    const schema = schemaWith({ post: { url: '/posts/{slug}' }, author: {} });
    expect(matchEntryUrls(schema, '/about')).toEqual([]);
    expect(matchEntryUrls(schema, '/posts')).toEqual([]);
    expect(matchEntryUrls(schema, '/posts/a/b')).toEqual([]);
    expect(matchEntryUrls(schema, '/posts/Not_Valid')).toEqual([]);
  });

  it('lists every match in schema order, an index page included', () => {
    const schema = schemaWith({
      page: { url: '/{slug}' },
      post: { url: '/posts/{slug}/' },
      postIndex: { url: '/posts/' },
    });
    expect(matchEntryUrls(schema, '/posts/')).toEqual([
      { collection: 'page', slug: 'posts' },
      { collection: 'postIndex' },
    ]);
    expect(matchEntryUrls(schema, '/posts/a')).toEqual([{ collection: 'post', slug: 'a' }]);
  });

  it("gives a singleton's slug index and no slug for a many-entry page", () => {
    const schema = schemaWith({ home: { url: '/', singleton: true }, section: { url: '/' } });
    expect(matchEntryUrls(schema, '/')).toEqual([{ collection: 'home', slug: 'index' }, { collection: 'section' }]);
    expect(matchEntryUrls(schema, '/x')).toEqual([]);
  });

  it('matches text around {slug} inside a segment', () => {
    const schema = schemaWith({ post: { url: '/blog/post-{slug}.html' } });
    expect(matchEntryUrls(schema, '/blog/post-a-b.html')).toEqual([{ collection: 'post', slug: 'a-b' }]);
    expect(matchEntryUrls(schema, '/blog/postXa.html')).toEqual([]);
  });
});
