import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mountEditletLoader,
  siteMessage,
  type MessageBody,
  type EditletLoader,
  type AdminToSiteMessage,
} from './index';

let handle: EditletLoader | undefined;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog[data-editlet]');
const iframe = () => dialog()?.querySelector('iframe') ?? null;
const mount = (o?: Parameters<typeof mountEditletLoader>[0]) => (handle = mountEditletLoader(o));
const go = (url: string) => history.replaceState(null, '', url);
const env = (body: object) => ({ source: 'editlet', v: 1, ...body });
const fromAdmin = (
  body: unknown,
  { origin = location.origin, source = iframe()?.contentWindow ?? null }: { origin?: string; source?: unknown } = {},
) => window.dispatchEvent(new MessageEvent('message', { data: body, origin, source: source as MessageEventSource }));
const admin = (body: MessageBody<AdminToSiteMessage>, o?: Parameters<typeof fromAdmin>[1]) => fromAdmin(env(body), o);
const spy = () => vi.spyOn(iframe()!.contentWindow!, 'postMessage');
const open = (o?: Parameters<typeof mountEditletLoader>[0]) => {
  go('/page?editlet=post/a');
  mount(o);
};
const scroll = vi.fn();

beforeEach(() => {
  go('/page');
  scroll.mockReset();
  Element.prototype.scrollIntoView = scroll;
});
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.body.innerHTML = '';
  document.querySelectorAll('[data-editlet]').forEach((n) => n.remove());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handshake', () => {
  it('answers ready with init', () => {
    open();
    const post = spy();
    admin({ type: 'ready' });
    expect(post).toHaveBeenCalledWith(
      siteMessage({
        type: 'init',
        route: 'post/a',
        site: { origin: location.origin, href: `${location.origin}/page` },
      }),
      location.origin,
    );
  });

  it('targets the admin origin', () => {
    open({ adminUrl: 'https://admin.test/' });
    const post = spy();
    admin({ type: 'ready' }, { origin: 'https://admin.test' });
    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0]![1]).toBe('https://admin.test');
  });

  it('removes the close button on ready', () => {
    open();
    expect(dialog()!.querySelector('[data-editlet-close]')).not.toBeNull();
    admin({ type: 'ready' });
    expect(dialog()!.querySelector('[data-editlet-close]')).toBeNull();
  });

  it('re-inits on a second ready', () => {
    open();
    const post = spy();
    admin({ type: 'ready' });
    admin({ type: 'ready' });
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe('message filter', () => {
  it('ignores untrusted messages', () => {
    open();
    const post = spy();
    const cases: [unknown, { origin?: string; source?: unknown }][] = [
      [env({ type: 'ready' }), { origin: 'https://evil.test' }],
      [env({ type: 'ready' }), { source: window }],
      [env({ type: 'ready' }), { source: null }],
      [{ source: 'editlet', v: 1, type: 'close' }, { origin: 'https://evil.test' }],
      [{ type: 'close' }, {}],
      [{ source: 'editlet', v: 2, type: 'ready' }, {}],
    ];
    for (const [data, o] of cases) fromAdmin(data, o);
    expect(post).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it('ignores a null-source message with no dialog', () => {
    mount();
    expect(() => fromAdmin(env({ type: 'close' }), { source: null })).not.toThrow();
  });

  it('stops listening after destroy', () => {
    const onRefresh = vi.fn();
    open({ onRefresh });
    const f = iframe()!;
    handle!.destroy();
    fromAdmin(env({ type: 'refresh' }), { source: f.contentWindow });
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe('navigate / close / refresh', () => {
  it('writes the route to the URL and then sync posts nothing', () => {
    open();
    admin({ type: 'ready' });
    const post = spy();
    admin({ type: 'navigate', route: 'schema' });
    expect(location.search).toBe('?editlet=schema');
    handle!.sync();
    expect(post).not.toHaveBeenCalled();
  });

  it('writes navigate through a custom replaceUrl', () => {
    const replaceUrl = vi.fn();
    open({ replaceUrl });
    const native = vi.spyOn(history, 'replaceState');
    admin({ type: 'navigate', route: 'schema' });
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith(`${location.origin}/page?editlet=schema`);
    expect(native).not.toHaveBeenCalled();
  });

  it('close strips cms and removes the dialog', () => {
    open();
    admin({ type: 'close' });
    expect(location.search).toBe('');
    expect(dialog()).toBeNull();
  });

  it('refresh calls onRefresh', () => {
    const onRefresh = vi.fn();
    open({ onRefresh });
    admin({ type: 'refresh' });
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('refresh reloads by default', () => {
    const reload = vi.fn();
    const real = window.location;
    vi.stubGlobal('location', new Proxy({}, { get: (_, k) => (k === 'reload' ? reload : Reflect.get(real, k)) }));
    open();
    admin({ type: 'refresh' });
    expect(reload).toHaveBeenCalledOnce();
  });
});

const dom = () => {
  document.body.insertAdjacentHTML(
    'beforeend',
    '<p id="a1" data-editlet-entry="post/a"></p><p id="a2" data-editlet-entry="post/a"></p><p id="b" data-editlet-entry="post/b"></p>',
  );
};
const lit = () => [...document.querySelectorAll('[data-editlet-highlight]')].map((e) => e.id);

describe('highlight', () => {
  it('highlights, moves, clears', () => {
    dom();
    open();
    admin({ type: 'highlight', entry: 'post/a' });
    expect(lit()).toEqual(['a1', 'a2']);
    expect(scroll).toHaveBeenCalledOnce();
    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    admin({ type: 'highlight', entry: 'post/b' });
    expect(lit()).toEqual(['b']);
    admin({ type: 'highlight', entry: null });
    expect(lit()).toEqual([]);
  });

  it('clears on close', () => {
    dom();
    open();
    admin({ type: 'highlight', entry: 'post/a' });
    admin({ type: 'close' });
    expect(lit()).toEqual([]);
  });

  it('survives hostile entry values', () => {
    open();
    expect(() => admin({ type: 'highlight', entry: 'a"]b' })).not.toThrow();
  });
});

describe('layout', () => {
  it('ignores the retired layout message (the floating window is moved by window.js, not the loader)', () => {
    open();
    expect(() => admin({ type: 'layout', layout: 'side' })).not.toThrow();
    expect(dialog()!.dataset.layout).toBeUndefined();
    expect(dialog()!.open).toBe(true);
  });
});

describe('popstate', () => {
  it('posts navigate after ready', () => {
    open();
    admin({ type: 'ready' });
    const post = spy();
    go('/page?editlet=schema');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(siteMessage({ type: 'navigate', route: 'schema' }), location.origin);
  });

  it('posts nothing before ready; init carries the new route', () => {
    open();
    const post = spy();
    go('/page?editlet=schema');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(post).not.toHaveBeenCalled();
    admin({ type: 'ready' });
    expect(post.mock.calls[0]![0]).toMatchObject({ type: 'init', route: 'schema' });
  });
});

describe('open', () => {
  const openOn = (param?: string) => {
    const onOpen = vi.fn();
    go(`/page?${param ?? 'editlet'}=post/a`);
    mount({ onOpen, ...(param ? { param } : {}) });
    admin({ type: 'ready' });
    return onOpen;
  };

  it('goes to the path with the editor parameter and the current route', () => {
    const onOpen = openOn('cms');
    admin({ type: 'open', path: '/posts/a' });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(`${location.origin}/posts/a?cms=post/a`);
  });

  it("keeps the path's own query and hash", () => {
    const onOpen = openOn();
    admin({ type: 'open', path: '/posts/a?x=1#top' });
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(`${location.origin}/posts/a?x=1&editlet=post/a#top`);
  });

  it.each([
    '//evil.test/x',
    '/\\evil.test/x',
    '/\t/evil.test/x',
    '/\n/evil.test',
    '/\r\\evil.test',
    ' //evil.test',
    'https://evil.test/',
    'javascript:alert(1)',
    'posts/a',
    '',
  ])('ignores %j', (path) => {
    const onOpen = openOn();
    admin({ type: 'open', path });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('assigns the location by default', () => {
    const assign = vi.fn();
    const real = window.location;
    vi.stubGlobal('location', new Proxy({}, { get: (_, k) => (k === 'assign' ? assign : Reflect.get(real, k)) }));
    open();
    admin({ type: 'ready' });
    admin({ type: 'open', path: '/posts/a' });
    expect(assign).toHaveBeenCalledExactlyOnceWith(`${real.origin}/posts/a?editlet=post/a`);
  });
});

describe('page', () => {
  it('posts the new address once after a client-side navigation', () => {
    open();
    admin({ type: 'ready' });
    const post = spy();
    history.pushState(null, '', '/posts/a?editlet=post/a');
    handle!.sync();
    expect(post).toHaveBeenCalledExactlyOnceWith(
      siteMessage({ type: 'page', href: `${location.origin}/posts/a` }),
      location.origin,
    );
    handle!.sync();
    expect(post).toHaveBeenCalledOnce();
  });

  it('posts only navigate on a route change', () => {
    open();
    admin({ type: 'ready' });
    const post = spy();
    go('/page?editlet=schema');
    handle!.sync();
    expect(post).toHaveBeenCalledExactlyOnceWith(siteMessage({ type: 'navigate', route: 'schema' }), location.origin);
  });

  it('posts nothing before ready; init carries the address', () => {
    open();
    const post = spy();
    go('/other?editlet=post/a');
    handle!.sync();
    expect(post).not.toHaveBeenCalled();
    admin({ type: 'ready' });
    expect(post).toHaveBeenCalledExactlyOnceWith(
      siteMessage({
        type: 'init',
        route: 'post/a',
        site: { origin: location.origin, href: `${location.origin}/other` },
      }),
      location.origin,
    );
    handle!.sync();
    expect(post).toHaveBeenCalledOnce();
  });
});

describe('highlight after a client-side navigation', () => {
  it('is applied again on a new pathname', () => {
    dom();
    open();
    admin({ type: 'highlight', entry: 'post/a' });
    expect(scroll).toHaveBeenCalledOnce();
    document.body.querySelectorAll('[data-editlet-entry]').forEach((n) => n.remove());
    dom();
    history.pushState(null, '', '/posts/a?editlet=post/a');
    handle!.sync();
    expect(lit()).toEqual(['a1', 'a2']);
    expect(scroll).toHaveBeenCalledTimes(2);
  });

  it("is not applied again after the loader's own URL write or a same-page popstate", () => {
    dom();
    open();
    admin({ type: 'ready' });
    admin({ type: 'highlight', entry: 'post/a' });
    admin({ type: 'navigate', route: 'post/b' });
    handle!.sync();
    go('/page?editlet=post/a');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(scroll).toHaveBeenCalledOnce();
  });

  it('is forgotten after highlight null and after close', () => {
    dom();
    open();
    admin({ type: 'highlight', entry: 'post/a' });
    admin({ type: 'highlight', entry: null });
    history.pushState(null, '', '/posts/a?editlet=post/a');
    handle!.sync();
    expect(lit()).toEqual([]);
    admin({ type: 'highlight', entry: 'post/a' });
    admin({ type: 'close' });
    go('/elsewhere?editlet=post/a');
    handle!.sync();
    expect(lit()).toEqual([]);
  });
});
