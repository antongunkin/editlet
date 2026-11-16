import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { WINDOW_SOURCE } from '../../../loader/window/channel';
import { fixtureFiles, renderApp } from '../test/render';

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
    await screen.findByRole('heading', { name: 'Content' });
    select({ entry: 'post/hello-world', quote: 'WORLD' });
    const title = (await screen.findByLabelText(/^Title/)) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect([title.selectionStart, title.selectionEnd]).toEqual([6, 11]);
    expect(screen.getByText('Selected in Title')).toBeDefined();
  });

  it('selects the source of the words in the body textarea (Source mode), through markup', async () => {
    localStorage.setItem('editlet:markdown-mode', 'source');
    renderApp({ files: files(), route: 'post/hello-world' });
    const body = (await screen.findByLabelText(/^Body/)) as HTMLTextAreaElement;
    select({ entry: 'post/hello-world', field: 'body', quote: 'ship small, fast sites' });
    await waitFor(() => expect(document.activeElement).toBe(body));
    expect(body.value.slice(body.selectionStart, body.selectionEnd)).toBe('ship **small, fast** sites');
  });

  it('selects the words in the rich editor', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByRole('toolbar', { name: 'Formatting' });
    select({ entry: 'post/hello-world', quote: 'small, fast', prefix: 'We ship ' });
    await waitFor(() => expect(document.getSelection()?.toString()).toBe('small, fast'));
  });

  it('says so when the words are not in the entry', async () => {
    renderApp({ files: files(), route: 'post/hello-world' });
    await screen.findByLabelText(/^Title/);
    select({ entry: 'post/hello-world', quote: 'nothing like this anywhere' });
    expect(await screen.findByText("Couldn't find the selected text in this entry")).toBeDefined();
    expect(within(screen.getByRole('main')).getByLabelText(/^Title/)).not.toBe(document.activeElement);
  });

  it('ignores messages from other windows and malformed ones', async () => {
    renderApp({ files: files() });
    await screen.findByRole('heading', { name: 'Content' });
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
    expect(screen.getByRole('heading', { name: 'Content' })).toBeDefined();
  });
});
