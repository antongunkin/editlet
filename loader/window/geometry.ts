// Pure geometry of the floating window (px). window.js applies the result to the dialog.

export const MARGIN = 20;
export const DEFAULT_SIZE = { w: 600, h: 800 } as const;
export const MIN_SIZE = { w: 320, h: 320 } as const;
/** The top bar (drag handle, buttons): the part that stays on screen when the window is pushed down. */
export const BAR_HEIGHT = 48;
/**
 * Below this page width the window is a bottom sheet: full width, 70% of the screen high, fixed to the bottom. It does
 * not move; only window.js's grab handle on its top edge resizes it (`sheetHeight`). 640 px is the default width (600)
 * plus both margins, so the floating window never fits there anyway. The loader's CSS draws the sheet; window.js sets
 * only a pulled height; the admin hides the move button and the resize edges.
 */
export const SHEET_MEDIA = '(width < 640px)';

export type Rect = { x: number; y: number; w: number; h: number };
export type Viewport = { w: number; h: number };

const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), Math.max(min, max));

/**
 * Size within [MIN_SIZE, viewport − margins]. A window may hang off the left or right edge by up to half of its own
 * width, and be pushed down until only its top bar is left on screen. It never goes above the top edge, so the bar
 * (the drag handle) always stays reachable. A missing `x`/`y` means top right with the margin.
 */
export function fitRect(r: Partial<Rect>, v: Viewport): Rect {
  const w = clamp(r.w ?? DEFAULT_SIZE.w, MIN_SIZE.w, v.w - MARGIN * 2);
  const h = clamp(r.h ?? DEFAULT_SIZE.h, MIN_SIZE.h, v.h - MARGIN * 2);
  const hiddenX = Math.floor(w / 2);
  return {
    w,
    h,
    x: clamp(r.x ?? v.w - MARGIN - w, -hiddenX, v.w - w + hiddenX),
    y: clamp(r.y ?? MARGIN, 0, v.h - BAR_HEIGHT),
  };
}

/** An edge or corner of the window, as compass points: the part a resize gesture pulls. */
export type Edge = 'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const EDGES: readonly Edge[] = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];

/** What a drag does: move the window, or resize it by one edge or corner. */
export type Gesture = 'move' | Edge;

/**
 * A moved or resized copy of `start`, fitted by `fitRect`. A resize moves only the pulled edges: pulling the left or
 * top edge keeps the right or bottom edge in place, also when the size hits a limit (the top edge stops at the screen's).
 */
export function drag(start: Rect, kind: Gesture, dx: number, dy: number, v: Viewport): Rect {
  if (kind === 'move') return fitRect({ ...start, x: start.x + dx, y: start.y + dy }, v);
  let { x, y, w, h } = start;
  const maxW = v.w - MARGIN * 2;
  const maxH = v.h - MARGIN * 2;
  if (kind.includes('e')) w = clamp(start.w + dx, MIN_SIZE.w, maxW);
  if (kind.includes('w')) {
    w = clamp(start.w - dx, MIN_SIZE.w, maxW);
    x = start.x + start.w - w;
  }
  if (kind.includes('s')) h = clamp(start.h + dy, MIN_SIZE.h, maxH);
  if (kind.includes('n')) {
    h = clamp(start.h - dy, MIN_SIZE.h, Math.min(maxH, start.y + start.h));
    y = start.y + start.h - h;
  }
  return fitRect({ x, y, w, h }, v);
}

/**
 * The bottom sheet's height after its top edge was pulled down by `dy` from `start`: at least `MIN_SIZE.h` (or the
 * screen, if smaller), at most the screen less `MARGIN` at the top, so the page stays visible above it.
 */
export function sheetHeight(start: number, dy: number, v: Viewport): number {
  return clamp(Math.round(start - dy), Math.min(MIN_SIZE.h, v.h - MARGIN), v.h - MARGIN);
}

/** The collapsed window (a pill): centred, this far above the bottom edge. */
export const PILL_BOTTOM = 20;

/** The dialog's inline styles. An empty value removes the property, so the loader's CSS applies again. */
export type DialogStyle = Record<'left' | 'top' | 'right' | 'bottom' | 'width' | 'height' | 'border-radius', string>;

/** No inline geometry: the loader's CSS places the dialog (the bottom sheet on a narrow page). */
export const LOADER_STYLE: DialogStyle = {
  left: '',
  top: '',
  right: '',
  bottom: '',
  width: '',
  height: '',
  'border-radius': '',
};

/** The bottom sheet: the loader's CSS, with only the height set once the top edge was pulled (`null`: not yet). */
export function sheetStyle(h: number | null): DialogStyle {
  return h === null ? LOADER_STYLE : { ...LOADER_STYLE, height: `${h}px` };
}

/** Inline styles that place the dialog at `r`. */
export function dialogStyle(r: Rect): DialogStyle {
  return {
    ...LOADER_STYLE,
    left: `${r.x}px`,
    top: `${r.y}px`,
    right: 'auto',
    bottom: 'auto',
    width: `${r.w}px`,
    height: `${r.h}px`,
  };
}

/**
 * Inline styles of the pill: `size` (the admin measures it), centred, `PILL_BOTTOM` above the bottom edge. The radius is
 * half the height (not 9999px), so the corner animates smoothly from the window's 20px.
 */
export function pillStyle(size: { w: number; h: number }, v: Viewport): DialogStyle {
  const w = Math.min(size.w, v.w);
  return {
    left: `${Math.round((v.w - w) / 2)}px`,
    top: 'auto',
    right: 'auto',
    bottom: `${PILL_BOTTOM}px`,
    width: `${w}px`,
    height: `${size.h}px`,
    'border-radius': `${size.h / 2}px`,
  };
}
