import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { WINDOW_SOURCE, type PreviewState } from '../../../loader/window/channel';
import { SHEET_MEDIA } from '../../../loader/window/geometry';
import { App } from '../App';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { createTestQueryClient, fixtureFiles, HOME_LOADED, openCollection, openField } from '../test/render';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The window chrome posts to `window.parent` and listens on the global window; in jsdom those are the same object,
 * so the page's side of the private channel is played by dispatching on `window` with the admin's own origin.
 */
async function openEmbedded(route = '') {
  const fake = createFakeWindow();
  const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  render(<App source={createMemorySource(fixtureFiles())} win={fake.win} queryClient={createTestQueryClient()} />);
  act(() => fake.fromSite({ type: 'init', route, site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
  if (route) await screen.findByRole('button', { name: /^Title/ });
  else await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
  const fromPage = (data: unknown) =>
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data, origin: window.location.origin, source: window }));
    });
  return { posted, fromPage };
}

const state: PreviewState = { branch: 'editlet/x', patched: 1, pending: 2 };

describe('the window status bar', () => {
  it('ignores a preview message from another origin', async () => {
    const { fromPage } = await openEmbedded();
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: WINDOW_SOURCE, type: 'preview', state },
          origin: 'https://evil.test',
          source: window,
        }),
      );
    });
    expect(screen.queryByRole('button', { name: 'Stop preview' })).toBeNull();
    fromPage({ source: WINDOW_SOURCE, type: 'preview', state: { branch: 3 } });
    expect(screen.queryByRole('button', { name: 'Stop preview' })).toBeNull();
  });
});

describe('the Back button', () => {
  it('is absent on Home and goes one level up: entry → collection → All content → Home', async () => {
    await openEmbedded();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();

    fireEvent.click(within(screen.getByRole('main')).getByRole('link', { name: HOME_LOADED }));
    expect((await screen.findByRole('link', { name: 'Back' })).getAttribute('title')).toBe('Back to Home');
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /^Posts?\s*1 entry/ }));
    const toContent = await screen.findByRole('link', { name: 'Back' });
    expect(toContent.getAttribute('title')).toBe('Back to All content');
    fireEvent.click(toContent);
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /^Posts?\s*1 entry/ }));
    await within(screen.getByRole('main')).findByRole('heading', { name: /^Posts?$/ });

    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /^hello/i }));
    await within(screen.getByRole('main')).findByRole('group', { name: 'post/hello-world fields' });
    expect((await screen.findByRole('link', { name: 'Back' })).getAttribute('title')).toMatch(/^Back to Posts?$/);

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await within(screen.getByRole('main')).findByRole('heading', { name: /^Posts?$/ })).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await within(screen.getByRole('main')).findByRole('heading', { name: 'All content' })).toBeDefined();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED })).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });
});

describe('the bottom sheet', () => {
  it('keeps the move button and the eight resize zones on a wide page', async () => {
    await openEmbedded();
    expect(screen.getByRole('button', { name: 'Move window' })).toBeDefined();
    expect(document.querySelectorAll('[data-editlet="window-edge"]')).toHaveLength(8);
  });

  it('drops them on a page narrower than SHEET_MEDIA (window.js resizes the sheet)', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({
      matches: media === SHEET_MEDIA,
      media,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    await openEmbedded();
    expect(screen.queryByRole('button', { name: 'Move window' })).toBeNull();
    expect(document.querySelectorAll('[data-editlet="window-edge"]')).toHaveLength(0);
    expect(document.querySelector('[data-editlet="window-edges"]')).toBeNull();
  });
});

describe('resizing under a modal', () => {
  // jsdom has no pointer capture: a stub for the test, taken away after it.
  const captureStub = () => {
    HTMLElement.prototype.setPointerCapture = vi.fn();
  };
  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  });
  const edges = () => document.querySelectorAll<HTMLElement>('[data-editlet="window-edge"]');
  const layer = () => document.querySelector<HTMLElement>('[data-editlet="window-edges"]');
  const posts = (posted: { mock: { calls: unknown[][] } }) =>
    posted.mock.calls.map(([m]) => m as { source?: string; type: string }).filter((m) => m.source === WINDOW_SOURCE);

  it('draws the edges in a layer of their own, outside the screen a sheet pushes back', async () => {
    await openEmbedded();
    expect(edges()).toHaveLength(8);
    expect(layer()!.getAttribute('aria-hidden')).toBe('true');
    for (const edge of edges()) {
      expect(edge.parentElement).toBe(layer());
      expect(edge.closest('[data-editlet="window"]')).toBeNull();
    }
    // The Drawer.Indent (`sheet-pushed`) holds the window; the layer is its sibling.
    const indent = document.querySelector<HTMLElement>('.sheet-pushed')!;
    expect(indent.contains(layer())).toBe(false);
    expect(indent.querySelector('[data-editlet="window"]')).not.toBeNull();
  });

  it('has none while the window is collapsed into the pill, and again once it expands', async () => {
    const { posted } = await openEmbedded();
    fireEvent.pointerEnter(edges()[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(edges()).toHaveLength(0);
    expect(layer()).toBeNull();
    // An edge that goes away while hovered says it was left.
    expect(
      posts(posted)
        .filter((m) => m.type === 'edge')
        .at(-1),
    ).toMatchObject({ hover: false });
    fireEvent.click(screen.getByRole('button', { name: 'Editlet' }));
    expect(edges()).toHaveLength(8);
  });

  it('still drags and resizes with a sheet open, and the sheet stays open', async () => {
    const { posted } = await openEmbedded('post/hello-world');
    captureStub();
    await openField('Title');
    const edge = document.querySelector<HTMLElement>('[data-editlet="window-edge"][data-edge="e"]')!;
    expect(edge.closest('.sheet-pushed')).toBeNull();

    fireEvent.pointerEnter(edge);
    fireEvent.pointerDown(edge, { button: 0, pointerId: 1, screenX: 100, screenY: 50 });
    fireEvent.pointerMove(edge, { screenX: 130, screenY: 50 });
    fireEvent.pointerUp(edge, { screenX: 140, screenY: 50 });
    const drag = posts(posted)
      .filter((m) => m.type === 'drag')
      .map((m) => m as unknown as { kind: string; phase: string; dx: number });
    expect(drag.map(({ kind, phase, dx }) => [kind, phase, dx])).toEqual([
      ['e', 'start', 0],
      ['e', 'move', 30],
      ['e', 'end', 40],
    ]);
    expect(posts(posted).find((m) => m.type === 'edge')).toMatchObject({ hover: true, edge: 'e' });
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeDefined();
  });

  it('puts the focus and the selection of a field in the sheet back after a press on an edge', async () => {
    await openEmbedded('post/hello-world');
    captureStub();
    await openField('Title');
    const input = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    input.focus();
    input.setSelectionRange(2, 5);
    const edge = document.querySelector<HTMLElement>('[data-editlet="window-edge"][data-edge="s"]')!;

    fireEvent.pointerDown(edge, { button: 0, pointerId: 1, screenX: 0, screenY: 0 });
    // What an engine may do to a press on an element that cannot take the focus: it goes to <body>.
    input.blur();
    expect(document.activeElement).toBe(document.body);
    input.setSelectionRange(0, 0);
    fireEvent.pointerUp(edge, { screenX: 0, screenY: 40 });

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
    expect(screen.getByRole('dialog', { name: 'Title' })).toBeDefined();
  });

  it('does not take the focus from an element the press moved it to on purpose', async () => {
    await openEmbedded('post/hello-world');
    captureStub();
    await openField('Title');
    const input = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    input.focus();
    const edge = document.querySelector<HTMLElement>('[data-editlet="window-edge"][data-edge="s"]')!;
    fireEvent.pointerDown(edge, { button: 0, pointerId: 1, screenX: 0, screenY: 0 });
    const other = within(screen.getByRole('dialog', { name: 'Title' })).getByRole('button', { name: 'Close' });
    other.focus();
    fireEvent.pointerUp(edge, { screenX: 0, screenY: 40 });
    expect(document.activeElement).toBe(other);
  });
});

describe('the pill', () => {
  const windowMessages = (posted: { mock: { calls: unknown[][] } }) =>
    posted.mock.calls.map(([m]) => m as { source?: string; type: string }).filter((m) => m.source === WINDOW_SOURCE);

  it('tells window.js when the pointer enters and leaves a resize edge', async () => {
    const { posted } = await openEmbedded();
    const edge = document.querySelector('[data-editlet="window-edge"][data-edge="e"]')!;
    fireEvent.pointerEnter(edge);
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'edge', hover: true });
    fireEvent.pointerLeave(edge);
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'edge', hover: false });
  });

  it('× collapses the window into the pill; Editlet expands it with the screen kept', async () => {
    const { posted } = await openEmbedded();
    await openCollection(within(screen.getByRole('main')), 'Post');
    await within(screen.getByRole('main')).findByRole('heading', { name: /^Posts?$/ });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'collapse' });
    expect(screen.getByRole('main').closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close Editlet' }).closest('[inert]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Editlet' }));
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'expand' });
    expect(within(screen.getByRole('main')).getByRole('heading', { name: /^Posts?$/ })).toBeDefined();
    expect(screen.getByRole('main').closest('[inert]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close Editlet' }).closest('[inert]')).not.toBeNull();
  });

  it('puts the focus back on the Minimize button when Editlet expands the window', async () => {
    await openEmbedded();
    const minimize = screen.getByRole('button', { name: 'Minimize' });
    minimize.focus();
    fireEvent.click(minimize);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Editlet' }));
    fireEvent.click(screen.getByRole('button', { name: 'Editlet' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Minimize' })));
  });
});
