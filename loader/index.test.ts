import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mountEditletLoader, type EditletLoader } from './index';

let handle: EditletLoader | undefined;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog[data-editlet]');
const iframe = () => dialog()?.querySelector('iframe') ?? null;
const mount = (o?: Parameters<typeof mountEditletLoader>[0]) => (handle = mountEditletLoader(o));
const go = (url: string) => history.replaceState(null, '', url);

beforeEach(() => go('/page'));
afterEach(() => {
  handle?.destroy();
  handle = undefined;
  document.querySelectorAll('[data-editlet]').forEach((n) => n.remove());
  document.querySelectorAll('script[data-editlet-preview], script[data-editlet-window]').forEach((n) => n.remove());
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('mountEditletLoader', () => {
  it('does nothing without ?editlet', () => {
    mount();
    expect(dialog()).toBeNull();
    expect(document.querySelector('style[data-editlet]')).toBeNull();
  });

  it('a custom param opens, routes and closes; the admin URL keeps editlet', () => {
    go('/page?editlet=post/a');
    mount({ param: 'cms' });
    expect(dialog()).toBeNull();
    go('/page?x=1&cms=post/a');
    handle!.sync();
    expect(iframe()!.src.endsWith('/editlet/?editlet=post/a')).toBe(true);
    handle!.close();
    expect(location.search).toBe('?x=1');
    expect(dialog()).toBeNull();
  });

  it('opens from ?editlet', () => {
    go('/page?editlet=post/a');
    mount();
    const d = dialog()!;
    expect(d.open).toBe(true);
    expect(d.getAttribute('aria-label')).toBe('Editlet');
    expect(iframe()!.src.endsWith('/editlet/?editlet=post/a')).toBe(true);
    expect(iframe()!.title).toBe('Editlet');
    expect(iframe()!.getAttribute('allow')).toBe('clipboard-write');
    expect(document.querySelectorAll('style[data-editlet]')).toHaveLength(1);
  });

  it('floats over the page: non-modal, so no backdrop, no scroll lock and a usable page behind it', () => {
    go('/page?editlet=post/a');
    const modal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    mount();
    expect(modal).not.toHaveBeenCalled();
    expect(dialog()!.open).toBe(true);
    const css = document.querySelector('style[data-editlet]')!.textContent!;
    expect(css).not.toContain('::backdrop');
    expect(css).not.toContain('html:has');
  });

  it('injects window.js, which moves and resizes the floating window', () => {
    go('/page?editlet=post/a');
    mount();
    const el = document.querySelector<HTMLScriptElement>('script[data-editlet-window]')!;
    expect(el.type).toBe('module');
    expect(el.src.endsWith('/editlet/window.js')).toBe(true);
    handle!.sync();
    expect(document.querySelectorAll('script[data-editlet-window]')).toHaveLength(1);
  });

  it('honours a custom adminUrl', () => {
    go('/page?editlet=post/a');
    mount({ adminUrl: 'https://admin.test/app/' });
    expect(iframe()!.src).toBe('https://admin.test/app/?editlet=post/a');
  });

  it('resolves a path-relative adminUrl against the page', () => {
    go('/blog/page?editlet=x');
    mount({ adminUrl: 'admin/' });
    expect(iframe()!.src).toBe(`${location.origin}/blog/admin/?editlet=x`);
  });

  it('is a singleton', () => {
    go('/page?editlet=a');
    const a = mount();
    expect(mountEditletLoader()).toBe(a);
    expect(document.querySelectorAll('dialog[data-editlet]')).toHaveLength(1);
  });

  it('close() strips cms, keeps other params and history.state', () => {
    history.replaceState({ k: 1 }, '', '/page?x=1&editlet=a');
    mount().close();
    expect(location.pathname + location.search).toBe('/page?x=1');
    expect(dialog()).toBeNull();
    expect(history.state).toEqual({ k: 1 });
  });

  it('sync() tears down when cms vanished, leaving the URL', () => {
    go('/page?editlet=a');
    mount();
    go('/page');
    handle!.sync();
    expect(dialog()).toBeNull();
    expect(location.search).toBe('');
  });

  it('follows popstate', () => {
    mount();
    go('/page?editlet=schema');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(dialog()?.open).toBe(true);
    go('/page');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(dialog()).toBeNull();
  });

  it('rebuilds a detached dialog as a fresh non-modal one', () => {
    go('/page?editlet=a');
    mount();
    const d = dialog()!;
    d.remove();
    expect(dialog()).toBeNull();
    const spy = vi.spyOn(HTMLDialogElement.prototype, 'show');
    handle!.sync();
    const n = dialog()!;
    expect(n.isConnected).toBe(true);
    expect(n.open).toBe(true);
    expect(n).not.toBe(d);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('ignores a late close event after the loader closed itself', () => {
    go('/page?editlet=a');
    mount();
    const old = dialog()!;
    handle!.close();
    go('/page?editlet=x');
    old.dispatchEvent(new Event('close'));
    expect(location.search).toBe('?editlet=x');
  });

  it('writes the URL through a custom replaceUrl', () => {
    go('/page?x=1&editlet=a');
    const replaceUrl = vi.fn();
    mount({ replaceUrl });
    const native = vi.spyOn(history, 'replaceState');
    handle!.close();
    expect(replaceUrl).toHaveBeenCalledExactlyOnceWith(`${location.origin}/page?x=1`);
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  it('shows a close button until the admin is ready', () => {
    go('/page?x=1&editlet=a');
    mount();
    const b = dialog()!.querySelector<HTMLButtonElement>('button[data-editlet-close]')!;
    expect(b.type).toBe('button');
    expect(b.getAttribute('aria-label')).toBe('Close Editlet');
    expect(b.textContent).toBe('×');
    b.click();
    expect(location.search).toBe('?x=1');
    expect(dialog()).toBeNull();
  });

  it('destroy() removes everything and allows a fresh mount', () => {
    go('/page?editlet=a');
    const a = mount();
    a.destroy();
    expect(dialog()).toBeNull();
    expect(location.search).toBe('?editlet=a');
    go('/page?editlet=b');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(dialog()).toBeNull();
    const b = mount();
    expect(b).not.toBe(a);
    expect(dialog()).not.toBeNull();
  });

  it('focuses the iframe on load', () => {
    go('/page?editlet=a');
    mount();
    iframe()!.dispatchEvent(new Event('load'));
    expect(document.activeElement).toBe(iframe());
  });
});

const script = () => document.querySelectorAll<HTMLScriptElement>('script[data-editlet-preview]');

describe('preview script', () => {
  it('injects preview.js when the flag is set', () => {
    localStorage.setItem('editlet:preview', 'editlet/x');
    mount();
    expect(script()).toHaveLength(1);
    expect(script()[0]!.type).toBe('module');
    expect(script()[0]!.src.endsWith('/editlet/preview.js')).toBe(true);
  });

  it('injects with ?editlet', () => {
    go('/page?editlet=post/a');
    mount();
    expect(script()).toHaveLength(1);
  });

  it('resolves against index.html admin URLs', () => {
    localStorage.setItem('editlet:preview', 'b');
    mount({ adminUrl: '/editlet/index.html' });
    expect(script()[0]!.getAttribute('src')).toBe(`${location.origin}/editlet/preview.js`);
  });

  it('injects nothing without flag or ?editlet', () => {
    mount();
    expect(script()).toHaveLength(0);
  });

  it('injects once across sync() calls and when ?editlet appears later', () => {
    const h = mount();
    go('/page?editlet=a');
    h.sync();
    h.sync();
    expect(script()).toHaveLength(1);
  });

  it('survives a throwing localStorage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => mount()).not.toThrow();
    expect(script()).toHaveLength(0);
  });
});
