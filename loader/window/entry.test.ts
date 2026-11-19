// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WINDOW_SOURCE, type AdminToWindowMessage, type WindowBody } from './channel';

const ORIGIN = location.origin;

function openDialog(): { dialog: HTMLDialogElement; frame: HTMLIFrameElement } {
  const dialog = document.createElement('dialog');
  dialog.dataset.editlet = '';
  const frame = document.createElement('iframe');
  frame.src = `${ORIGIN}/editlet/?editlet`;
  dialog.append(frame);
  document.body.append(dialog);
  return { dialog, frame };
}

const send = (frame: HTMLIFrameElement, body: WindowBody<AdminToWindowMessage>, origin = ORIGIN) =>
  window.dispatchEvent(
    new MessageEvent('message', { data: { source: WINDOW_SOURCE, ...body }, origin, source: frame.contentWindow }),
  );

/** A page that is narrow (`sheet`) or not, as far as `SHEET_MEDIA` is concerned (jsdom has no matchMedia). */
const pageWidth = (sheet: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: sheet, media: query }) as MediaQueryList);

// window.js never tears down, so each test removes the listeners and the observers its fresh import added (an old
// instance would otherwise style the next test's dialog too, and own its handle).
const listeners: [string, EventListenerOrEventListenerObject][] = [];
const observers: MutationObserver[] = [];

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) window.removeEventListener(type, listener);
  for (const observer of observers.splice(0)) observer.disconnect();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.push([type, listener]);
      add(type, listener);
    },
  );
  vi.stubGlobal(
    'MutationObserver',
    class extends MutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observers.push(this);
      }
    },
  );
  // jsdom has no layout: give the page a 1440×900 viewport.
  Object.defineProperty(document.documentElement, 'clientWidth', { value: 1440, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 900, configurable: true });
  pageWidth(false);
  vi.resetModules();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('editlet.window')];
});

describe('window.js', () => {
  it('places a dialog that appears later', async () => {
    await import('./entry');
    const { dialog } = openDialog();
    await Promise.resolve();
    expect(dialog.style.width).toMatch(/px$/);
  });

  it('leaves a bottom sheet to the loader’s CSS and ignores gestures on it', async () => {
    pageWidth(true);
    const { dialog, frame } = openDialog();
    dialog.style.left = '5px';
    await import('./entry');
    expect(dialog.getAttribute('style')).toBe('');
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 });
    send(frame, { type: 'drag', kind: 'move', phase: 'move', dx: -40, dy: 30 });
    send(frame, { type: 'drag', kind: 'move', phase: 'end', dx: -40, dy: 30 });
    expect(dialog.getAttribute('style')).toBe('');
    expect(localStorage.getItem('editlet:window')).toBeNull();
  });

  it('resizes a bottom sheet by its own handle on the top edge, and remembers the height apart from the rect', async () => {
    pageWidth(true);
    const { dialog, frame } = openDialog();
    dialog.getBoundingClientRect = () => ({ height: 600 }) as DOMRect;
    await import('./entry');
    const handle = dialog.querySelector<HTMLElement>('[data-editlet-handle]')!;
    expect(handle.hidden).toBe(false);
    const pointer = (type: string, clientY: number) =>
      handle.dispatchEvent(new MouseEvent(type, { button: 0, clientY, bubbles: true }));
    pointer('pointerdown', 500);
    expect(handle.hasAttribute('data-active')).toBe(true);
    pointer('pointermove', 400);
    expect(dialog.style.height).toBe('700px');
    expect(dialog.style.top).toBe('');
    pointer('pointerup', 400);
    expect(handle.hasAttribute('data-active')).toBe(false);
    expect(localStorage.getItem('editlet:sheet')).toBe('700');
    expect(localStorage.getItem('editlet:window')).toBeNull();
    // The admin's gestures do nothing on a sheet; collapsed, the handle hides.
    send(frame, { type: 'drag', kind: 'n', phase: 'start', dx: 0, dy: 0 });
    send(frame, { type: 'drag', kind: 'n', phase: 'move', dx: 0, dy: -100 });
    expect(dialog.style.height).toBe('700px');
    send(frame, { type: 'collapse', w: 140, h: 40 });
    expect(handle.hidden).toBe(true);
  });

  it('marks the dialog with the sides a hovered or pulled resize edge moves, not while it moves', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    const lit = () => dialog.getAttribute('data-editlet-edge');
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 });
    expect(lit()).toBeNull();
    send(frame, { type: 'drag', kind: 'move', phase: 'end', dx: 0, dy: 0 });
    // The admin names the hovered zone: one side for an edge, two for a corner. Without a name every side lights.
    send(frame, { type: 'edge', hover: true, edge: 'e' });
    expect(lit()).toBe('right');
    send(frame, { type: 'edge', hover: true, edge: 'nw' });
    expect(lit()).toBe('top-left');
    send(frame, { type: 'edge', hover: true });
    expect(lit()).toBe('all');
    send(frame, { type: 'edge', hover: true, edge: 's' });
    send(frame, { type: 'drag', kind: 'se', phase: 'start', dx: 0, dy: 0 });
    // The pulled edge wins, and the pointer is captured while pulling: leaving the edge keeps it lit until the drag ends.
    expect(lit()).toBe('bottom-right');
    send(frame, { type: 'edge', hover: false });
    expect(lit()).toBe('bottom-right');
    send(frame, { type: 'drag', kind: 'se', phase: 'end', dx: 10, dy: 10 });
    expect(lit()).toBeNull();
    // A lost `hover: false`: the pointer moving on the page outside the dialog turns it off too.
    send(frame, { type: 'edge', hover: true, edge: 'n' });
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(lit()).toBeNull();
    // Collapsed into the pill, nothing lights.
    send(frame, { type: 'edge', hover: true, edge: 'n' });
    send(frame, { type: 'collapse', w: 140, h: 40 });
    expect(lit()).toBeNull();
  });

  it('lights the hovered edge again when a pull ends with the pointer still over a zone', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    send(frame, { type: 'edge', hover: true, edge: 'e' });
    send(frame, { type: 'drag', kind: 'se', phase: 'start', dx: 0, dy: 0 });
    expect(dialog.getAttribute('data-editlet-edge')).toBe('bottom-right');
    send(frame, { type: 'drag', kind: 'se', phase: 'end', dx: 5, dy: 5 });
    expect(dialog.getAttribute('data-editlet-edge')).toBe('right');
  });

  it('lights nothing on the sheet, and an edge message there does nothing', async () => {
    pageWidth(true);
    const { dialog, frame } = openDialog();
    await import('./entry');
    send(frame, { type: 'edge', hover: true, edge: 'n' });
    send(frame, { type: 'edge', hover: true });
    expect(dialog.hasAttribute('data-editlet-edge')).toBe(false);
  });

  it('forgets a pull when the page narrows to the sheet or the window collapses mid-resize', async () => {
    // One live media query list, so the page can narrow after window.js started.
    const narrow = { matches: false, media: '' } as MediaQueryList;
    vi.stubGlobal('matchMedia', () => narrow);
    const { dialog, frame } = openDialog();
    await import('./entry');
    const lit = () => dialog.getAttribute('data-editlet-edge');
    // The page narrows: the `end` is ignored on a sheet, so nothing may stay lit (nor come back when it widens).
    send(frame, { type: 'edge', hover: true, edge: 'e' });
    send(frame, { type: 'drag', kind: 'nw', phase: 'start', dx: 0, dy: 0 });
    expect(lit()).toBe('top-left');
    Object.assign(narrow, { matches: true });
    window.dispatchEvent(new Event('resize'));
    expect(lit()).toBeNull();
    Object.assign(narrow, { matches: false });
    window.dispatchEvent(new Event('resize'));
    expect(lit()).toBeNull();
    // Collapsed: the same.
    send(frame, { type: 'drag', kind: 'se', phase: 'start', dx: 0, dy: 0 });
    expect(lit()).toBe('bottom-right');
    send(frame, { type: 'collapse', w: 140, h: 40 });
    send(frame, { type: 'expand' });
    expect(lit()).toBeNull();
  });

  it('draws the sheet-edge gradient above the sheet, not for the pill, and the side shadows on the window', async () => {
    openDialog();
    await import('./entry');
    const css = document.querySelector('style[data-editlet-handle]')!.textContent!;
    // jsdom has no layout: assert the rules the page gets.
    expect(css).toContain('inset:-30px 0 auto;height:60px');
    expect(css).toContain('linear-gradient(#1c191700,#1c19173d)');
    expect(css).toContain('>[data-editlet-handle][hidden]))::before');
    for (const rule of ['^=top]', '^=bottom]', '$=right]', '$=left]', '=all]'])
      expect(css).toContain(`[data-editlet-edge${rule}`);
    // Prefixed variables (a site's own `--s` must not reach the shadow), and no motion when the user asks for none.
    for (const side of ['n', 'e', 's', 'w']) expect(css).toContain(`--editlet-${side}:#8b5cf6`);
    expect(css).not.toMatch(/var\(--[nesw][,)]/);
    expect(css).toMatch(/prefers-reduced-motion:reduce\)\{dialog\[data-editlet\][^}]*transition:none/);
  });

  it('moves and resizes on the admin’s gestures, then remembers the rect', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    const left = parseFloat(dialog.style.left);
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 });
    send(frame, { type: 'drag', kind: 'move', phase: 'move', dx: -40, dy: 30 });
    expect(parseFloat(dialog.style.left)).toBe(left - 40);
    send(frame, { type: 'drag', kind: 'move', phase: 'end', dx: -40, dy: 30 });
    expect(JSON.parse(localStorage.getItem('editlet:window')!)).toMatchObject({ x: left - 40, y: 50 });
  });

  it('collapses into the pill (no gestures there) and expands back to the same rect', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    const placed = dialog.getAttribute('style');
    send(frame, { type: 'collapse', w: 140, h: 40 });
    expect(dialog.style.bottom).toBe('20px');
    expect(dialog.style.width).toBe('140px');
    expect(dialog.style.borderRadius).toBe('20px');
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 });
    send(frame, { type: 'drag', kind: 'move', phase: 'move', dx: -40, dy: 30 });
    expect(dialog.style.width).toBe('140px');
    send(frame, { type: 'expand' });
    expect(dialog.getAttribute('style')).toBe(placed);
  });

  it('collapses with the pill’s shadow on the dialog, and drops it on expand', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    send(frame, { type: 'collapse', w: 140, h: 56, shadow: 'rgb(0, 0, 0) 0px 12px 32px -8px' });
    expect(dialog.style.boxShadow).toBe('rgb(0, 0, 0) 0px 12px 32px -8px');
    send(frame, { type: 'expand' });
    expect(dialog.style.boxShadow).toBe('');
  });

  it('answers hello with what covers the dialog’s bottom, and sends it again only when it changes', async () => {
    const { dialog, frame } = openDialog();
    let bottom = 900;
    dialog.getBoundingClientRect = () => ({ bottom, height: 600 }) as DOMRect;
    const vv = Object.assign(new EventTarget(), { offsetTop: 0, height: 900, scale: 1 });
    vi.stubGlobal('visualViewport', vv);
    // One frame at a time, run by hand.
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    const nextFrame = () => frames.splice(0).forEach((cb) => cb(0));
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    await import('./entry');
    post.mockClear();
    send(frame, { type: 'hello' });
    expect(post).toHaveBeenCalledWith({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 0, keyboard: 0 }, ORIGIN);
    // The keyboard comes up: the visual viewport shrinks by 300 px, over many events, sent once in the next frame.
    vv.height = 600;
    vv.dispatchEvent(new Event('resize'));
    vv.dispatchEvent(new Event('scroll'));
    vv.dispatchEvent(new Event('resize'));
    expect(frames).toHaveLength(1);
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ keyboard: 300 }), ORIGIN);
    nextFrame();
    expect(post).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'viewport', safeBottom: 0, keyboard: 300 },
      ORIGIN,
    );
    post.mockClear();
    vv.dispatchEvent(new Event('scroll'));
    nextFrame();
    expect(post).not.toHaveBeenCalled();
    // A gesture that moves the dialog up out of the keyboard's way changes it again.
    bottom = 700;
    window.dispatchEvent(new Event('resize'));
    expect(post).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'viewport', safeBottom: 0, keyboard: 100 },
      ORIGIN,
    );
  });

  it('reports the page’s safe area under a dialog at the bottom, read from the probe’s computed padding', async () => {
    const { dialog, frame } = openDialog();
    dialog.getBoundingClientRect = () => ({ bottom: 900, height: 600 }) as DOMRect;
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { offsetTop: 0, height: 900, scale: 1 }));
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) =>
      el.parentElement === dialog && (el as HTMLElement).hidden
        ? ({ paddingBottom: '34px' } as CSSStyleDeclaration)
        : real(el),
    );
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    await import('./entry');
    send(frame, { type: 'hello' });
    // The probe: a hidden child of the dialog (the sheet's handle is shown on a dialog that is not a pill).
    expect([...dialog.children].filter((el) => (el as HTMLElement).hidden)).toHaveLength(1);
    expect(post).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'viewport', safeBottom: 34, keyboard: 0 },
      ORIGIN,
    );
  });

  it('measures again where an animated expand lands, not where its first frame is', async () => {
    const { dialog, frame } = openDialog();
    // The pill sits 20 px above the bottom; the expanded sheet reaches it.
    let bottom = 880;
    dialog.getBoundingClientRect = () => ({ bottom, height: 56, left: 0, top: 0, width: 140 }) as DOMRect;
    vi.stubGlobal('visualViewport', Object.assign(new EventTarget(), { offsetTop: 0, height: 900, scale: 1 }));
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) =>
      el.parentElement === dialog && (el as HTMLElement).hidden
        ? ({ paddingBottom: '34px' } as CSSStyleDeclaration)
        : real(el),
    );
    let landed!: () => void;
    dialog.animate = () => ({ finished: new Promise<void>((resolve) => (landed = resolve)) }) as unknown as Animation;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    await import('./entry');
    send(frame, { type: 'collapse', w: 140, h: 56 });
    landed();
    await Promise.resolve();
    send(frame, { type: 'expand' });
    // Measured at once: still the pill's place (14 px of the safe area under it).
    expect(post).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'viewport', safeBottom: 14, keyboard: 0 },
      ORIGIN,
    );
    bottom = 900;
    landed();
    await Promise.resolve();
    expect(post).toHaveBeenLastCalledWith(
      { source: WINDOW_SOURCE, type: 'viewport', safeBottom: 34, keyboard: 0 },
      ORIGIN,
    );
  });

  it('collapses a bottom sheet too, and expands it back to the loader’s CSS', async () => {
    pageWidth(true);
    const { dialog, frame } = openDialog();
    await import('./entry');
    send(frame, { type: 'collapse', w: 140, h: 40 });
    expect(dialog.style.width).toBe('140px');
    send(frame, { type: 'expand' });
    expect(dialog.getAttribute('style')).toBe('');
  });

  it('opens a new dialog expanded', async () => {
    const first = openDialog();
    await import('./entry');
    send(first.frame, { type: 'collapse', w: 140, h: 40 });
    first.dialog.remove();
    const { dialog } = openDialog();
    await Promise.resolve();
    expect(dialog.style.width).toBe('600px');
  });

  it('ignores messages from other origins and other windows', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    const before = dialog.style.left;
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 }, 'https://evil.test');
    send(frame, { type: 'drag', kind: 'move', phase: 'move', dx: 99, dy: 99 }, 'https://evil.test');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: WINDOW_SOURCE, type: 'drag', kind: 'move', phase: 'move', dx: 99, dy: 99 },
        origin: ORIGIN,
        source: window,
      }),
    );
    expect(dialog.style.left).toBe(before);
  });
});
