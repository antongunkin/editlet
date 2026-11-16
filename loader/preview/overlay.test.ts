// jsdom for the DOM and MutationObserver. Snapshots here carry text values only: fake-indexeddb's structured clone
// cannot carry a jsdom Blob (see db.test.ts), so image values go through `createUrlCache` tests without IndexedDB.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announceSnapshot, clearSnapshot, readPreviewFlag, readSnapshot, setPreviewFlag, writeSnapshot } from './db';
import { PILL_ATTR } from './match';
import { createUrlCache, startOverlay as start, type Overlay } from './overlay';

import { EDITLET_SOURCE, PREVIEW_CHANNEL, PREVIEW_ROUTE, type PreviewSnapshot } from '../protocol';
import { WINDOW_SOURCE } from '../window/channel';

// In-memory BroadcastChannel: delivers to every other open channel with the same name, asynchronously.
class Bus {
  static open = new Set<Bus>();
  private listeners: ((e: MessageEvent) => void)[] = [];
  constructor(readonly name: string) {
    Bus.open.add(this);
  }
  addEventListener(_type: 'message', fn: (e: MessageEvent) => void): void {
    this.listeners.push(fn);
  }
  postMessage(data: unknown): void {
    for (const c of Bus.open) {
      if (c === this || c.name !== this.name) continue;
      setTimeout(() => {
        for (const fn of c.listeners) fn({ data } as MessageEvent);
      }, 0);
    }
  }
  close(): void {
    Bus.open.delete(this);
  }
}

const snap = (to = 'New', expiresAt = Date.now() + 60_000): PreviewSnapshot => ({
  v: 1,
  branch: 'editlet/x',
  expiresAt,
  entries: { 'post/a': { title: { text: { from: 'Old', to } } } },
});

const startOverlay = (...args: Parameters<typeof start>): Overlay => {
  const o = start(...args);
  started.push(o);
  return o;
};

const tick = () => new Promise((r) => setTimeout(r, 20));
const pill = () => document.querySelector(`[${PILL_ATTR}]`);
const pillText = () => pill()?.shadowRoot?.textContent ?? null;
const h1 = () => document.querySelector('h1')!.textContent;

let idb: IDBFactory;
/** Overlays a test started: stopped after each test, so a failing one cannot patch the next test's page. */
let started: Overlay[];
let reload: ReturnType<typeof vi.fn>;
let win: Window;

beforeEach(() => {
  started = [];
  document.body.innerHTML = '<article data-editlet-entry="post/a"><h1>Old</h1></article>';
  idb = new IDBFactory();
  reload = vi.fn();
  vi.stubGlobal('BroadcastChannel', Bus);
  win = {
    document,
    localStorage,
    location: { reload },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    MutationObserver,
    BroadcastChannel: Bus,
    URL,
  } as unknown as Window;
  setPreviewFlag('editlet/x', localStorage);
});

afterEach(() => {
  for (const o of started) o.stop();
  vi.unstubAllGlobals();
  Bus.open.clear();
  localStorage.clear();
});

describe('startOverlay', () => {
  it('applies the stored snapshot and shows the pill', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(h1()).toBe('New');
    expect(pillText()).toBe('Preview: editlet/x · 1 changes · 0 update after Save/deploy · Exit');
    expect(pill()!.shadowRoot!.querySelector('button')!.textContent).toBe('Exit');
    o.stop();
  });

  it('drops an expired snapshot and the flag', async () => {
    await writeSnapshot(snap('New', 1000), idb);
    const o = startOverlay({ win, idb, now: () => 2000 });
    await o.ready;
    expect(h1()).toBe('Old');
    expect(pill()).toBeNull();
    expect(await readSnapshot(idb)).toBeNull();
    expect(readPreviewFlag(localStorage)).toBeNull();
    o.stop();
  });

  it('re-applies on a channel message', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    await writeSnapshot(snap('Newer'), idb);
    announceSnapshot();
    await vi.waitFor(() => expect(h1()).toBe('Newer'));
    expect(pillText()).toContain('1 changes');
    o.stop();
  });

  it('picks up a snapshot written after start', async () => {
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(pill()).toBeNull();
    await writeSnapshot(snap(), idb);
    announceSnapshot();
    await vi.waitFor(() => expect(h1()).toBe('New'));
    expect(pill()).not.toBeNull();
    o.stop();
  });

  it('re-applies after an external write resets a patched node', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    document.querySelector('h1')!.textContent = 'Old';
    await vi.waitFor(() => expect(h1()).toBe('New'));
    // Its own writes do not re-trigger it: stays stable.
    await tick();
    expect(h1()).toBe('New');
    o.stop();
  });

  it('still patches after the page replaces <body> (client navigation)', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(h1()).toBe('New');
    const body = document.createElement('body');
    body.append(document.createElement('main'));
    body.firstElementChild!.append(Object.assign(document.createElement('h1'), { textContent: 'Old' }));
    document.documentElement.replaceChild(body, document.body);
    await vi.waitFor(() => expect(h1()).toBe('New'));
    o.stop();
  });

  it('re-attaches the pill when the page removes it', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    const host = pill()!;
    host.remove();
    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(pill()).not.toBeNull());
    expect(pill()!.isConnected).toBe(true);
    expect(pillText()).toContain('1 changes');
    o.stop();
    expect(pill()).toBeNull();
  });

  it('a failed load does not stop later updates', async () => {
    await writeSnapshot(snap(), idb);
    let broken = true;
    const now = () => {
      if (broken) throw new Error('clock unavailable');
      return Date.now();
    };
    const o = startOverlay({ win, idb, now });
    await o.ready.catch(() => undefined);
    expect(h1()).toBe('Old');
    broken = false;
    announceSnapshot();
    await vi.waitFor(() => expect(h1()).toBe('New'));
    o.stop();
  });

  it('coalesces mutations into one frame and does not loop on its own writes', async () => {
    await writeSnapshot(snap(), idb);
    const raf = vi.fn((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    const o = startOverlay({ win: { ...win, requestAnimationFrame: raf } as unknown as Window, idb });
    await o.ready;
    expect(raf).not.toHaveBeenCalled();
    document.querySelector('h1')!.textContent = 'Old';
    document.body.append(document.createElement('p'));
    await vi.waitFor(() => expect(h1()).toBe('New'));
    await tick();
    expect(raf).toHaveBeenCalledTimes(1);
    o.stop();
  });

  it('removes the pill when the snapshot is cleared', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(pill()).not.toBeNull();
    await clearSnapshot(idb);
    announceSnapshot();
    await vi.waitFor(() => expect(pill()).toBeNull());
    expect(h1()).toBe('Old');
    o.stop();
  });

  it('exit clears state, calls DELETE when config.preview, reloads', async () => {
    await writeSnapshot(snap(), idb);
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input) === 'https://admin.test/config.json'
        ? new Response(JSON.stringify({ preview: true }))
        : new Response(null, { status: 204 }),
    );
    const o = startOverlay({
      win,
      idb,
      fetch: fetch as typeof globalThis.fetch,
      configUrl: 'https://admin.test/config.json',
    });
    await o.ready;
    const sibling = new Bus(PREVIEW_CHANNEL);
    const heard = vi.fn();
    sibling.addEventListener('message', (e) => heard(e.data));
    pill()!.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(PREVIEW_ROUTE, { method: 'DELETE', credentials: 'same-origin' });
    expect(PREVIEW_ROUTE).toBe('/api/editlet/preview');
    expect(readPreviewFlag(localStorage)).toBeNull();
    expect(await readSnapshot(idb)).toBeNull();
    await vi.waitFor(() => expect(heard).toHaveBeenCalledWith({ source: EDITLET_SOURCE, type: 'snapshot' }));
    sibling.close();
  });

  it('exit skips DELETE without config.preview', async () => {
    await writeSnapshot(snap(), idb);
    const fetch = vi.fn(async () => new Response(JSON.stringify({})));
    const o = startOverlay({
      win,
      idb,
      fetch: fetch as typeof globalThis.fetch,
      configUrl: 'https://admin.test/config.json',
    });
    await o.ready;
    pill()!.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://admin.test/config.json');
    expect(readPreviewFlag(localStorage)).toBeNull();
  });

  it('exit still reloads when the config fetch fails', async () => {
    await writeSnapshot(snap(), idb);
    const fetch = vi.fn(async () => {
      throw new TypeError('offline');
    });
    const o = startOverlay({
      win,
      idb,
      fetch: fetch as typeof globalThis.fetch,
      configUrl: 'https://admin.test/config.json',
    });
    await o.ready;
    pill()!.shadowRoot!.querySelector('button')!.click();
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(readPreviewFlag(localStorage)).toBeNull();
  });

  it('stop() disconnects observer and channel', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    expect([...Bus.open].filter((c) => c.name === PREVIEW_CHANNEL)).toHaveLength(1);
    o.stop();
    expect(Bus.open.size).toBe(0);
    expect(pill()).toBeNull();
    expect(h1()).toBe('Old');
    document.querySelector('h1')!.textContent = 'Old';
    await tick();
    expect(h1()).toBe('Old');
  });

  it('stop() before ready applies nothing', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    o.stop();
    await o.ready;
    expect(h1()).toBe('Old');
    expect(pill()).toBeNull();
    expect(Bus.open.size).toBe(0);
  });
});

describe('createUrlCache', () => {
  it('creates one URL per Blob and revokes all on clear', () => {
    let n = 0;
    const url = {
      createObjectURL: vi.fn(() => `blob:${++n}`),
      revokeObjectURL: vi.fn(),
    } as unknown as typeof URL;
    const cache = createUrlCache(url);
    const a = new Blob(['a']);
    const b = new Blob(['b']);
    expect(cache.get(a)).toBe('blob:1');
    expect(cache.get(a)).toBe('blob:1');
    expect(cache.get(b)).toBe('blob:2');
    cache.clear();
    expect(url.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(cache.get(a)).toBe('blob:3');
  });
});

describe('with the editor window open', () => {
  /** The loader's dialog and iframe; `posted` collects what the overlay posts to the admin. */
  const openEditor = () => {
    const dialog = document.createElement('dialog');
    dialog.dataset.editlet = '';
    const frame = document.createElement('iframe');
    frame.src = `${location.origin}/editlet/?editlet`;
    dialog.append(frame);
    document.body.append(dialog);
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage');
    return { dialog, frame, posted };
  };
  const fromAdmin = (frame: HTMLIFrameElement, data: unknown, origin = location.origin) =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source: frame.contentWindow }));

  it('shows no floating pill; the state goes to the admin for its status bar', async () => {
    await writeSnapshot(snap(), idb);
    const { frame, posted } = openEditor();
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(pill()).toBeNull();
    expect(posted).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'preview', state: { branch: 'editlet/x', patched: 1, pending: 0 } },
      location.origin,
    );
    // The admin mounts later and asks.
    posted.mockClear();
    fromAdmin(frame, { source: WINDOW_SOURCE, type: 'hello' });
    expect(posted).toHaveBeenCalledOnce();
  });

  it('brings the pill back when the editor closes, and hides it when it opens', async () => {
    await writeSnapshot(snap(), idb);
    const o = startOverlay({ win, idb });
    await o.ready;
    expect(pill()).not.toBeNull();
    const { dialog } = openEditor();
    await vi.waitFor(() => expect(pill()).toBeNull());
    dialog.remove();
    await vi.waitFor(() => expect(pill()).not.toBeNull());
  });

  it('tells the admin when the preview ends', async () => {
    await writeSnapshot(snap(), idb);
    const { posted } = openEditor();
    const o = startOverlay({ win, idb });
    await o.ready;
    o.stop();
    expect(posted).toHaveBeenLastCalledWith({ source: WINDOW_SOURCE, type: 'preview', state: null }, location.origin);
  });

  it('Exit from the admin ends the preview, like the pill’s button', async () => {
    await writeSnapshot(snap(), idb);
    const { frame } = openEditor();
    const o = startOverlay({ win, idb });
    await o.ready;
    fromAdmin(frame, { source: WINDOW_SOURCE, type: 'preview-exit' });
    await vi.waitFor(() => expect(reload).toHaveBeenCalled());
    expect(await readSnapshot(idb)).toBeNull();
    expect(readPreviewFlag(localStorage)).toBeNull();
  });

  it('ignores Exit from another origin or another window', async () => {
    await writeSnapshot(snap(), idb);
    const { frame } = openEditor();
    const o = startOverlay({ win, idb });
    await o.ready;
    fromAdmin(frame, { source: WINDOW_SOURCE, type: 'preview-exit' }, 'https://evil.test');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: WINDOW_SOURCE, type: 'preview-exit' },
        origin: location.origin,
        source: window,
      }),
    );
    await tick();
    expect(reload).not.toHaveBeenCalled();
    expect(await readSnapshot(idb)).not.toBeNull();
  });
});
