import { vi } from 'vitest';

import { siteMessage, type MessageBody, type SiteToAdminMessage } from '../../../loader/protocol';

export const ORIGIN = 'http://localhost';

export type FakeParent = { postMessage: ReturnType<typeof vi.fn> };

export type FakeWindow = {
  win: Window;
  parent: FakeParent;
  /** Dispatch a `message` event on the fake window. */
  receive(data: unknown, opts?: { origin?: string; source?: unknown }): void;
  /** Dispatch a site → admin message from the parent at `ORIGIN` (override with `opts`). */
  fromSite(body: MessageBody<SiteToAdminMessage>, opts?: { origin?: string; source?: unknown }): void;
};

/**
 * A `Window` stand-in: `parent` is a separate object with a `postMessage` spy (or the window itself when
 * `standalone`), `location`/`history` are minimal, and events go through a real `EventTarget`.
 */
export function createFakeWindow(opts: { href?: string; standalone?: boolean } = {}): FakeWindow {
  const target = new EventTarget();
  const parent: FakeParent = { postMessage: vi.fn() };
  const location = {
    href: opts.href ?? `${ORIGIN}/editlet/`,
    get origin() {
      return new URL(this.href).origin;
    },
  };
  const history = {
    state: null as unknown,
    replaceState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      history.state = state;
      if (url != null) location.href = new URL(url, location.href).href;
    }),
    pushState: vi.fn((state: unknown, _title: string, url?: string | URL | null) => {
      history.state = state;
      if (url != null) location.href = new URL(url, location.href).href;
    }),
  };
  const fake: Record<string, unknown> = {
    location,
    history,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
  fake.parent = opts.standalone ? fake : parent;
  const win = fake as unknown as Window;

  const receive: FakeWindow['receive'] = (data, o = {}) => {
    const ev = new MessageEvent('message', { data, origin: o.origin ?? ORIGIN });
    // jsdom's MessageEvent only accepts real windows/ports as `source`.
    Object.defineProperty(ev, 'source', { value: 'source' in o ? o.source : parent });
    target.dispatchEvent(ev);
  };
  return { win, parent, receive, fromSite: (body, o) => receive(siteMessage(body), o) };
}
