import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { createBridge, type Bridge } from './bridge';
import { formatRoute, parseRoute, type Route } from './route';

import { readEditletRoute, withEditletRoute, type AdminToSiteMessage, type MessageBody } from '../../loader/protocol';

/** `pending` until the site's `init`; `disconnected` when none arrived within `INIT_TIMEOUT_MS`. */
export type BridgeStatus = 'connected' | 'pending' | 'disconnected' | 'standalone';

/** Returns true to allow leaving (site `navigate` or repeated `init`, `close-request`, `close()`, Back/Forward). */
export type NavigationGuard = () => boolean;

export const INIT_TIMEOUT_MS = 3000;

/** The longest `close` waits for the `beforeClose` hook (and the exit animation): the dialog never stays open on a
 * stuck write. */
export const BEFORE_CLOSE_TIMEOUT_MS = 1000;

/**
 * Runs right before the admin sends `close` (the loader removes the iframe at once, without React cleanup). Return a
 * promise to delay `close` until it settles (at most `BEFORE_CLOSE_TIMEOUT_MS`), or `null` to close at once.
 */
export type BeforeClose = () => Promise<void> | null;

/**
 * `exit`: runs once the guard allowed the close (an exit animation) and is awaited like `beforeClose`. An object, so
 * `onClick={close}` passes nothing by accident.
 */
export type CloseOptions = { exit?: BeforeClose };

type BridgeContextValue = {
  status: BridgeStatus;
  raw: string;
  /** The host page's href without the editor parameter (`init.site.href`, then `page`); `null` before `init`. */
  pageHref: string | null;
  navigate(r: Route | string): void;
  send(body: MessageBody<AdminToSiteMessage>): void;
  close(options?: CloseOptions): void;
  setGuard(fn: NavigationGuard | null): void;
  canLeave(): boolean;
  addBeforeClose(fn: BeforeClose): () => void;
};

/** Asks the current guard; no guard means allowed. */
function allows(guardRef: { current: NavigationGuard | null }): boolean {
  return guardRef.current?.() ?? true;
}

const BridgeContext = createContext<BridgeContextValue | null>(null);

function useBridgeContext(): BridgeContextValue {
  const ctx = useContext(BridgeContext);
  if (!ctx) throw new Error('useRoute/useBridge must be used inside <BridgeProvider>');
  return ctx;
}

/**
 * Owns the `?editlet` route and the loader-protocol bridge: `replaceState` + `navigate` to the site; `init.route` wins over
 * the start route. Without a parent page (`admin:dev`, tests) the route still changes, nothing is sent.
 */
export function BridgeProvider({ children, win = window }: { children?: ReactNode; win?: Window }) {
  const embedded = win.parent !== win;
  const [raw, setRaw] = useState(() => readEditletRoute(win.location.href) ?? '');
  const [status, setStatus] = useState<BridgeStatus>(embedded ? 'pending' : 'standalone');
  const [pageHref, setPageHref] = useState<string | null>(null);
  const rawRef = useRef(raw);
  const guardRef = useRef<NavigationGuard | null>(null);
  const bridgeRef = useRef<Bridge | null>(null);
  const beforeCloseRef = useRef<Set<BeforeClose>>(new Set());

  /**
   * `close`, after the `beforeClose` hooks and the caller's `exit` (an animation), which run side by side
   * (synchronously when neither has anything to wait for).
   */
  const sendClose = useCallback((exit?: BeforeClose) => {
    const pending = [...[...beforeCloseRef.current].map((fn) => fn()), exit?.() ?? null].filter((p) => p !== null);
    if (pending.length === 0) return bridgeRef.current?.send({ type: 'close' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => (timer = setTimeout(resolve, BEFORE_CLOSE_TIMEOUT_MS)));
    const settled = Promise.all(pending.map((p) => p.catch(() => {})));
    void Promise.race([settled, timeout]).then(() => {
      clearTimeout(timer);
      bridgeRef.current?.send({ type: 'close' });
    });
  }, []);

  const replace = useCallback(
    (route: string) => {
      rawRef.current = route;
      setRaw(route);
      win.history.replaceState(win.history.state, '', withEditletRoute(win.location.href, route));
    },
    [win],
  );

  useEffect(() => {
    let initialized = false;
    // A site route change: guarded; when refused, tell the site to go back to our route.
    const siteNavigate = (route: string) => {
      if (!allows(guardRef)) {
        bridge.send({ type: 'navigate', route: rawRef.current });
        return;
      }
      replace(route);
    };
    const bridge = createBridge(win, {
      onInit(route, href) {
        setPageHref(href);
        // A repeated `init` (the site answered a later `ready`) is a site navigate.
        if (initialized) return siteNavigate(route);
        initialized = true;
        replace(route);
        setStatus('connected');
      },
      onNavigate: siteNavigate,
      onPage: setPageHref,
      onCloseRequest() {
        if (allows(guardRef)) sendClose();
      },
    });
    bridgeRef.current = bridge;

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (bridge.embedded) {
      timer = setTimeout(() => {
        if (!bridge.connected()) setStatus('disconnected');
      }, INIT_TIMEOUT_MS);
    }

    return () => {
      bridge.destroy();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
      clearTimeout(timer);
    };
  }, [win, replace, sendClose]);

  const navigate = useCallback(
    (r: Route | string) => {
      const next = typeof r === 'string' ? r : formatRoute(r);
      if (next === rawRef.current) return;
      if (!allows(guardRef)) return;
      replace(next);
      bridgeRef.current?.send({ type: 'navigate', route: next });
    },
    [replace],
  );

  const send = useCallback((body: MessageBody<AdminToSiteMessage>) => bridgeRef.current?.send(body), []);

  const close = useCallback(
    (options?: CloseOptions) => {
      // Nothing to close before `init` (or without a parent page), so do not ask the guard.
      if (!bridgeRef.current?.connected()) return;
      if (allows(guardRef)) sendClose(options?.exit);
    },
    [sendClose],
  );

  const setGuard = useCallback((fn: NavigationGuard | null) => {
    guardRef.current = fn;
  }, []);

  const canLeave = useCallback(() => allows(guardRef), []);

  const addBeforeClose = useCallback((fn: BeforeClose) => {
    // A fresh wrapper per call: the same function added twice is two hooks, each removed by its own cleanup.
    const hook: BeforeClose = () => fn();
    beforeCloseRef.current.add(hook);
    return () => {
      beforeCloseRef.current.delete(hook);
    };
  }, []);

  const value = useMemo<BridgeContextValue>(
    () => ({ status, raw, pageHref, navigate, send, close, setGuard, canLeave, addBeforeClose }),
    [status, raw, pageHref, navigate, send, close, setGuard, canLeave, addBeforeClose],
  );
  return createElement(BridgeContext.Provider, { value }, children);
}

/** The current admin route. `navigate` accepts a `Route` or a raw `?editlet` value and asks the guard first. */
export function useRoute(): { route: Route; raw: string; navigate(r: Route | string): void } {
  const { raw, navigate } = useBridgeContext();
  const route = useMemo(() => parseRoute(raw), [raw]);
  return { route, raw, navigate };
}

/**
 * The protocol bridge. `send` is a no-op without a parent page or before `init`. `close({ exit })` asks the guard first (and
 * is a no-op, without asking, before `init`); once allowed it runs `exit` (an animation) and waits for it like
 * `beforeClose`. `setGuard` installs the guard consulted for site `navigate`, a
 * repeated `init`, `close-request`, `close()` and in-app `navigate`. `canLeave()` asks it for
 * any other way of leaving the screen (e.g. a branch switch); `true` when there is no guard. `addBeforeClose` adds a
 * hook that runs before every `close` the admin sends (see `BeforeClose`; every hook is awaited) and returns its removal.
 */
export function useBridge(): {
  status: BridgeStatus;
  send(body: MessageBody<AdminToSiteMessage>): void;
  close(options?: CloseOptions): void;
  setGuard(fn: NavigationGuard | null): void;
  canLeave(): boolean;
  addBeforeClose(fn: BeforeClose): () => void;
} {
  const { status, send, close, setGuard, canLeave, addBeforeClose } = useBridgeContext();
  return { status, send, close, setGuard, canLeave, addBeforeClose };
}

/**
 * The host page's pathname (`/posts/tires`), from `init.site.href` and the site's `page` messages; `null` before
 * `init` or without a parent page.
 */
export function usePagePath(): string | null {
  const { pageHref } = useBridgeContext();
  return useMemo(() => (pageHref && URL.canParse(pageHref) ? new URL(pageHref).pathname : null), [pageHref]);
}
