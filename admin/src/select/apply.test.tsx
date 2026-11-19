import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WINDOW_SOURCE } from '../../../loader/window/channel';
import { fixtureFiles, HOME_LOADED, renderApp, sheet } from '../test/render';

const POST = 'cms/content/post/hello-world.md';
const BODY = 'Intro line.\n\nWe ship **small, fast** sites. Hello again.\n';

function files() {
  const base = fixtureFiles();
  return { ...base, [POST]: `${String(base[POST]).split('\n---\n')[0]}\n---\n${BODY}` };
}

/** window.js posting `select` (in jsdom the admin's parent is its own window). */
function select(body: { entry: string; field?: string; quote: string; prefix?: string; suffix?: string }) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: WINDOW_SOURCE, type: 'select', prefix: '', suffix: '', ...body },
        origin: window.location.origin,
        source: window,
      }),
    );
  });
}

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('select-to-edit in the admin', () => {
  it('opens the entry and selects the words in a text input', async () => {
    renderApp({ files: files() });
    await screen.findByRole('link', { name: HOME_LOADED });
    select({ entry: 'post/hello-world', quote: 'WORLD' });
    // The field's modal opens, then the words are selected in it.
    const title = (await sheet('Title')).getByLabelText(/^Title/) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect([title.selectionStart, title.selectionEnd]).toEqual([6, 11]);
    expect(screen.getByText('Selected in Title')).toBeDefined();
  });

  it('selects the source of the words in the body textarea (Source mode), through markup', async () => {
    localStorage.setItem('editlet:markdown-mode', 'source');
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('button', { name: /^Body/ });
    select({ entry: 'post/hello-world', field: 'body', quote: 'ship small, fast sites' });
    const body = (await sheet('Body')).getByLabelText(/^Body/) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(body.value.slice(body.selectionStart, body.selectionEnd)).toBe('ship **small, fast** sites');
  });

  it('selects the words in the rich editor', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('button', { name: /^Body/ });
    // The body is not in a plain field: its modal opens, the rich editor loads, and the words are selected in it.
    select({ entry: 'post/hello-world', quote: 'small, fast', prefix: 'We ship ' });
    await waitFor(() => expect(document.getSelection()?.toString()).toBe('small, fast'), { timeout: 5000 });
    expect(await screen.findByRole('toolbar', { name: 'Formatting' })).toBeDefined();
    expect(screen.getByText('Selected in Body')).toBeDefined();
  });

  it('says so when the words are not in the entry', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('button', { name: /^Title/ });
    select({ entry: 'post/hello-world', quote: 'nothing like this anywhere' });
    expect(
      await screen.findByText("Couldn't find the selected text in this entry", {}, { timeout: 5000 }),
    ).toBeDefined();
    // The body's modal, opened to search it, closes again.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('puts back the modal the editor had open when the words are not in the entry', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    fireEvent.click(await screen.findByRole('button', { name: /^Title/ }));
    await sheet('Title');
    select({ entry: 'post/hello-world', quote: 'nothing like this anywhere' });
    expect(
      await screen.findByText("Couldn't find the selected text in this entry", {}, { timeout: 5000 }),
    ).toBeDefined();
    // The search opened the body's modal to read it; the Title modal the editor had open is back.
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Title' })).toBeDefined());
    expect(screen.queryByRole('dialog', { name: 'Body' })).toBeNull();
  });

  it('ignores messages from other windows and malformed ones', async () => {
    renderApp({ files: files() });
    await screen.findByRole('link', { name: HOME_LOADED });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            source: WINDOW_SOURCE,
            type: 'select',
            entry: 'post/hello-world',
            quote: 'x',
            prefix: '',
            suffix: '',
          },
          origin: 'https://evil.test',
          source: window,
        }),
      );
    });
    select({ entry: 'not a ref', quote: 'x' });
    expect(screen.getByRole('link', { name: HOME_LOADED })).toBeDefined();
  });
});
