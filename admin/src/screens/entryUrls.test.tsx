import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openOnPageNote } from './OpenOnPage';

import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { fixtureFiles, moreAction, moreActions, renderApp, setField, sheet } from '../test/render';

/** The fixture site with `post`'s `url` set (`undefined` removes it) and the hello-world entry's front matter. */
function files(url: string | undefined, frontMatter = 'title: Hello world'): Record<string, string | Uint8Array> {
  const out = fixtureFiles();
  const schema = JSON.parse(out['cms/schema.json'] as string) as {
    collections: Record<string, Record<string, unknown>>;
  };
  if (url === undefined) delete schema.collections.post!.url;
  else schema.collections.post!.url = url;
  out['cms/schema.json'] = JSON.stringify(schema, null, 2);
  out['cms/content/post/hello-world.md'] = `---\n${frontMatter}\n---\nHello!\n`;
  return out;
}

/** The entry over a fake site page at `href`; `sent()` lists what the admin posted to it. */
async function openEmbedded(opts: { url?: string | null; href?: string; frontMatter?: string } = {}) {
  const fake = createFakeWindow();
  const url = opts.url === null ? undefined : (opts.url ?? '/posts/{slug}');
  renderApp({ files: files(url, opts.frontMatter), route: 'post/hello-world', win: fake.win });
  act(() =>
    fake.fromSite({
      type: 'init',
      route: 'post/hello-world',
      site: { origin: ORIGIN, href: opts.href ?? `${ORIGIN}/` },
    }),
  );
  await screen.findByRole('button', { name: /^Title/ });
  const sent = () => fake.parent.postMessage.mock.calls.map(([m]) => m as { type: string; [k: string]: unknown });
  return { fake, sent };
}

const opens = (sent: () => { type: string }[]) => sent().filter((m) => m.type === 'open');

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('⋯ → Open on the page', () => {
  it("sends the entry's path, after Details, and closes the sheet", async () => {
    const { sent } = await openEmbedded();
    const actions = await moreActions();
    const names = actions.getAllByRole('button').map((b) => b.textContent);
    expect(names.indexOf('Open on the page')).toBe(names.indexOf('Details') + 1);
    fireEvent.click(actions.getByRole('button', { name: 'Open on the page' }));
    await waitFor(() => expect(document.querySelector('[data-slot="action-sheet"]')).toBeNull());
    expect(opens(sent)).toEqual([expect.objectContaining({ type: 'open', path: '/posts/hello-world' })]);
  });

  it('is not there without the collection url', async () => {
    await openEmbedded({ url: null });
    expect((await moreActions()).queryByRole('button', { name: /^Open on the page/ })).toBeNull();
  });

  it('is not there when the admin has no site page (standalone)', async () => {
    renderApp({ files: files('/posts/{slug}'), route: 'post/hello-world' });
    await screen.findByRole('button', { name: /^Title/ });
    expect((await moreActions()).queryByRole('button', { name: /^Open on the page/ })).toBeNull();
  });

  it('is off with This page on the page itself, a trailing / ignored, and follows page messages', async () => {
    const { fake, sent } = await openEmbedded({ href: `${ORIGIN}/posts/hello-world/?x=1` });
    let row = (await moreActions()).getByRole('button', { name: /^Open on the page/ }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.textContent).toBe('Open on the pageThis page');
    fireEvent.click(row);
    expect(opens(sent)).toEqual([]);

    act(() => fake.fromSite({ type: 'page', href: `${ORIGIN}/posts/other` }));
    row = within(document.querySelector<HTMLElement>('[data-slot="action-sheet"]')!).getByRole('button', {
      name: /^Open on the page/,
    }) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    expect(row.textContent).toBe('Open on the page');
  });

  it('is off with Save first while the form has unsaved edits', async () => {
    const { sent } = await openEmbedded();
    await setField('Title', 'Changed');
    const row = (await moreActions()).getByRole('button', { name: /^Open on the page/ }) as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(row.textContent).toBe('Open on the pageSave first');
    fireEvent.click(row);
    expect(opens(sent)).toEqual([]);
  });

  it('says Draft on a draft and still opens it', async () => {
    const { sent } = await openEmbedded({ url: '/posts/{slug}/', frontMatter: 'title: Hello world\ndraft: true' });
    const row = (await moreActions()).getByRole('button', { name: /^Open on the page/ }) as HTMLButtonElement;
    expect(row.disabled).toBe(false);
    expect(row.textContent).toBe('Open on the pageDraft');
    fireEvent.click(row);
    expect(opens(sent)).toEqual([expect.objectContaining({ path: '/posts/hello-world/' })]);
  });

  it('names the note in the accessible name', async () => {
    await openEmbedded({ href: `${ORIGIN}/posts/hello-world` });
    expect((await moreActions()).getByRole('button', { name: /^Open on the page\s*This page$/ })).toBeDefined();
  });
});

describe('openOnPageNote', () => {
  const base = { dirty: false, here: '/', path: '/posts/a', draft: false };
  it.each([
    [{}, { disabled: false, note: undefined }],
    [
      { dirty: true, here: '/posts/a' },
      { disabled: true, note: 'Save first' },
    ],
    [{ here: '/posts/a/' }, { disabled: true, note: 'This page' }],
    [
      { here: '/posts/a', draft: true },
      { disabled: true, note: 'This page' },
    ],
    [{ draft: true }, { disabled: false, note: 'Draft' }],
    [{ here: null }, { disabled: false, note: undefined }],
    [
      { here: '/', path: '/' },
      { disabled: true, note: 'This page' },
    ],
    [
      { here: '/posts', path: '/' },
      { disabled: false, note: undefined },
    ],
  ])('%j → %j', (over, expected) => {
    expect(openOnPageNote({ ...base, ...over })).toEqual(expected);
  });
});

describe('Details: the Page row', () => {
  it("is the first row with the entry's URL", async () => {
    await openEmbedded({ url: '/posts/{slug}/' });
    await moreAction('Details');
    const details = await sheet('Details');
    const terms = details.getAllByRole('term').map((t) => t.textContent);
    expect(terms[0]).toBe('Page');
    expect(terms[1]).toBe('File');
    expect(details.getByText('/posts/hello-world/')).toBeDefined();
  });

  it('is not there without the collection url', async () => {
    await openEmbedded({ url: null });
    await moreAction('Details');
    const details = await sheet('Details');
    expect(details.queryByRole('term', { name: 'Page' })).toBeNull();
    expect(details.getAllByRole('term')[0]!.textContent).toBe('File');
  });
});

describe('Rename: the page URL', () => {
  const rename = async () => {
    await moreAction('Rename…');
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.change(dialog.getByLabelText('New slug'), { target: { value: 'hello-there' } });
    return dialog;
  };

  it('with {slug} in url: the description names the page URL and the plan shows its move', async () => {
    await openEmbedded();
    const dialog = await rename();
    expect(dialog.getByText(/^The slug is the file name and the page URL\./)).toBeDefined();
    const plan = dialog.getByRole('list', { name: 'Rename plan' });
    expect(within(plan).getByText('/posts/hello-world → /posts/hello-there')).toBeDefined();
  });

  it.each([[null], ['/blog']] as const)('url %s: the file name only, and no URL line', async (url) => {
    await openEmbedded({ url });
    const dialog = await rename();
    expect(dialog.getByText('The slug is the file name. Links to the entry by its slug stop working.')).toBeDefined();
    const plan = dialog.getByRole('list', { name: 'Rename plan' });
    expect(within(plan).queryByText(/^\/.* → \//)).toBeNull();
  });
});
