import { describe, expect, it, vi } from 'vitest';

import { buildSnapshot, fieldPreviews, mergePreviews } from './snapshot';

import { schema } from '../entry/testSchema';

const FILE = 'cms/content/post/hello.md';
const db = (data: Record<string, unknown>, body = '') => ({ data, body });
const none = async () => null;

describe('fieldPreviews', () => {
  it('maps a changed string to text', async () => {
    const out = await fieldPreviews(schema, 'post', FILE, db({ title: 'A' }), db({ title: 'B' }), none);
    expect(out).toEqual({ title: { text: { from: 'A', to: 'B' } } });
  });

  it('omits unchanged fields', async () => {
    const out = await fieldPreviews(
      schema,
      'post',
      FILE,
      db({ title: 'A', summary: 's' }),
      db({ title: 'A', summary: 's' }),
      none,
    );
    expect(out).toEqual({});
  });

  it('maps number and datetime as raw strings', async () => {
    const out = await fieldPreviews(
      schema,
      'post',
      FILE,
      db({ rating: 1, publishedAt: '2026-01-01' }),
      db({ rating: 2.5, publishedAt: '2026-02-01' }),
      none,
    );
    expect(out).toEqual({
      rating: { text: { from: '1', to: '2.5' } },
      publishedAt: { text: { from: '2026-01-01', to: '2026-02-01' } },
    });
  });

  it('marks body, boolean, json, reference, lists stale', async () => {
    const out = await fieldPreviews(
      schema,
      'post',
      FILE,
      db({ published: false, meta: { a: 1 }, author: 'author/a', related: [], tags: ['x'], kinds: ['a'] }, 'old'),
      db(
        { published: true, meta: { a: 2 }, author: 'author/b', related: ['post/x'], tags: ['y'], kinds: ['b'] },
        'new',
      ),
      none,
    );
    expect(out).toEqual({
      body: { stale: true },
      published: { stale: true },
      meta: { stale: true },
      author: { stale: true },
      related: { stale: true },
      tags: { stale: true },
      kinds: { stale: true },
    });
  });

  it('image: content-relative from, Blob to, alt change', async () => {
    const blob = new Blob(['x']);
    const readImage = vi.fn(async () => blob);
    const out = await fieldPreviews(
      schema,
      'post',
      FILE,
      db({ cover: { src: './old.png', alt: 'old' } }),
      db({ cover: { src: './new.png', alt: 'new' } }),
      readImage,
    );
    expect(readImage).toHaveBeenCalledWith('cms/content/post/new.png');
    expect(out).toEqual({
      cover: { image: { from: 'post/old.png', to: blob, alt: { from: 'old', to: 'new' } } },
    });
  });

  it('image whose bytes are unreadable is stale', async () => {
    const out = await fieldPreviews(
      schema,
      'post',
      FILE,
      db({ cover: { src: './old.png' } }),
      db({ cover: { src: './new.png' } }),
      none,
    );
    expect(out).toEqual({ cover: { stale: true } });
  });

  it('new entry: every field, from empty', async () => {
    const out = await fieldPreviews(schema, 'post', FILE, null, db({ title: 'A', rating: 3 }, 'b'), none);
    expect(out).toEqual({
      title: { text: { from: '', to: 'A' } },
      rating: { text: { from: '', to: '3' } },
      body: { stale: true },
    });
  });
});

describe('mergePreviews', () => {
  it('keeps branch from and form to', () => {
    const out = mergePreviews(
      { 'post/hello': { title: { text: { from: 'A', to: 'B' } }, summary: { text: { from: 's', to: 't' } } } },
      { 'post/hello': { title: { text: { from: 'B', to: 'C' } } }, 'post/new': { title: { stale: true } } },
    );
    expect(out).toEqual({
      'post/hello': { title: { text: { from: 'A', to: 'C' } }, summary: { text: { from: 's', to: 't' } } },
      'post/new': { title: { stale: true } },
    });
  });
});

describe('buildSnapshot', () => {
  it('sets expiresAt from sessionMinutes', () => {
    expect(buildSnapshot('b', {}, 60, 1000)).toEqual({ v: 1, branch: 'b', expiresAt: 3_601_000, entries: {} });
  });
});
