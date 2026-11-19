import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { fixtureFiles, renderApp } from '../test/render';

// The missing alt queue (media/AltQueue.tsx) over a local memory source. Four images have a blank alt, in grid (path)
// order: one/a.png, one/b.png and one/c.png (three images in the body of `one`) and
// two/e.png (the body of `two`; `one` uses it too, with an alt that must stay). `two` also has d.png, with an alt.

const ONE = 'cms/content/post/one.md';
const TWO = 'cms/content/post/two.md';
const PNG = new Uint8Array([1, 2, 3]);

function files(): Record<string, string | Uint8Array> {
  return {
    ...fixtureFiles(),
    [ONE]:
      '---\ntitle: One\n---\nStart ![](one/a.png) first ![](one/b.png) then ![](one/c.png) and ![kept](two/e.png)\n',
    [TWO]: '---\ntitle: Two\nfeaturedImage:\n  src: two/d.png\n  alt: Has alt\n---\nLook ![](two/e.png)\n',
    'cms/content/post/one/a.png': PNG,
    'cms/content/post/one/b.png': PNG,
    'cms/content/post/one/c.png': PNG,
    'cms/content/post/two/d.png': PNG,
    'cms/content/post/two/e.png': PNG,
  };
}

const main = () => screen.getByRole('main');
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

async function openMedia(opts: { win?: Window } = {}) {
  const source = createMemorySource(files());
  const commit = vi.spyOn(source, 'commit');
  renderApp({ route: 'media', source, win: opts.win });
  await within(main()).findByRole('heading', { name: 'Media' });
  await within(main()).findByTitle('cms/content/post/one/a.png');
  // The usage index is read entry by entry: wait for the blank alt texts to be counted.
  await within(main()).findByRole('button', { name: /^Missing alt\s*4$/ });
  return { source, commit };
}

/** ⋯ → Add missing alt text: the queue from any chip. */
async function startFromMore() {
  fireEvent.click(within(main()).getByRole('button', { name: 'More actions' }));
  const actions = within(await screen.findByRole('dialog'));
  fireEvent.click(actions.getByRole('button', { name: 'Add missing alt text' }));
  return queue();
}

const open = () => screen.queryAllByRole('dialog').filter((d) => d.getAttribute('aria-modal') !== 'false');
async function queue() {
  const all = await screen.findAllByRole('dialog', { name: 'Missing alt' });
  return within(all.at(-1)!);
}
const field = (q: ReturnType<typeof within>) => q.getByRole('textbox', { name: /^Alt text for / }) as HTMLInputElement;
const cta = (q: ReturnType<typeof within>) =>
  q.getByRole('button', { name: /^Save & (next|finish)$/ }) as HTMLButtonElement;
const status = (q: ReturnType<typeof within>) => q.getByRole('status');
const type = (q: ReturnType<typeof within>, text: string) => fireEvent.change(field(q), { target: { value: text } });

/** Types `text` and presses Save; waits for the next image (or the end). */
async function saveAs(q: ReturnType<typeof within>, text: string, after: string | RegExp) {
  type(q, text);
  fireEvent.click(cta(q));
  await q.findByText(after, undefined, { timeout: 5000 });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('the queue and its order', () => {
  it('starts from the Missing alt chip, in grid order, with the picture, the uses and the progress', async () => {
    await openMedia();
    fireEvent.click(within(main()).getByRole('button', { name: /^Missing alt\s*4$/ }));
    const start = within(main()).getByRole('button', { name: 'Add alt text to 4 images' });
    expect(start.textContent).toBe('Add alt text');
    fireEvent.click(start);
    const q = await queue();
    expect(q.getByText('1 of 4')).toBeDefined();
    expect(q.getByText('a.png')).toBeDefined();
    expect(q.getByText('Post · Body · one')).toBeDefined();
    expect(q.getByText('Describe the image for people who cannot see it.')).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(field(q)));
    expect(cta(q).textContent).toBe('Save & next');
    expect(q.getByRole('button', { name: 'Open image' })).toBeDefined();
  });

  it('takes the images that match the search, and the button counts them', async () => {
    await openMedia();
    fireEvent.click(within(main()).getByRole('button', { name: /^Missing alt\s*4$/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Search images' }));
    fireEvent.change(within(main()).getByRole('searchbox', { name: 'Search images' }), { target: { value: 'two/' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Add alt text to 1 image' }));
    const q = await queue();
    // two/d.png has an alt, two/e.png has a blank one.
    expect(q.getByText('1 of 1')).toBeDefined();
    expect(q.getByText('e.png')).toBeDefined();
    expect(cta(q).textContent).toBe('Save & finish');
  });

  it('is offered by ⋯ from the All chip, which is the swap back to Upload', async () => {
    await openMedia();
    expect(within(main()).getByRole('button', { name: 'Upload' })).toBeDefined();
    expect(within(main()).queryByRole('button', { name: /^Add alt text/ })).toBeNull();
    const q = await startFromMore();
    expect(q.getByText('1 of 4')).toBeDefined();
  });

  it('shows the uses without alt: the first two and the rest as a count', async () => {
    const source = createMemorySource({
      ...files(),
      'cms/content/post/three.md': '---\ntitle: Three\n---\n![](two/e.png) ![](two/e.png)\n',
    });
    renderApp({ route: 'media', source });
    await within(main()).findByRole('button', { name: /^Missing alt\s*4$/ });
    const q = await startFromMore();
    // Walk to e.png: three uses without alt (two, and two in three), the first two are named.
    for (const _ of [1, 2, 3]) fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    await q.findByText('4 of 4');
    expect(q.getByText('+1 more places')).toBeDefined();
  });
});

describe('saving', () => {
  it('disables Save while the field is blank, and Enter saves', async () => {
    const { commit } = await openMedia();
    const q = await startFromMore();
    expect(cta(q).disabled).toBe(true);
    type(q, '   ');
    expect(cta(q).disabled).toBe(true);
    type(q, 'A blue bike');
    expect(cta(q).disabled).toBe(false);
    fireEvent.keyDown(field(q), { key: 'Enter' });
    await q.findByText('2 of 4');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(field(q).value).toBe('');
    expect(field(q)).toBe(document.activeElement);
    expect(status(q).textContent).toBe('Saved. 2 of 4: b.png');
  });

  it('commits once per image, with only that image’s blank uses changed', async () => {
    const { source, commit } = await openMedia();
    const q = await startFromMore();
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    await q.findByText('4 of 4');
    await saveAs(q, 'A gravel road', 'All done');
    expect(commit).toHaveBeenCalledTimes(1);
    const [changes, message] = commit.mock.calls[0]!;
    // e.png is used in one (alt "kept") and two (blank): only two is rewritten.
    expect(changes.map((c) => c.path)).toEqual([TWO]);
    expect(message).toBe('Update post/two');
    expect(decode(await source.readFile(TWO))).toContain('![A gravel road](two/e.png)');
    expect(decode(await source.readFile(ONE))).toContain('![kept](two/e.png)');
  });

  it('reads the entries again for each image: three images in one body keep the right text', async () => {
    const { source, commit } = await openMedia();
    const q = await startFromMore();
    await saveAs(q, 'Alpha', '2 of 4');
    await saveAs(q, 'Bravo', '3 of 4');
    await saveAs(q, 'Charlie', '4 of 4');
    expect(commit).toHaveBeenCalledTimes(3);
    for (const [changes] of commit.mock.calls) expect(changes.map((c) => c.path)).toEqual([ONE]);
    const one = decode(await source.readFile(ONE));
    expect(one).toContain('![Alpha](one/a.png)');
    expect(one).toContain('![Bravo](one/b.png)');
    expect(one).toContain('![Charlie](one/c.png)');
    expect(one).toContain('![kept](two/e.png)');
  });

  it('does not shrink after a commit: the queue keeps its snapshot of four', async () => {
    await openMedia();
    const q = await startFromMore();
    await saveAs(q, 'Alpha', '2 of 4');
    // The grid under the sheet has three images without alt now; the queue still counts four.
    expect(await within(main()).findByRole('button', { name: /^Missing alt\s*3$/, hidden: true })).toBeDefined();
    expect(q.getByText('2 of 4')).toBeDefined();
  });

  it('skips an image that was fixed meanwhile: no request, *Already has alt text*', async () => {
    const { source, commit } = await openMedia();
    const q = await startFromMore();
    // Someone gives a.png its alt while the queue is open.
    await source.commit(
      [{ path: ONE, content: decode(await source.readFile(ONE)).replace('![](one/a.png)', '![Fixed](one/a.png)') }],
      'elsewhere',
    );
    commit.mockClear();
    type(q, 'Too late');
    fireEvent.click(cta(q));
    await q.findByText('2 of 4');
    expect(commit).not.toHaveBeenCalled();
    expect(status(q).textContent).toBe('Already has alt text. 2 of 4: b.png');
    expect(decode(await source.readFile(ONE))).toContain('![Fixed](one/a.png)');
  });

  it('keeps the image and the typed text when a commit fails, and Save retries', async () => {
    const { commit } = await openMedia();
    const q = await startFromMore();
    commit.mockRejectedValueOnce(new Error('The disk is full'));
    type(q, 'Alpha');
    fireEvent.click(cta(q));
    expect((await q.findByRole('alert')).textContent).toContain('The disk is full');
    expect(q.getByText('1 of 4')).toBeDefined();
    expect(field(q).value).toBe('Alpha');
    fireEvent.click(cta(q));
    await q.findByText('2 of 4');
    expect(q.queryByRole('alert')).toBeNull();
  });
});

describe('while a commit runs', () => {
  it('does not close, and Open image and Skip are off, until it ends', async () => {
    const { source, commit } = await openMedia();
    const q = await startFromMore();
    let finish: () => void = () => {};
    const real = source.commit.bind(source);
    commit.mockImplementationOnce(
      (changes, message) =>
        new Promise((resolve) => {
          finish = () => resolve(real(changes, message));
        }),
    );
    type(q, 'Alpha');
    fireEvent.click(cta(q));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    expect((q.getByRole('button', { name: 'Open image' }) as HTMLButtonElement).disabled).toBe(true);
    expect((q.getByRole('button', { name: 'Skip' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(q.getByRole('button', { name: 'Close' }));
    expect(open()).toHaveLength(1);
    await act(async () => finish());
    await q.findByText('2 of 4');
    fireEvent.click(q.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(open()).toHaveLength(0));
  });
});

describe('skipping and the end', () => {
  it('Skip makes no commit; the summary counts, and Go through skipped walks them again', async () => {
    const { commit } = await openMedia();
    const q = await startFromMore();
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    expect(status(q).textContent).toBe('Skipped. 2 of 4: b.png');
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    expect(commit).not.toHaveBeenCalled();
    await saveAs(q, 'Charlie', '4 of 4');
    expect(cta(q).textContent).toBe('Save & finish');
    await saveAs(q, 'Echo', 'All done');
    expect(q.getByText('2 alt texts saved · 2 skipped')).toBeDefined();
    expect(commit).toHaveBeenCalledTimes(2);

    fireEvent.click(q.getByRole('button', { name: 'Go through 2 skipped' }));
    expect(q.getByText('1 of 2')).toBeDefined();
    expect(q.getByText('a.png')).toBeDefined();
    await saveAs(q, 'Alpha', '2 of 2');
    await saveAs(q, 'Bravo', 'All done');
    expect(q.getByText('4 alt texts saved')).toBeDefined();
    expect(q.queryByRole('button', { name: /^Go through/ })).toBeNull();
    fireEvent.click(q.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(open()).toHaveLength(0));
  });

  it('with nothing saved and everything skipped twice, the same summary shows', async () => {
    const { commit } = await openMedia();
    const q = await startFromMore();
    for (let i = 0; i < 4; i++) fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    await q.findByText('All done');
    expect(q.getByText('0 alt texts saved · 4 skipped')).toBeDefined();
    fireEvent.click(q.getByRole('button', { name: 'Go through 4 skipped' }));
    for (let i = 0; i < 4; i++) fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    await q.findByText('All done');
    expect(commit).not.toHaveBeenCalled();
  });

  it('Open image ends the queue and opens the image’s own page', async () => {
    await openMedia();
    const q = await startFromMore();
    fireEvent.click(q.getByRole('button', { name: 'Open image' }));
    await waitFor(() => expect(open()).toHaveLength(0));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'a.png' })).toBeDefined();
  });
});

describe('refreshing the site', () => {
  const refreshes = (sent: () => { type: string }[]) => sent().filter((m) => m.type === 'refresh').length;
  async function embedded() {
    const fake = createFakeWindow();
    const sent = () => fake.parent.postMessage.mock.calls.map(([m]) => m as { type: string });
    const utils = await openMedia({ win: fake.win });
    act(() => fake.fromSite({ type: 'init', route: 'media', site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
    return { ...utils, sent };
  }

  it('sends no refresh per image, and one when the queue closes after a save', async () => {
    const { sent } = await embedded();
    const q = await startFromMore();
    await saveAs(q, 'Alpha', '2 of 4');
    await saveAs(q, 'Bravo', '3 of 4');
    expect(refreshes(sent)).toBe(0);
    fireEvent.click(q.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(open()).toHaveLength(0));
    expect(refreshes(sent)).toBe(1);
  });

  it('sends none when only skips were made', async () => {
    const { sent } = await embedded();
    const q = await startFromMore();
    fireEvent.click(q.getByRole('button', { name: 'Skip' }));
    fireEvent.click(q.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(open()).toHaveLength(0));
    expect(refreshes(sent)).toBe(0);
  });
});
