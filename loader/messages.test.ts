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
