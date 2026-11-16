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

  it('marks the dialog while a resize edge is hovered or pulled, not while it moves', async () => {
    const { dialog, frame } = openDialog();
    await import('./entry');
    const lit = () => dialog.hasAttribute('data-editlet-edge');
    send(frame, { type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 });
    expect(lit()).toBe(false);
    send(frame, { type: 'drag', kind: 'move', phase: 'end', dx: 0, dy: 0 });
    send(frame, { type: 'edge', hover: true });
    expect(lit()).toBe(true);
    send(frame, { type: 'drag', kind: 'se', phase: 'start', dx: 0, dy: 0 });
    // The pointer is captured while pulling: leaving the edge keeps the outline lit until the drag ends.
    send(frame, { type: 'edge', hover: false });
    expect(lit()).toBe(true);
    send(frame, { type: 'drag', kind: 'se', phase: 'end', dx: 10, dy: 10 });
    expect(lit()).toBe(false);
    // A lost `hover: false`: the pointer moving on the page outside the dialog turns the outline off too.
    send(frame, { type: 'edge', hover: true });
    document.body.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    expect(lit()).toBe(false);
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
