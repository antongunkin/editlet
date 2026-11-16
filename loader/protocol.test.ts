import { describe, expect, it } from 'vitest';

import {
  FIELD_ATTR,
  PREVIEW_CHANNEL,
  PREVIEW_DB,
  PREVIEW_FLAG_KEY,
  PREVIEW_KEY,
  PREVIEW_ROUTE,
  PREVIEW_SCRIPT,
  PREVIEW_STORE,
  adminMessage,
  fieldMark,
  isAdminToSiteMessage,
  isPreviewChannelMessage,
  isPreviewSnapshot,
  isSiteToAdminMessage,
  readEditletRoute,
  siteMessage,
  withEditletRoute,
} from './protocol';

const adminBodies = [
  { type: 'ready' },
  { type: 'navigate', route: 'schema' },
  { type: 'close' },
  { type: 'refresh' },
  { type: 'highlight', entry: 'post/a' },
  { type: 'highlight', entry: null },
  { type: 'layout', layout: 'side' },
  { type: 'layout', layout: 'full' },
] as const;

const siteBodies = [
  { type: 'init', route: '', site: { origin: 'https://s.dev', href: 'https://s.dev/a' } },
  { type: 'navigate', route: 'post/a' },
  { type: 'close-request' },
] as const;

describe('protocol', () => {
  it('builds envelopes', () => {
    expect(adminMessage({ type: 'navigate', route: 'schema' })).toEqual({
      source: 'editlet',
      v: 1,
      type: 'navigate',
      route: 'schema',
    });
  });

  it.each(adminBodies)('admin guard accepts built %j', (body) => {
    expect(isAdminToSiteMessage(adminMessage(body))).toBe(true);
  });

  it.each(siteBodies)('site guard accepts built %j', (body) => {
    expect(isSiteToAdminMessage(siteMessage(body))).toBe(true);
  });

  const env = { source: 'editlet', v: 1 };
  const bad: [string, unknown][] = [
    ['null', null],
    ['string', 'str'],
    ['empty object', {}],
    ['wrong source', { source: 'x', v: 1, type: 'ready' }],
    ['v2', { source: 'editlet', v: 2, type: 'ready' }],
    ['unknown type', { ...env, type: 'nope' }],
    ['navigate without route', { ...env, type: 'navigate' }],
    ['navigate route number', { ...env, type: 'navigate', route: 1 }],
    ['highlight entry number', { ...env, type: 'highlight', entry: 5 }],
    ['layout wide', { ...env, type: 'layout', layout: 'wide' }],
  ];
  it.each(bad)('admin guard rejects %s', (_n, data) => {
    expect(isAdminToSiteMessage(data)).toBe(false);
  });

  it('site guard rejects bad init and cross-direction types', () => {
    expect(isSiteToAdminMessage({ ...env, type: 'init', route: '', site: { origin: 'o' } })).toBe(false);
    expect(isSiteToAdminMessage({ ...env, type: 'init', route: '' })).toBe(false);
    expect(isSiteToAdminMessage(null)).toBe(false);
    expect(isSiteToAdminMessage({ ...env, type: 'ready' })).toBe(false);
    expect(isAdminToSiteMessage({ ...env, type: 'close-request' })).toBe(false);
  });

  it('readEditletRoute', () => {
    expect(readEditletRoute('/')).toBeNull();
    expect(readEditletRoute('/?editlet')).toBe('');
    expect(readEditletRoute('/?editlet=')).toBe('');
    expect(readEditletRoute('/?x=1&editlet=post/hello-world#h')).toBe('post/hello-world');
    expect(readEditletRoute('https://s.dev/a?editlet=branch:homepage-edits')).toBe('branch:homepage-edits');
    expect(readEditletRoute(new URL('https://s.dev/a?editlet=schema'))).toBe('schema');
  });

  it('withEditletRoute', () => {
    expect(withEditletRoute('/a', '')).toBe('/a?editlet');
    expect(withEditletRoute('/a?x=1#top', 'post/a')).toBe('/a?x=1&editlet=post/a#top');
    expect(withEditletRoute('https://s.dev/a?editlet=old&x=1', 'schema')).toBe('https://s.dev/a?x=1&editlet=schema');
    expect(withEditletRoute('/a?x=1&editlet=post/a#top', null)).toBe('/a?x=1#top');
    expect(withEditletRoute('/a?editlet', null)).toBe('/a');
    expect(withEditletRoute('/a?editlet=x', 'branch:b')).toBe('/a?editlet=branch:b');
  });

  it('read and write another param name', () => {
    expect(readEditletRoute('/?cms=post/a&editlet=x', 'cms')).toBe('post/a');
    expect(withEditletRoute('/a?editlet=x&cms=old', 'schema', 'cms')).toBe('/a?editlet=x&cms=schema');
    expect(withEditletRoute('/a?cms&x=1', null, 'cms')).toBe('/a?x=1');
  });

  it('withEditletRoute keeps other params byte-for-byte', () => {
    expect(withEditletRoute('/a?debug&q=a%20b&t=a/b', 'x')).toBe('/a?debug&q=a%20b&t=a/b&editlet=x');
    expect(withEditletRoute('/a?debug&q=a%20b&t=a/b', null)).toBe('/a?debug&q=a%20b&t=a/b');
    expect(withEditletRoute('/a?editlet=1&debug&%65ditlet=2', null)).toBe('/a?debug');
  });

  it('withEditletRoute handles protocol-relative and URL inputs', () => {
    expect(withEditletRoute('//host.dev/a?x=1', 'schema')).toBe('//host.dev/a?x=1&editlet=schema');
    expect(withEditletRoute(new URL('https://s.dev/a?x=1'), 'schema')).toBe('https://s.dev/a?x=1&editlet=schema');
  });

  it('guards reject missing highlight entry and non-string init route', () => {
    expect(isAdminToSiteMessage({ ...env, type: 'highlight' })).toBe(false);
    const site = { origin: 'o', href: 'h' };
    expect(isSiteToAdminMessage({ ...env, type: 'init', route: 1, site })).toBe(false);
  });

  it.each(['', 'schema', 'post/hello-world', 'branch:homepage-edits', 'a b&c#d?e', 'пост/привет'])(
    'round-trips %j',
    (r) => {
      expect(readEditletRoute(withEditletRoute('/p?x=1#h', r))).toBe(r);
    },
  );
});

const valid = () => ({
  v: 1,
  branch: 'editlet/x',
  expiresAt: 123,
  entries: {
    'post/a': {
      title: { text: { from: 'Old', to: 'New' } },
      cover: { image: { from: 'post/a/cover.webp', to: new Blob(['x']), alt: { from: 'a', to: 'b' } } },
      body: { stale: true },
    },
  },
});

describe('preview contract', () => {
  it('constants keep their wire values', () => {
    expect(FIELD_ATTR).toBe('data-editlet-field');
    expect(PREVIEW_FLAG_KEY).toBe('editlet:preview');
    expect(PREVIEW_CHANNEL).toBe('editlet:preview');
    expect(PREVIEW_DB).toBe('editlet-preview');
    expect(PREVIEW_STORE).toBe('snapshot');
    expect(PREVIEW_KEY).toBe('current');
    expect(PREVIEW_SCRIPT).toBe('preview.js');
    expect(PREVIEW_ROUTE).toBe('/api/editlet/preview');
  });

  it('fieldMark joins entry and field', () => {
    expect(fieldMark('post/a', 'title')).toBe('post/a#title');
  });

  it('isPreviewSnapshot accepts a valid snapshot', () => {
    expect(isPreviewSnapshot(valid())).toBe(true);
  });

  it('isPreviewSnapshot rejects', () => {
    expect(isPreviewSnapshot({ ...valid(), v: 2 })).toBe(false);
    const { expiresAt: _e, ...noExpiry } = valid();
    expect(isPreviewSnapshot(noExpiry)).toBe(false);
    expect(isPreviewSnapshot({ ...valid(), entries: 'x' })).toBe(false);
    expect(isPreviewSnapshot({ ...valid(), entries: { a: { t: { text: { from: 'a' } } } } })).toBe(false);
    expect(isPreviewSnapshot({ ...valid(), entries: { a: { i: { image: { from: 'a', to: 'str' } } } } })).toBe(false);
    expect(isPreviewSnapshot(null)).toBe(false);
  });

  it('isPreviewChannelMessage', () => {
    expect(isPreviewChannelMessage({ source: 'editlet', type: 'snapshot' })).toBe(true);
    expect(isPreviewChannelMessage({ source: 'other', type: 'snapshot' })).toBe(false);
    expect(isPreviewChannelMessage({ source: 'editlet', type: 'nope' })).toBe(false);
  });
});
