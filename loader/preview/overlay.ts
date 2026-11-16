// Preview overlay (Layer A): runs on the site page for editors only. Reads the admin's snapshot, patches the page,
// keeps it patched across framework re-renders, follows snapshot changes on the channel and shows the pill.
import { announceSnapshot, clearSnapshot, readSnapshot, setPreviewFlag } from './db';
import { applySnapshot, type PatchResult } from './match';
import { renderPill, type Pill } from './pill';

import { isPreviewChannelMessage, PREVIEW_CHANNEL, PREVIEW_ROUTE, type PreviewSnapshot } from '../protocol';
import {
  isAdminToPreviewMessage,
  isAdminToWindowMessage,
  WINDOW_SOURCE,
  type PreviewState,
  type PreviewToAdminMessage,
} from '../window/channel';

export type OverlayOptions = {
  win?: Window;
  idb?: IDBFactory;
  fetch?: typeof fetch;
  configUrl?: string;
  now?: () => number;
};

export type Overlay = { stop(): void; ready: Promise<void> };

/** One object URL per Blob; `clear()` revokes them all (snapshot replaced, cleared, or overlay stopped). */
export function createUrlCache(url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>) {
  const urls = new Map<Blob, string>();
  return {
    get(blob: Blob): string {
      let u = urls.get(blob);
      if (u === undefined) urls.set(blob, (u = url.createObjectURL(blob)));
      return u;
    },
    clear(): void {
      for (const u of urls.values()) url.revokeObjectURL(u);
      urls.clear();
    },
  };
}

function safe<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

export function startOverlay(opts: OverlayOptions = {}): Overlay {
  // Window's type lacks the global constructors (URL, MutationObserver, BroadcastChannel) a real window has.
  const win = (opts.win ?? window) as Window & typeof globalThis;
  const doc = win.document;
  const idb = opts.idb ?? safe(() => win.indexedDB);
  const storage = safe(() => win.localStorage);
  const doFetch = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => win.fetch(input, init));
  const now = opts.now ?? Date.now;
  const urls = createUrlCache(win.URL);

  let stopped = false;
  let snapshot: PreviewSnapshot | null = null;
  let patch: PatchResult | null = null;
  let pill: Pill | null = null;
  let frame: number | null = null;
  let queue = Promise.resolve();

  const observer = new win.MutationObserver(() => {
    if (frame !== null || stopped) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      if (!stopped) write(() => apply());
    });
  });
  // The whole document, not <body>: client navigation may replace <body>. Image attributes too, so a re-render that
  // puts back the deployed src or alt is patched again.
  const observe = () =>
    observer.observe(doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'alt'],
    });

  // Every page write runs with the observer off; disconnect() also drops records already queued by the page, which the
  // re-apply that follows covers anyway.
  const write = (fn: () => void) => {
    observer.disconnect();
    try {
      fn();
    } finally {
      if (!stopped && snapshot) observe();
    }
  };

  // The editor window's iframe, when the editor is open: it shows the preview line in its status bar.
  const adminFrame = () => doc.querySelector<HTMLIFrameElement>('dialog[data-editlet] iframe');
  let state: PreviewState | null = null;
  const tellAdmin = () => {
    const f = adminFrame();
    const body: PreviewToAdminMessage = { source: WINDOW_SOURCE, type: 'preview', state };
    if (f) f.contentWindow?.postMessage(body, new win.URL(f.src).origin);
  };

  const apply = () => {
    patch?.restore();
    patch = null;
    state = null;
    if (snapshot) {
      patch = applySnapshot(doc, snapshot, urls.get);
      state = { branch: snapshot.branch, patched: patch.patched, pending: patch.pending };
    }
    // Editor open: the status bar shows the line. Editor closed: the floating pill is the only sign of the preview.
    if (!state || adminFrame()) {
      pill?.remove();
      pill = null;
    } else if (pill) pill.update(state);
    else pill = renderPill(doc, state, () => void exit());
    tellAdmin();
  };

  const load = async () => {
    let next = await readSnapshot(idb);
    if (next && next.expiresAt <= now()) {
      await clearSnapshot(idb);
      setPreviewFlag(null, storage);
      next = null;
    }
    if (stopped) return;
    write(() => {
      patch?.restore();
      patch = null;
      urls.clear();
      snapshot = next;
      apply();
    });
  };
  // A failed load (e.g. a patch that throws) must not stop the updates queued after it.
  const reload = () => (queue = queue.then(load).catch(() => undefined));

  const channel = safe(() => new win.BroadcastChannel(PREVIEW_CHANNEL));
  channel?.addEventListener('message', (e: MessageEvent) => {
    if (!stopped && isPreviewChannelMessage(e.data)) void reload();
  });

  // The admin asks for the state when it mounts (`hello`) and ends the preview with `preview-exit`.
  const onMessage = (e: MessageEvent) => {
    const f = adminFrame();
    if (stopped || !f || e.source !== f.contentWindow || e.origin !== new win.URL(f.src).origin) return;
    if (isAdminToPreviewMessage(e.data)) void exit();
    else if (isAdminToWindowMessage(e.data) && e.data.type === 'hello') tellAdmin();
  };
  win.addEventListener('message', onMessage);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    win.removeEventListener('message', onMessage);
    observer.disconnect();
    if (frame !== null) win.cancelAnimationFrame(frame);
    frame = null;
    channel?.close();
    patch?.restore();
    patch = null;
    pill?.remove();
    pill = null;
    urls.clear();
    snapshot = null;
    state = null;
    tellAdmin();
  };

  const exit = async () => {
    stop();
    await clearSnapshot(idb);
    setPreviewFlag(null, storage);
    announceSnapshot();
    if (opts.configUrl) {
      try {
        const config: unknown = await (await doFetch(opts.configUrl)).json();
        if ((config as { preview?: unknown } | null)?.preview === true) {
          await doFetch(PREVIEW_ROUTE, { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined);
        }
      } catch {
        // No config: nothing server-side to end.
      }
    }
    win.location.reload();
  };

  return { stop, ready: reload() };
}
