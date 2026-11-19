import { describe, expect, it } from 'vitest';

import { formatRoute, parentRoute, parseRoute } from './route';

describe('parseRoute', () => {
  it('parses each route kind', () => {
    expect(parseRoute('')).toEqual({ kind: 'home' });
    expect(parseRoute(null)).toEqual({ kind: 'home' });
    expect(parseRoute('post')).toEqual({ kind: 'collection', collection: 'post' });
    expect(parseRoute('post/hello-world')).toEqual({ kind: 'entry', collection: 'post', slug: 'hello-world' });
    expect(parseRoute('schema')).toEqual({ kind: 'schema' });
    expect(parseRoute('media')).toEqual({ kind: 'media' });
    expect(parseRoute('all-content')).toEqual({ kind: 'content' });
    expect(parseRoute('branch:x')).toEqual({ kind: 'branch', name: 'x' });
  });

  it('marks malformed routes unknown', () => {
    expect(parseRoute('a/b/c')).toEqual({ kind: 'unknown', raw: 'a/b/c' });
    expect(parseRoute('post/')).toEqual({ kind: 'unknown', raw: 'post/' });
    expect(parseRoute('/post')).toEqual({ kind: 'unknown', raw: '/post' });
    expect(parseRoute('branch:')).toEqual({ kind: 'unknown', raw: 'branch:' });
  });
});

describe('formatRoute', () => {
  it('round-trips every valid route', () => {
    for (const raw of ['', 'post', 'post/hello-world', 'schema', 'media', 'all-content', 'branch:x']) {
      expect(formatRoute(parseRoute(raw))).toBe(raw);
    }
  });

  it('formats unknown routes as their raw value', () => {
    expect(formatRoute({ kind: 'unknown', raw: 'a/b/c' })).toBe('a/b/c');
  });
});

describe('parentRoute', () => {
  it('goes one level up the content tree: entry → collection → home', () => {
    expect(parentRoute({ kind: 'entry', collection: 'post', slug: 'hello' })).toEqual({
      kind: 'collection',
      collection: 'post',
    });
    expect(parentRoute({ kind: 'collection', collection: 'post' })).toEqual({ kind: 'content' });
  });

  it('sends the other screens Home, and Home has no parent', () => {
    expect(parentRoute({ kind: 'schema' })).toEqual({ kind: 'content' });
    expect(parentRoute({ kind: 'media' })).toEqual({ kind: 'content' });
    expect(parentRoute({ kind: 'content' })).toEqual({ kind: 'home' });
    expect(parentRoute({ kind: 'branch', name: 'x' })).toEqual({ kind: 'home' });
    expect(parentRoute({ kind: 'unknown', raw: 'a/b/c' })).toEqual({ kind: 'home' });
    expect(parentRoute({ kind: 'home' })).toBeNull();
  });
});
