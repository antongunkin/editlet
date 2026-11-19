import {
  DEFAULT_ADMIN_URL,
  EDITLET_PARAM,
  EDITLET_SOURCE,
  ENTRY_ATTR,
  HIGHLIGHT_ATTR,
  isAdminToSiteMessage,
  PREVIEW_FLAG_KEY,
  PREVIEW_SCRIPT,
  readEditletRoute,
  siteMessage,
  WINDOW_SCRIPT,
  withEditletRoute,
  type AdminToSiteMessage,
  type MessageBody,
  type SiteToAdminMessage,
} from './protocol';
import { SHEET_MEDIA } from './window/geometry';

export * from './protocol';

export interface EditletLoaderOptions {
  /** Admin page URL, absolute or relative to the site. Default DEFAULT_ADMIN_URL ('/editlet/'). */
  adminUrl?: string;
  /**
   * Query parameter of the site's pages that opens the editor. Default EDITLET_PARAM ('editlet'). The admin's own URL
   * always uses `editlet`.
   */
  param?: string;
  /** Called when the admin reports saved content. Default: location.reload(). */
  onRefresh?: () => void;
  /**
   * Writes the parent URL. Default `history.replaceState(history.state, '', url)`. Next.js App Router adapters
   * pass `(url) => history.replaceState(null, '', url)` so the router syncs.
   */
  replaceUrl?: (url: string) => void;
  /**
   * Goes to another page of the site when the admin asks (`open`): `url` is absolute, same origin, with the editor's
   * parameter. Default `location.assign(url)`. The Next adapter passes `router.push`, so the editor stays mounted.
   */
  onOpen?: (url: string) => void;
}

export interface EditletLoader {
  /** Re-read location: open, re-route or close the editor to match the query parameter. Idempotent. */
  sync(): void;
  /** Close the editor and remove the query parameter from the URL (replaceState). */
  close(): void;
  /** Close without touching the URL, remove listeners, allow a fresh mount. */
  destroy(): void;
}

const KEY = Symbol.for('editlet.loader');

const CSS =
  'dialog[data-editlet]{position:fixed;z-index:2147483000;inset:20px 20px auto auto;width:min(600px,100vw - 40px);height:min(800px,100vh - 40px);max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden;border-radius:20px;box-shadow:0 0 0 2px #80808031}' +
  `@media ${SHEET_MEDIA}{dialog[data-editlet]{inset:auto 0 0;width:100%;height:70dvh;border-radius:20px 20px 0 0}}` +
  'dialog[data-editlet]>iframe{display:block;width:100%;height:100%;border:0}' +
  'dialog[data-editlet]>button{position:absolute;top:8px;right:8px;z-index:1;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:#fff;color:#111;font:24px/32px sans-serif;box-shadow:0 1px 4px #0006;cursor:pointer}' +
  `[${HIGHLIGHT_ATTR}]{outline:3px solid #fa0!important;outline-offset:2px}`;

const clearHighlights = () =>
  document.querySelectorAll(`[${HIGHLIGHT_ATTR}]`).forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));

export function mountEditletLoader(options: EditletLoaderOptions = {}): EditletLoader {
  const g = globalThis as unknown as Record<symbol, EditletLoader | undefined>;
  const existing = g[KEY];
  if (existing) return existing;

  const adminUrl = new URL(options.adminUrl ?? DEFAULT_ADMIN_URL, location.href);
  const replaceUrl = options.replaceUrl ?? ((url: string) => history.replaceState(history.state, '', url));
  const param = options.param || EDITLET_PARAM;
  const setUrl = (route: string | null) => replaceUrl(withEditletRoute(location.href, route, param));
  const s = {
    dialog: null as HTMLDialogElement | null,
    iframe: null as HTMLIFrameElement | null,
    route: '',
    ready: false,
  };
  /** The page href (without the parameter) the admin last got, in `init` or `page`. */
  let href = '';
  /** The last highlighted entry and the pathname it was applied on, re-applied after a client-side navigation. */
  let lit: string | null = null;
  let litPath = '';
  const pageHref = () => withEditletRoute(location.href, null, param);

  const post = (body: MessageBody<SiteToAdminMessage>) =>
    s.iframe?.contentWindow?.postMessage(siteMessage(body), adminUrl.origin);

  const teardown = () => {
    const d = s.dialog;
    if (!d) return;
    s.dialog = s.iframe = null;
    s.ready = false;
    lit = null;
    d.close();
    d.remove();
    clearHighlights();
  };

  const open = () => {
    if (!document.querySelector('style[data-editlet]')) {
      const style = document.createElement('style');
      style.dataset.editlet = '';
      style.textContent = CSS;
      document.head.append(style);
    }
    const d = document.createElement('dialog');
    d.dataset.editlet = '';
    d.ariaLabel = 'Editlet';
    const f = document.createElement('iframe');
    f.title = 'Editlet';
    f.setAttribute('allow', 'clipboard-write');
    f.src = withEditletRoute(adminUrl, s.route);
    f.addEventListener('load', () => f.focus());
    const b = document.createElement('button');
    b.type = 'button';
    b.ariaLabel = 'Close Editlet';
    b.dataset.editletClose = '';
    b.textContent = '×';
    b.addEventListener('click', close);
    d.append(f, b);
    s.dialog = d;
    s.iframe = f;
    document.body.append(d);
    d.show();
    inject(WINDOW_SCRIPT);
  };

  const inject = (file: string) => {
    const attr = `data-${EDITLET_SOURCE}-${file.split('.')[0]}`;
    if (document.querySelector(`script[${attr}]`)) return;
    const el = document.createElement('script');
    el.type = 'module';
    el.setAttribute(attr, '');
    el.src = new URL(file, adminUrl).href;
    document.head.append(el);
  };

  const sync = () => {
    if (!document.body) return;
    const route = readEditletRoute(location.href, param);
    let flag: string | null = null;
    try {
      flag = localStorage.getItem(PREVIEW_FLAG_KEY);
    } catch {
      /* storage blocked */
    }
    if (flag !== null || route !== null) inject(PREVIEW_SCRIPT);
    if (route === null) return teardown();
    if (s.dialog && !s.dialog.isConnected) teardown();
    if (s.dialog && route !== s.route && s.ready) post({ type: 'navigate', route });
    s.route = route;
    if (!s.dialog) open();
    if (s.ready && pageHref() !== href) post({ type: 'page', href: (href = pageHref()) });
    if (lit !== null && location.pathname !== litPath) highlight(lit);
  };

  const highlight = (entry: string | null) => {
    clearHighlights();
    lit = entry;
    litPath = location.pathname;
    if (entry === null) return;
    let first: Element | undefined;
    document.querySelectorAll(`[${ENTRY_ATTR}]`).forEach((el) => {
      if (el.getAttribute(ENTRY_ATTR) !== entry) return;
      el.setAttribute(HIGHLIGHT_ATTR, '');
      first ??= el;
    });
    first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const close = () => {
    setUrl(null);
    teardown();
  };

  const onMessage = (e: MessageEvent) => {
    if (e.source !== s.iframe?.contentWindow || e.origin !== adminUrl.origin || !isAdminToSiteMessage(e.data)) return;
    const m: AdminToSiteMessage = e.data;
    switch (m.type) {
      case 'ready':
        s.ready = true;
        s.dialog!.querySelector('button')?.remove();
        post({ type: 'init', route: s.route, site: { origin: location.origin, href: (href = pageHref()) } });
        break;
      case 'navigate':
        s.route = m.route;
        setUrl(m.route);
        break;
      case 'close':
        close();
        break;
      case 'refresh':
        (options.onRefresh ?? (() => location.reload()))();
        break;
      case 'highlight':
        highlight(m.entry);
        break;
      case 'open': {
        // Exactly one leading `/` and no tab or line break (the URL parser drops those, so `/\t/x` would be `//x`):
        // a path on this origin, never another site or a `javascript:` URL.
        if (!/^\/(?![/\\])[^\t\n\r]*$/.test(m.path)) break;
        (options.onOpen ?? ((u: string) => location.assign(u)))(
          withEditletRoute(new URL(m.path, location.origin), s.route, param),
        );
        break;
      }
    }
  };

  window.addEventListener('popstate', sync);
  window.addEventListener('message', onMessage);
  if (document.body) sync();
  else document.addEventListener('DOMContentLoaded', sync, { once: true });

  const handle: EditletLoader = {
    sync,
    close,
    destroy() {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('message', onMessage);
      document.removeEventListener('DOMContentLoaded', sync);
      teardown();
      document.querySelector('style[data-editlet]')?.remove();
      delete g[KEY];
    },
  };
  g[KEY] = handle;
  return handle;
}
