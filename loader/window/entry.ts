// Bundle entry for window.js (built into the admin dist, injected by the loader when it opens the editor). Turns the
// loader's dialog into a floating window: it keeps the geometry (drag, resize), persists it, and takes its orders
// from the admin over the private channel in ./channel.ts. The loader's own CSS only gives the
// dialog a default size and place, so the editor is usable before this script arrives. On a narrow page (SHEET_MEDIA)
// the loader's CSS draws a bottom sheet: this script then drops its inline geometry and ignores the admin's gestures;
// its own grab handle on the sheet's top edge (./handle.ts) sets (and saves) the sheet's height. Collapsed
// (the admin's close button), the dialog is a pill at the bottom centre, sized by the admin, on any page width. The
// switch between window and pill is animated (`morph`); the admin fades its content and the pill in step. It also tells
// the admin what covers the dialog's bottom (the safe area, the keyboard: ./viewport.ts), which the iframe cannot see.
import { isAdminToWindowMessage } from './channel';
import {
  dialogStyle,
  drag,
  fitRect,
  pillStyle,
  SHEET_MEDIA,
  sheetHeight,
  sheetStyle,
  type DialogStyle,
  type Edge,
  type Gesture,
  type Rect,
} from './geometry';
import { EDGE_ATTR, edgeName, sheetHandle, THEME_ATTR, type Pull } from './handle';
import { startSelect } from './select';
import { startViewport } from './viewport';

import { EDITLET_SOURCE } from '../protocol';

const STORAGE_KEY = 'editlet:window';
/** The bottom sheet's pulled height (px), apart from the window's rect: the two come back on their own page widths. */
const SHEET_KEY = 'editlet:sheet';
const KEY = Symbol.for(`${EDITLET_SOURCE}.window`);

const dialog = () => document.querySelector<HTMLDialogElement>('dialog[data-editlet]');
const frame = () => dialog()?.querySelector('iframe') ?? null;
const view = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });

/** The collapse and expand animation; the admin's CSS uses the same duration and easing for its fades. */
const MORPH = { duration: 400, easing: 'cubic-bezier(0.455, 0.03, 0.515, 0.955)' } as const;

const setStyle = (d: HTMLElement, style: DialogStyle) => {
  for (const [k, v] of Object.entries(style)) d.style.setProperty(k, v);
};

/** Where the dialog is drawn now, as keyframe values (`right`/`bottom` auto, so `left`/`top` place it). */
function box(d: HTMLElement): Keyframe {
  const r = d.getBoundingClientRect();
  return {
    left: `${r.left}px`,
    top: `${r.top}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: getComputedStyle(d).borderRadius,
  };
}

/**
 * Sets `style` and animates the dialog from where it was to where it lands (FLIP): it works between any two places,
 * the loader's bottom sheet included. No animation when the user prefers reduced motion. Returns the animation, whose
 * first frame (the old place) shows at once: what is measured after it lands waits for `finished`.
 */
function morph(d: HTMLElement, style: DialogStyle, reduce: MediaQueryList): Animation | undefined {
  if (reduce.matches || typeof d.animate !== 'function') return void setStyle(d, style);
  const from = box(d);
  setStyle(d, style);
  return d.animate([from, box(d)], MORPH);
}

function start(): void {
  let saved: Partial<Rect> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Rect>;
  } catch {
    /* storage blocked or corrupt: start from the defaults */
  }
  let rect = fitRect(saved, view());
  let sheetH: number | null = null;
  try {
    const h = Number(localStorage.getItem(SHEET_KEY));
    if (h > 0) sheetH = h;
  } catch {
    /* storage blocked: the sheet starts at the loader's height */
  }
  const sheet = matchMedia(SHEET_MEDIA);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  // The pill's size while collapsed. Every open builds a fresh dialog (and admin), which starts expanded.
  let pill: { w: number; h: number; shadow?: string } | null = null;
  let shown: HTMLDialogElement | null = null;
  let gesture: { kind: Gesture; from: Rect } | null = null;
  // The sheet's height when the handle went down (as drawn, so the loader's 70dvh before any pull).
  let sheetFrom = 0;

  const persist = () => {
    try {
      if (sheet.matches) {
        if (sheetH !== null) localStorage.setItem(SHEET_KEY, String(sheetH));
      } else localStorage.setItem(STORAGE_KEY, JSON.stringify(rect));
    } catch {
      /* storage blocked: the window forgets its place on reload */
    }
  };

  const viewport = startViewport(frame, dialog);

  const apply = (animate = false) => {
    const d = dialog();
    if (!d) return;
    if (d !== shown) {
      shown = d;
      pill = null;
    }
    sheetHandle(d, pullSheet).hidden = pill !== null;
    rect = fitRect(rect, view());
    if (sheetH !== null) sheetH = sheetHeight(sheetH, 0, view());
    const style = pill ? pillStyle(pill, view()) : sheet.matches ? sheetStyle(sheetH) : dialogStyle(rect);
    if (!animate) setStyle(d, style);
    // An animated move shows its start for a moment: measure where the dialog lands, once it has.
    else
      morph(d, style, reduce)?.finished.then(
        () => viewport(),
        () => {},
      );
    lightEdges();
    viewport();
  };

  // The sides the pulled (or hovered) edge moves take the accent: the page-side style (./handle.ts) reads the name
  // (`top`, `bottom-left`…) off the dialog. A pulled edge wins over the hovered one; no edge named lights every side.
  let hovered: Edge | 'all' | null = null;
  let pulled: Edge | null = null;
  const lightEdges = () => {
    // The pill and the sheet have no highlight, and a resize cut short by one (the page narrows, the window collapses)
    // never gets its `end`: forget both, so nothing stays lit when the window comes back.
    if (pill || sheet.matches) pulled = hovered = gesture = null;
    const edge = pulled ?? hovered;
    if (edge) dialog()?.setAttribute(EDGE_ATTR, edgeName(edge));
    else dialog()?.removeAttribute(EDGE_ATTR);
  };

  const pullSheet: Pull = (dy, phase) => {
    if (phase === 'start') {
      sheetFrom = dialog()?.getBoundingClientRect().height ?? 0;
      return;
    }
    sheetH = sheetHeight(sheetFrom, dy, view());
    apply();
    if (phase === 'end') persist();
  };

  const onMessage = (e: MessageEvent) => {
    const f = frame();
    if (!f || e.source !== f.contentWindow || e.origin !== new URL(f.src, location.href).origin) return;
    const m = e.data as unknown;
    if (!isAdminToWindowMessage(m)) return;
    if (m.type === 'hello') return viewport(true);
    if (m.type === 'theme') return dialog()?.setAttribute(THEME_ATTR, m.theme);
    if (m.type === 'collapse' || m.type === 'expand') {
      pill = m.type === 'collapse' ? { w: m.w, h: m.h, shadow: m.shadow } : null;
      apply(true);
      lightEdges();
      return;
    }
    if (m.type === 'edge') {
      hovered = m.hover ? (m.edge ?? 'all') : null;
      lightEdges();
      return;
    }
    if (m.type !== 'drag' || pill || sheet.matches) return;
    if (m.phase === 'start') {
      gesture = { kind: m.kind, from: rect };
      pulled = m.kind === 'move' ? null : m.kind;
      lightEdges();
    } else if (gesture && m.phase === 'move') {
      rect = drag(gesture.from, gesture.kind, m.dx, m.dy, view());
      apply();
    } else if (m.phase === 'end') {
      gesture = null;
      pulled = null;
      lightEdges();
      persist();
    }
  };

  // The loader builds a fresh dialog on every open: restyle each one that appears.
  new MutationObserver(() => apply()).observe(document.body, { childList: true });
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', () => apply());
  // The edges sit on the iframe's border: if their `edge { hover: false }` is lost as the pointer leaves the iframe, a
  // move on the page outside the dialog still means no edge is hovered.
  window.addEventListener('pointermove', (e) => {
    if (!hovered || dialog()?.contains(e.target as Node)) return;
    hovered = null;
    lightEdges();
  });
  apply();
  startSelect(frame, dialog);
}

const scope = globalThis as typeof globalThis & { [KEY]?: true };
if (!scope[KEY]) {
  scope[KEY] = true;
  start();
}
