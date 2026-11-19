import { adminMessage, isSiteToAdminMessage, type AdminToSiteMessage, type MessageBody } from '../../loader/protocol';

export type BridgeHandlers = {
  /** The site's `init` (also re-sent when the site answers a later `ready`), with the page's href (no editor parameter). */
  onInit(route: string, href: string): void;
  /** The page's href changed (a client navigation; no editor parameter). Optional: older callers ignore it. */
  onPage?(href: string): void;
  /** The site's page URL changed while the admin is open. */
  onNavigate(route: string): void;
  /** Escape on the site page: answer with `close` when it is safe. */
  onCloseRequest(): void;
};

export type Bridge = {
  /** `win.parent !== win`. */
  embedded: boolean;
  /** True once an `init` was accepted and its origin pinned. */
  connected(): boolean;
  /** Posts to the pinned origin. A no-op without a parent page or before `init`. */
  send(body: MessageBody<AdminToSiteMessage>): void;
  destroy(): void;
};

/**
 * The admin side of the loader protocol (docs/loader/protocol.md, "Rules for the admin"). Accepts the first `init`
 * only from `win.parent` at the admin's own origin, pins that `event.origin`, and afterwards accepts and posts only
 * to it. `ready` is the only message posted with `'*'`.
 */
export function createBridge(win: Window, handlers: BridgeHandlers): Bridge {
  const embedded = win.parent !== win;
  let pinned: string | null = null;

  const onMessage = (e: MessageEvent) => {
    if (e.source !== win.parent || !isSiteToAdminMessage(e.data)) return;
    if (pinned === null) {
      if (e.data.type !== 'init' || e.origin !== win.location.origin) return;
      pinned = e.origin;
    } else if (e.origin !== pinned) return;
    const m = e.data;
    if (m.type === 'init') handlers.onInit(m.route, m.site.href);
    else if (m.type === 'navigate') handlers.onNavigate(m.route);
    else if (m.type === 'page') handlers.onPage?.(m.href);
    else if (m.type === 'close-request') handlers.onCloseRequest();
  };

  if (embedded) {
    win.addEventListener('message', onMessage);
    win.parent.postMessage(adminMessage({ type: 'ready' }), '*');
  }

  return {
    embedded,
    connected: () => pinned !== null,
    send(body) {
      if (embedded && pinned !== null) win.parent.postMessage(adminMessage(body), pinned);
    },
    destroy() {
      if (embedded) win.removeEventListener('message', onMessage);
    },
  };
}
