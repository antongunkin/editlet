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
  WINDOW_SOURCE,
  type AdminToPreviewMessage,
  type AdminToWindowMessage,
  type PreviewState,
  type WindowBody,
} from '../../../loader/window/channel';
import { SHEET_MEDIA, type Gesture } from '../../../loader/window/geometry';

/** Posts to the site page (window.js, the preview overlay). Only the embedded chrome calls it; the parent is always
 * at the admin's own origin (the bridge enforces it). */
function post(body: WindowBody<AdminToWindowMessage | AdminToPreviewMessage>): void {
  window.parent.postMessage({ source: WINDOW_SOURCE, ...body }, window.location.origin);
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
    return () => window.removeEventListener('message', onMessage);
  }, [embedded]);
  return state;
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
 * shrinks. Expanding (or unmounting) posts `expand`.
 */
export function useWindowPill(ref: RefObject<HTMLElement | null>, collapsed: boolean): void {
  useLayoutEffect(() => {
    if (!collapsed) return;
    const style = getComputedStyle(ref.current!);
    post({ type: 'collapse', w: Math.ceil(parseFloat(style.width)), h: Math.ceil(parseFloat(style.height)) });
    return () => post({ type: 'expand' });
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
 * Pointer handlers for a resize edge: entering or leaving it tells window.js, which lights the window's outline (in the
 * site page, outside this iframe) while any edge is hovered. An edge that goes away while hovered (a dialog closing)
 * says it was left.
 */
export function useEdgeHover() {
  const hovered = useRef(false);
  const set = (hover: boolean) => {
    hovered.current = hover;
    post({ type: 'edge', hover });
  };
  useEffect(
    () => () => {
      if (hovered.current) post({ type: 'edge', hover: false });
    },
    [],
  );
  return { onPointerEnter: () => set(true), onPointerLeave: () => set(false) };
}

/**
 * Pointer and keyboard handlers that move the window or resize it by one edge or corner. Deltas are screen pixels since
 * the gesture began, so they stay right while the window (and this iframe) moves under the pointer. Arrow keys repeat
 * the gesture by a step; with Alt they resize from the bottom-right corner instead (the only keyboard resize).
 */
export function useWindowGesture(kind: Gesture) {
  const from = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0) return;
      e.preventDefault();
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
    },
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
