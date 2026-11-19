import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { WINDOW_SOURCE, type PreviewState } from '../../../loader/window/channel';
import { SHEET_MEDIA } from '../../../loader/window/geometry';
import { App } from '../App';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { createTestQueryClient, fixtureFiles, HOME_LOADED, openCollection } from '../test/render';

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

/**
 * The window chrome posts to `window.parent` and listens on the global window; in jsdom those are the same object,
 * so the page's side of the private channel is played by dispatching on `window` with the admin's own origin.
 */
async function openEmbedded() {
  const fake = createFakeWindow();
  const posted = vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
  render(<App source={createMemorySource(fixtureFiles())} win={fake.win} queryClient={createTestQueryClient()} />);
  act(() => fake.fromSite({ type: 'init', route: '', site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
  await within(screen.getByRole('main')).findByRole('link', { name: HOME_LOADED });
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
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /^Post\s*1 entry/ }));
    const toContent = await screen.findByRole('link', { name: 'Back' });
    expect(toContent.getAttribute('title')).toBe('Back to All content');
    fireEvent.click(toContent);
    fireEvent.click(await within(screen.getByRole('main')).findByRole('link', { name: /^Post\s*1 entry/ }));
    await within(screen.getByRole('main')).findByRole('heading', { name: 'Post' });

    fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: /^hello/i }));
    await within(screen.getByRole('main')).findByRole('group', { name: 'post/hello-world fields' });
    expect(screen.getByRole('link', { name: 'Back' }).getAttribute('title')).toBe('Back to Post');

    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await within(screen.getByRole('main')).findByRole('heading', { name: 'Post' })).toBeDefined();
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
    await within(screen.getByRole('main')).findByRole('heading', { name: 'Post' });

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'collapse' });
    expect(screen.getByRole('main').closest('[inert]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Close Editlet' }).closest('[inert]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Editlet' }));
    expect(windowMessages(posted).at(-1)).toMatchObject({ type: 'expand' });
    expect(within(screen.getByRole('main')).getByRole('heading', { name: 'Post' })).toBeDefined();
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
