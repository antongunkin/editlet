import { act, fireEvent, render, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
  usePagePreview,
  usePageSheet,
  usePageViewport,
  useEdgeHover,
  useWindowGesture,
  useWindowPill,
} from './channel';

import { WINDOW_SOURCE, type PreviewState } from '../../../loader/window/channel';
import { SHEET_MEDIA, type Gesture } from '../../../loader/window/geometry';

// In jsdom `window.parent === window`: the hooks post to `window` and the page's answers are dispatched on it.

let posted: MockInstance<(message: unknown, origin: string) => void>;
beforeEach(() => {
  posted = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined) as unknown as typeof posted;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const sent = () => posted.mock.calls.map(([message, origin]) => ({ message, origin }));
const messages = () => posted.mock.calls.map(([message]) => message as Record<string, unknown>);

const fromPage = (data: unknown, opts: { origin?: string; source?: MessageEventSource | null } = {}) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data,
        origin: opts.origin ?? window.location.origin,
        source: 'source' in opts ? opts.source : window,
      }),
    );
  });

describe('usePagePreview', () => {
  const state: PreviewState = { branch: 'editlet/x', patched: 1, pending: 0 };

  it('says hello to the page at the admin origin and takes the state it reports', () => {
    const { result, unmount } = renderHook(() => usePagePreview(true));
    expect(sent()).toEqual([{ message: { source: WINDOW_SOURCE, type: 'hello' }, origin: window.location.origin }]);
    expect(result.current).toBeNull();
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state });
    expect(result.current).toEqual(state);
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state: null });
    expect(result.current).toBeNull();

    unmount();
    // No listener after unmount: nothing throws, nothing is set.
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state });
  });

  it('tells the page the theme right after hello (window.js may not have been listening before)', () => {
    document.documentElement.dataset.editletTheme = 'dark';
    try {
      renderHook(() => usePagePreview(true));
      expect(messages()).toEqual([
        { source: WINDOW_SOURCE, type: 'hello' },
        { source: WINDOW_SOURCE, type: 'theme', theme: 'dark' },
      ]);
    } finally {
      delete document.documentElement.dataset.editletTheme;
    }
  });

  it('ignores other origins, other sources and malformed messages', () => {
    const { result } = renderHook(() => usePagePreview(true));
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state }, { origin: 'https://evil.test' });
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state }, { source: null });
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state: { branch: 1, patched: 0, pending: 0 } });
    fromPage({ source: 'other', type: 'preview', state });
    expect(result.current).toBeNull();
  });

  it('does nothing when the admin is not embedded', () => {
    const { result } = renderHook(() => usePagePreview(false));
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state });
    expect(result.current).toBeNull();
    expect(posted).not.toHaveBeenCalled();
  });
});

function stubMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: vi.fn((_: string, fn: () => void) => listeners.add(fn)),
    removeEventListener: vi.fn((_: string, fn: () => void) => listeners.delete(fn)),
  };
  const matchMedia = vi.fn(() => query);
  vi.stubGlobal('matchMedia', matchMedia);
  const change = (matches: boolean) =>
    act(() => {
      query.matches = matches;
      for (const fn of listeners) fn();
    });
  return { query, matchMedia, listeners, change };
}

describe('usePageSheet', () => {
  it("follows SHEET_MEDIA on the page's viewport", () => {
    const media = stubMedia(false);
    const { result, unmount } = renderHook(() => usePageSheet());
    expect(media.matchMedia).toHaveBeenCalledWith(SHEET_MEDIA);
    expect(result.current).toBe(false);
    media.change(true);
    expect(result.current).toBe(true);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it('is false when the page cannot be read', () => {
    vi.stubGlobal('matchMedia', () => {
      throw new DOMException('cross-origin', 'SecurityError');
    });
    const { result } = renderHook(() => usePageSheet());
    expect(result.current).toBe(false);
  });
});

function Pill({ collapsed, shadow }: { collapsed: boolean; shadow?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useWindowPill(ref, collapsed);
  return <div ref={ref} style={{ width: '120.2px', height: '39.5px', boxShadow: shadow }} />;
}

describe('useWindowPill', () => {
  it('posts the rounded-up layout size while collapsed and expand when it opens or unmounts', () => {
    const view = render(<Pill collapsed={false} />);
    expect(posted).not.toHaveBeenCalled();
    view.rerender(<Pill collapsed />);
    expect(messages()).toEqual([{ source: WINDOW_SOURCE, type: 'collapse', w: 121, h: 40 }]);
    view.rerender(<Pill collapsed={false} />);
    expect(messages().at(-1)).toEqual({ source: WINDOW_SOURCE, type: 'expand' });
    view.rerender(<Pill collapsed />);
    view.unmount();
    expect(messages().map((m) => m.type)).toEqual(['collapse', 'expand', 'collapse', 'expand']);
  });

  it('sends the new shadow when the theme changes while collapsed, and nothing when it stays the same', async () => {
    const view = render(<Pill collapsed shadow="0 12px 32px -8px red" />);
    posted.mockClear();
    const pill = view.container.firstElementChild as HTMLElement;
    pill.style.boxShadow = '0 12px 32px -8px blue';
    document.documentElement.dataset.editletTheme = 'dark';
    await act(() => Promise.resolve());
    expect(messages()).toEqual([
      { source: WINDOW_SOURCE, type: 'collapse', w: 121, h: 40, shadow: 'rgb(0, 0, 255) 0px 12px 32px -8px' },
    ]);
    document.documentElement.dataset.editletTheme = 'light';
    await act(() => Promise.resolve());
    expect(messages()).toHaveLength(1);
    view.unmount();
    delete document.documentElement.dataset.editletTheme;
  });

  it('sends the pill’s shadow along, for the dialog to draw', () => {
    render(<Pill collapsed shadow="0 12px 32px -8px red" />);
    expect(messages()).toEqual([
      { source: WINDOW_SOURCE, type: 'collapse', w: 121, h: 40, shadow: 'rgb(255, 0, 0) 0px 12px 32px -8px' },
    ]);
  });
});

describe('usePageViewport', () => {
  const root = () => document.documentElement.style;

  it('says hello, then sets the safe area and the keyboard the page reports on the root, and clears them on unmount', () => {
    const { unmount } = renderHook(() => usePageViewport(true));
    expect(messages()).toEqual([{ source: WINDOW_SOURCE, type: 'hello' }]);
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 34, keyboard: 0 });
    expect(root().getPropertyValue('--safe-bottom')).toBe('34px');
    expect(root().getPropertyValue('--keyboard')).toBe('0px');
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 0, keyboard: 300 });
    expect(root().getPropertyValue('--keyboard')).toBe('300px');
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(true);
    unmount();
    expect(root().getPropertyValue('--safe-bottom')).toBe('');
    expect(root().getPropertyValue('--keyboard')).toBe('');
    expect(document.documentElement.hasAttribute('data-keyboard')).toBe(false);
  });

  it('ignores other origins, other windows and malformed messages, and does nothing standalone', () => {
    const { unmount } = renderHook(() => usePageViewport(true));
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 1, keyboard: 1 }, { origin: 'https://evil.test' });
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 1, keyboard: 1 }, { source: null });
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: -1, keyboard: 1 });
    expect(root().getPropertyValue('--keyboard')).toBe('');
    unmount();
    posted.mockClear();
    renderHook(() => usePageViewport(false));
    fromPage({ source: WINDOW_SOURCE, type: 'viewport', safeBottom: 1, keyboard: 1 });
    expect(posted).not.toHaveBeenCalled();
    expect(root().getPropertyValue('--keyboard')).toBe('');
  });
});

function Edge() {
  return <div data-testid="edge" {...useEdgeHover()} />;
}

describe('useEdgeHover', () => {
  it('reports enter and leave, and a leave when it unmounts while hovered', () => {
    const view = render(<Edge />);
    const edge = view.getByTestId('edge');
    fireEvent.pointerEnter(edge);
    fireEvent.pointerLeave(edge);
    expect(messages()).toEqual([
      { source: WINDOW_SOURCE, type: 'edge', hover: true },
      { source: WINDOW_SOURCE, type: 'edge', hover: false },
    ]);
    view.unmount();
    expect(messages()).toHaveLength(2);

    const again = render(<Edge />);
    fireEvent.pointerEnter(again.getByTestId('edge'));
    again.unmount();
    expect(messages().at(-1)).toEqual({ source: WINDOW_SOURCE, type: 'edge', hover: false });
  });

  it('names the zone on enter, so window.js lights only its sides', () => {
    const named = render(<NamedEdge />);
    fireEvent.pointerEnter(named.getByTestId('se'));
    fireEvent.pointerLeave(named.getByTestId('se'));
    expect(messages().slice(-2)).toEqual([
      { source: WINDOW_SOURCE, type: 'edge', hover: true, edge: 'se' },
      { source: WINDOW_SOURCE, type: 'edge', hover: false },
    ]);
  });
});

function NamedEdge() {
  return <div data-testid="se" {...useEdgeHover('se')} />;
}

function Handle({ kind }: { kind: Gesture }) {
  return <button type="button" data-testid="handle" {...useWindowGesture(kind)} />;
}

const drags = () => messages().map(({ kind, phase, dx, dy }) => [kind, phase, dx, dy]);

describe('useWindowGesture', () => {
  beforeEach(() => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });

  it('posts screen deltas since the pointer went down, and only while it is down', () => {
    const { getByTestId } = render(<Handle kind="move" />);
    const handle = getByTestId('handle');
    fireEvent.pointerMove(handle, { screenX: 50, screenY: 50 });
    fireEvent.pointerUp(handle, { screenX: 50, screenY: 50 });
    fireEvent.pointerDown(handle, { button: 2, screenX: 10, screenY: 10 });
    expect(posted).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { button: 0, pointerId: 7, screenX: 100, screenY: 200 });
    expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
    fireEvent.pointerMove(handle, { screenX: 130, screenY: 190 });
    fireEvent.pointerUp(handle, { screenX: 140, screenY: 185 });
    fireEvent.pointerMove(handle, { screenX: 0, screenY: 0 });
    fireEvent.pointerUp(handle, { screenX: 0, screenY: 0 });
    expect(drags()).toEqual([
      ['move', 'start', 0, 0],
      ['move', 'move', 30, -10],
      ['move', 'end', 40, -15],
    ]);
  });

  it('repeats the gesture by a step for arrow keys; Shift is a big step, Alt resizes from the corner', () => {
    const { getByTestId } = render(<Handle kind="n" />);
    const handle = getByTestId('handle');
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(posted).not.toHaveBeenCalled();

    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(drags()).toEqual([
      ['n', 'start', 0, 0],
      ['n', 'move', 0, -20],
      ['n', 'end', 0, -20],
    ]);
    posted.mockClear();
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true, altKey: true });
    expect(drags()).toEqual([
      ['se', 'start', 0, 0],
      ['se', 'move', 100, 0],
      ['se', 'end', 100, 0],
    ]);
    posted.mockClear();
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(drags().filter(([, phase]) => phase === 'end')).toEqual([
      ['n', 'end', -20, 0],
      ['n', 'end', 0, 20],
    ]);
  });
});
