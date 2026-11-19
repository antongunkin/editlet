import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from 'react';

import {
  isPreviewToAdminMessage,
  isViewportMessage,
  WINDOW_SOURCE,
  type AdminToPreviewMessage,
  type AdminToWindowMessage,
  type PreviewState,
  type WindowBody,
} from '../../../loader/window/channel';
import { SHEET_MEDIA, type Edge, type Gesture } from '../../../loader/window/geometry';

/** Posts to the site page (window.js, the preview overlay). Only the embedded chrome calls it; the parent is always
 * at the admin's own origin (the bridge enforces it). */
function post(body: WindowBody<AdminToWindowMessage | AdminToPreviewMessage>): void {
  window.parent.postMessage({ source: WINDOW_SOURCE, ...body }, window.location.origin);
}

/** Tells window.js the theme the admin is drawn in, so the sheet's grab handle (on the page) follows it. Embedded only. */
export function postTheme(theme: 'light' | 'dark'): void {
  if (window.parent !== window) post({ type: 'theme', theme });
}

/** The live-preview state the site page reports (null: no preview). The overlay answers `hello` with the state. */
export function usePagePreview(embedded: boolean): PreviewState | null {
  const [state, setState] = useState<PreviewState | null>(null);
  useEffect(() => {
    if (!embedded) return;
    const onMessage = (e: MessageEvent) => {
      if (e.source === window.parent && e.origin === window.location.origin && isPreviewToAdminMessage(e.data))
        setState(e.data.state);
    };
    window.addEventListener('message', onMessage);
    post({ type: 'hello' });
    // window.js may not have been listening when the theme was first applied: say it again after `hello`.
    const theme = document.documentElement.dataset.editletTheme;
    if (theme === 'light' || theme === 'dark') post({ type: 'theme', theme });
    return () => window.removeEventListener('message', onMessage);
  }, [embedded]);
  return state;
}

/**
 * What covers the bottom of the window on the site page (the home indicator, the on-screen keyboard), which only the
 * page can measure: window.js answers `hello` and reports every change (`ViewportMessage`). The admin sets them as
 * `--safe-bottom` and `--keyboard` on its root, for the bottom bar (`ui/parts/bottom-bar.tsx`). Standalone (no page
 * around it), app.css's defaults apply: the admin's own safe area and no keyboard.
 */
export function usePageViewport(embedded: boolean): void {
  useEffect(() => {
    if (!embedded) return;
    const root = document.documentElement.style;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== window.location.origin || !isViewportMessage(e.data)) return;
      root.setProperty('--safe-bottom', `${e.data.safeBottom}px`);
      root.setProperty('--keyboard', `${e.data.keyboard}px`);
      // The on-screen keyboard is up (app.css: on iOS the bottom bar then hides under Safari's form accessory).
      document.documentElement.toggleAttribute('data-keyboard', e.data.keyboard > 0);
    };
    // Safari on iOS and iPadOS floats its form accessory over the page above the keyboard (an iPad reports a Mac).
    document.documentElement.toggleAttribute(
      'data-ios',
      /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    window.addEventListener('message', onMessage);
    post({ type: 'hello' });
    return () => {
      window.removeEventListener('message', onMessage);
      root.removeProperty('--safe-bottom');
      root.removeProperty('--keyboard');
      document.documentElement.removeAttribute('data-keyboard');
      document.documentElement.removeAttribute('data-ios');
    };
  }, [embedded]);
}

/**
 * Whether the site page shows the window as a bottom sheet (`SHEET_MEDIA` on the page's viewport, not this iframe's):
 * then it cannot be moved, and only window.js's handle (outside this iframe) resizes it. The page is at the admin's own origin; false when it cannot be read.
 */
export function usePageSheet(): boolean {
  const [query] = useState(() => {
    try {
      return window.parent.matchMedia(SHEET_MEDIA);
    } catch {
      return null;
    }
  });
  const subscribe = useCallback(
    (onChange: () => void) => {
      query?.addEventListener('change', onChange);
      return () => query?.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => query?.matches ?? false);
}

/**
 * While `collapsed`, window.js shrinks the dialog (this iframe) to the element's size: the pill at the bottom centre.
 * Measured from the layout size (the computed width and height), not the box, which the pill's scale-in transform
 * shrinks. The pill's shadow goes along: the iframe would clip it, so the dialog draws it. A theme change while
 * collapsed (`data-editlet-theme` on the root) sends the new shadow. Expanding (or unmounting) posts `expand`.
 */
export function useWindowPill(ref: RefObject<HTMLElement | null>, collapsed: boolean): void {
  useLayoutEffect(() => {
    if (!collapsed) return;
    let sent: string | undefined;
    const measure = (force: boolean) => {
      const style = getComputedStyle(ref.current!);
      const shadow = style.boxShadow && !style.boxShadow.endsWith('none') ? style.boxShadow : undefined; // jsdom: `currentcolor none`
      if (!force && shadow === sent) return;
      sent = shadow;
      post({
        type: 'collapse',
        w: Math.ceil(parseFloat(style.width)),
        h: Math.ceil(parseFloat(style.height)),
        ...(shadow ? { shadow } : {}),
      });
    };
    measure(true);
    const theme = new MutationObserver(() => measure(false));
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-editlet-theme'] });
    return () => {
      theme.disconnect();
      post({ type: 'expand' });
    };
  }, [ref, collapsed]);
}

const STEP = 20;
const BIG_STEP = 100;
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Pointer handlers for a resize edge: entering (with the zone's name) or leaving it tells window.js, which lights the
 * sides that zone moves (in the site page, outside this iframe) while it is hovered. An edge that goes away while hovered (a dialog closing)
 * says it was left.
 */
export function useEdgeHover(edge?: Edge) {
  const hovered = useRef(false);
  const set = (hover: boolean) => {
    hovered.current = hover;
    // Entering names the zone, so window.js lights only the sides it moves (docs/loader/window.md).
    post(hover && edge ? { type: 'edge', hover, edge } : { type: 'edge', hover });
  };
  useEffect(
    () => () => {
      if (hovered.current) post({ type: 'edge', hover: false });
    },
    [],
  );
  return { onPointerEnter: () => set(true), onPointerLeave: () => set(false) };
}

/** What had the focus when a gesture began: an element and, for a text control, its selection. */
type FocusSnapshot = {
  el: HTMLElement;
  selection?: { start: number; end: number; direction: 'forward' | 'backward' | 'none' };
};

function snapshotFocus(): FocusSnapshot | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el === document.body) return null;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      const { selectionStart: start, selectionEnd: end, selectionDirection: direction } = el;
      if (start !== null && end !== null) return { el, selection: { start, end, direction: direction ?? 'none' } };
    } catch {
      // An input type without a selection (number, date): the focus alone.
    }
  }
  return { el };
}

/**
 * An edge is not focusable, so pressing one can move the focus to `<body>`, out of an open modal (Base UI's focus
 * guards catch Tab, not a click), and engines differ on whether cancelling `pointerdown` prevents it. Only when the focus
 * fell to `<body>` does it go back to the element that had it, with its selection.
 */
function restoreFocus(snapshot: FocusSnapshot | null): void {
  if (!snapshot || !snapshot.el.isConnected) return;
  const now = document.activeElement;
  if (now && now !== document.body) return;
  snapshot.el.focus({ preventScroll: true });
  const { el, selection } = snapshot;
  if (selection && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    try {
      el.setSelectionRange(selection.start, selection.end, selection.direction);
    } catch {
      // See snapshotFocus.
    }
  }
}

/**
 * Pointer and keyboard handlers that move the window or resize it by one edge or corner. Deltas are screen pixels since
 * the gesture began, so they stay right while the window (and this iframe) moves under the pointer. Arrow keys repeat
 * the gesture by a step; with Alt they resize from the bottom-right corner instead (the only keyboard resize). The
 * focus survives a pointer press (`restoreFocus`): `pointerdown` is cancelled, so no `mousedown` handler would run.
 */
export function useWindowGesture(kind: Gesture) {
  const from = useRef<{ x: number; y: number } | null>(null);
  const focus = useRef<FocusSnapshot | null>(null);
  const settle = () => {
    const snapshot = focus.current;
    focus.current = null;
    restoreFocus(snapshot);
  };
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
      focus.current = snapshotFocus();
      e.currentTarget.setPointerCapture(e.pointerId);
      from.current = { x: e.screenX, y: e.screenY };
      post({ type: 'drag', kind, phase: 'start', dx: 0, dy: 0 });
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      if (from.current)
        post({ type: 'drag', kind, phase: 'move', dx: e.screenX - from.current.x, dy: e.screenY - from.current.y });
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      if (!from.current) return;
      post({ type: 'drag', kind, phase: 'end', dx: e.screenX - from.current.x, dy: e.screenY - from.current.y });
      from.current = null;
      settle();
    },
    onLostPointerCapture: settle,
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      const dir = ARROWS[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = e.shiftKey ? BIG_STEP : STEP;
      const gesture = e.altKey ? 'se' : kind;
      post({ type: 'drag', kind: gesture, phase: 'start', dx: 0, dy: 0 });
      post({ type: 'drag', kind: gesture, phase: 'move', dx: dir[0] * step, dy: dir[1] * step });
      post({ type: 'drag', kind: gesture, phase: 'end', dx: dir[0] * step, dy: dir[1] * step });
    },
  };
}
