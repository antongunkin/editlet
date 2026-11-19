// The bottom sheet's grab handle, and the page-side style window.js needs. window.js draws the handle in the site page,
// not in the admin's iframe, so it can sit on the sheet's top edge, half outside it: the admin's header keeps its own
// padding. Shown only on a narrow page (SHEET_MEDIA) and while the window is not collapsed into the pill.
import { SHEET_MEDIA, type Edge } from './geometry';

export const HANDLE_ATTR = 'data-editlet-handle';
/**
 * On the dialog while one of the admin's resize edges is hovered or pulled (not while the window moves): the name of the
 * sides that move (`top`, `right`, `bottom-left`…), or `all` when the admin did not say which edge.
 */
export const EDGE_ATTR = 'data-editlet-edge';
/** On the dialog: the admin's theme (`light` or `dark`), sent over the channel; the handle's Dark colour reads it. */
export const THEME_ATTR = 'data-editlet-theme';
const SIDES = { n: 'top', e: 'right', s: 'bottom', w: 'left' };
/** `ne` → `top-right`: the compass name spelled out, the vertical side first. */
export const edgeName = (e: Edge | 'all') =>
  e === 'all' ? e : [...e].map((c) => SIDES[c as keyof typeof SIDES]).join('-');

/** How far the pointer has moved down since it went down on the handle (px), and the gesture's phase. */
export type Pull = (dy: number, phase: 'start' | 'move' | 'end') => void;

/**
 * A 64×24 hit area centred on the sheet's top edge (half of it outside, for the finger), and in it a 40×4 white tab
 * hanging from the edge, inside the window (rounded only at the bottom, a soft shadow below). Hovered or pulled, the tab
 * takes the admin's accent (violet-500, `--editlet-ring`). In Dark (`data-editlet-theme=dark` on the dialog) the tab is the
 * design's grabber grey, not white. On the sheet the dialog stops clipping (the iframe rounds its
 * own corners) so the hit area can stick out.
 * On the sheet, a 60px gradient (the design's `Gradient/sheet edge`) runs from 30px above the sheet's top edge to 30px
 * inside it, so the page darkens softly towards the sheet. It hides with the handle, while the window is the pill.
 * On the floating window, while an edge or corner is hovered or pulled, a violet shadow (`0 4px 4px` towards the side)
 * lights each side it moves, next to the window's own ring. Each side has a variable, so the shadow list keeps its
 * length and eases in (not under `prefers-reduced-motion`). The variables carry the `editlet-` prefix: custom
 * properties inherit, so a site's own `--s` on `:root` would otherwise leak into the dialog's `box-shadow`.
 */
const V = '#8b5cf6';
const E = `[${EDGE_ATTR}`;
const CSS =
  'dialog[data-editlet]{transition:box-shadow .15s;' +
  'box-shadow:0 0 0 2px #80808031,0 -4px 4px var(--editlet-n,#0000),4px 0 4px var(--editlet-e,#0000),0 4px 4px var(--editlet-s,#0000),-4px 0 4px var(--editlet-w,#0000)}' +
  `${E}^=top],${E}=all]{--editlet-n:${V}}${E}^=bottom],${E}=all]{--editlet-s:${V}}` +
  `${E}$=right],${E}=all]{--editlet-e:${V}}${E}$=left],${E}=all]{--editlet-w:${V}}` +
  `@media (prefers-reduced-motion:reduce){dialog[data-editlet],[${HANDLE_ATTR}]::before{transition:none}}` +
  `[${HANDLE_ATTR}]{display:none}` +
  `@media ${SHEET_MEDIA}{` +
  'dialog[data-editlet]{overflow:visible}' +
  'dialog[data-editlet]>iframe{border-radius:inherit}' +
  `dialog[data-editlet]:not(:has(>[${HANDLE_ATTR}][hidden]))::before{content:'';position:absolute;z-index:-1;inset:-30px 0 auto;height:60px;pointer-events:none;background:linear-gradient(#1c191700,#1c19173d)}` +
  `[${HANDLE_ATTR}]:not([hidden]){display:block;position:absolute;top:-12px;left:50%;z-index:1;width:64px;height:24px;translate:-50% 0;cursor:ns-resize;touch-action:none}` +
  `[${HANDLE_ATTR}]::before{content:'';position:absolute;inset:12px 12px 8px;border-radius:0 0 4px 4px;background:#fff;box-shadow:0 1px 2px #0003;transition:background-color .15s}` +
  // Dark: the design's grabber on the black sheet instead of white; hovered or pulled it stays the accent.
  `dialog[${THEME_ATTR}=dark] [${HANDLE_ATTR}]:not(:hover,[data-active])::before{background:#a3a3a3}` +
  `[${HANDLE_ATTR}]:is(:hover,[data-active])::before{background:${V}}` +
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
