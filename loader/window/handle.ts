// The bottom sheet's grab handle, and the page-side style window.js needs. window.js draws the handle in the site page,
// not in the admin's iframe, so it can sit on the sheet's top edge, half outside it: the admin's header keeps its own
// padding. Shown only on a narrow page (SHEET_MEDIA) and while the window is not collapsed into the pill.
import { SHEET_MEDIA } from './geometry';

export const HANDLE_ATTR = 'data-editlet-handle';
/** On the dialog while one of the admin's resize edges is hovered or pulled (not while the window moves). */
export const EDGE_ATTR = 'data-editlet-edge';

/** How far the pointer has moved down since it went down on the handle (px), and the gesture's phase. */
export type Pull = (dy: number, phase: 'start' | 'move' | 'end') => void;

/**
 * A 64×24 hit area centred on the sheet's top edge (half of it outside, for the finger), and in it a 40×4 white tab
 * hanging from the edge, inside the window (rounded only at the bottom, a soft shadow below). Hovered or pulled, the tab
 * takes the admin's accent (violet-500, `--editlet-ring`). On the sheet the dialog stops clipping (the iframe rounds its
 * own corners) so the hit area can stick out.
 * While a resize edge (or the sheet's handle) is hovered or pulled, the window's outline (the loader's 2px ring, grey at
 * alpha 0x31) takes the accent at the same alpha.
 */
const CSS =
  'dialog[data-editlet]{transition:box-shadow .15s}' +
  `dialog[data-editlet]:is([${EDGE_ATTR}],:has(>[${HANDLE_ATTR}]:is(:hover,[data-active]))){box-shadow:0 0 0 2px #8b5cf631}` +
  `[${HANDLE_ATTR}]{display:none}` +
  `@media ${SHEET_MEDIA}{` +
  'dialog[data-editlet]{overflow:visible}' +
  'dialog[data-editlet]>iframe{border-radius:inherit}' +
  `[${HANDLE_ATTR}]:not([hidden]){display:block;position:absolute;top:-12px;left:50%;z-index:1;width:64px;height:24px;translate:-50% 0;cursor:ns-resize;touch-action:none}` +
  `[${HANDLE_ATTR}]::before{content:'';position:absolute;inset:12px 12px 8px;border-radius:0 0 4px 4px;background:#fff;box-shadow:0 1px 2px #0003;transition:background-color .15s}` +
  `[${HANDLE_ATTR}]:is(:hover,[data-active])::before{background:#8b5cf6}` +
  '}';

/** The dialog's handle: added (with the page's style for it) on the first call, then returned as is. */
export function sheetHandle(d: HTMLElement, pull: Pull): HTMLElement {
  const found = d.querySelector<HTMLElement>(`[${HANDLE_ATTR}]`);
  if (found) return found;
  if (!document.querySelector(`style[${HANDLE_ATTR}]`)) {
    const style = document.createElement('style');
    style.setAttribute(HANDLE_ATTR, '');
    style.textContent = CSS;
    document.head.append(style);
  }
  const el = document.createElement('div');
  el.setAttribute(HANDLE_ATTR, '');
  el.ariaHidden = 'true';
  let y0: number | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    y0 = e.clientY;
    el.dataset.active = '';
    pull(0, 'start');
  });
  el.addEventListener('pointermove', (e) => {
    if (y0 !== null) pull(e.clientY - y0, 'move');
  });
  const end = (e: PointerEvent) => {
    if (y0 === null) return;
    pull(e.clientY - y0, 'end');
    y0 = null;
    delete el.dataset.active;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  d.append(el);
  return el;
}
