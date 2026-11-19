import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource, type ContentSource, type FileVersion } from '../../../core/source';
import { findCta, fixtureFiles, renderApp, rowText, saveReview, setField, sheet } from '../test/render';

// Conflict · compare in dev mode (spec 2026-11-19-admin-conflict-compare.md): the file changed on disk under edits.

const ENTRY = 'cms/content/post/hello-world.md';

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Conflict · compare (dev)', () => {
  it('the file changed on disk under an edit: compare, keep yours on the newer file, save', async () => {
    const source = createMemorySource(fixtureFiles());
    const commit = vi.spyOn(source, 'commit');
    const { queryClient } = renderApp({ route: 'post/hello-world', source });
    await screen.findByRole('button', { name: /^Title/ });
    await setField('Title', 'Mine');
    const file = fixtureFiles()[ENTRY] as string;
    const theirs = file.replace('title: Hello world', 'title: Theirs').replace('Hello!', 'Their body.');
    await source.commit([{ path: ENTRY, content: theirs }], 'External edit');
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));

    const main = within(screen.getByRole('main'));
    expect(await main.findByText('This file changed on disk. Your edits are kept.')).toBeDefined();
    fireEvent.click(await findCta('Compare changes'));
    const compare = await sheet('Compare changes');
    expect(compare.getByText('2 fields changed on disk')).toBeDefined();
    const title = within(compare.getByRole('radiogroup', { name: 'Title' }));
    expect(title.getByRole('radio', { name: 'Yours: Mine' }).getAttribute('aria-checked')).toBe('true');
    expect(title.getByRole('radio', { name: 'On disk: Theirs' })).toBeDefined();
    // The body changed on disk only: the newer one is chosen by default.
    const body = within(compare.getByRole('radiogroup', { name: 'Body' }));
    expect(body.getByRole('radio', { name: /^On disk: Their body\./ }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(compare.getByRole('button', { name: 'Apply 2 choices' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compare changes' })).toBeNull());
    expect(main.queryByText('This file changed on disk. Your edits are kept.')).toBeNull();
    expect(rowText('Title')).toContain('Mine');
    fireEvent.click(await findCta('Save 1 change'));
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
    const [changes] = commit.mock.calls[1]!;
    expect(String(changes[0]!.content)).toContain('title: Mine');
    expect(String(changes[0]!.content)).toContain('Their body.');
  });

  /** The memory source has no history: this one answers `listVersions` with one commit, whose file is `sha()`. */
  function withHistory(source: ContentSource, sha: () => Promise<string>): ContentSource {
    return Object.assign(Object.create(source) as ContentSource, {
      listVersions: vi.fn(async (): Promise<FileVersion[]> => [
        {
          commit: 'c'.repeat(40),
          sha: await sha(),
          actor: { name: 'Mo Rivera' },
          date: new Date(Date.now() - 10 * 60_000).toISOString(),
          message: 'External edit',
        },
      ]),
    });
  }

  async function compareTitleRadios(source: ContentSource) {
    const { queryClient } = renderApp({ route: 'post/hello-world', source });
    await screen.findByRole('button', { name: /^Title/ });
    await setField('Title', 'Mine');
    const file = fixtureFiles()[ENTRY] as string;
    await source.commit(
      [{ path: ENTRY, content: file.replace('title: Hello world', 'title: Theirs') }],
      'External edit',
    );
    await act(() => queryClient.invalidateQueries({ queryKey: ['files'] }));
    fireEvent.click(await findCta('Compare changes'));
    const compare = await sheet('Compare changes');
    // The label would be drawn once the history read has been answered: wait for it, then let the answer settle.
    await waitFor(() => expect(vi.mocked(source.listVersions!)).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return within(compare.getByRole('radiogroup', { name: 'Title' }));
  }

  it('the newer side says who saved it and when, when the source has history and its latest file is the one read', async () => {
    const base = createMemorySource(fixtureFiles());
    const source = withHistory(base, async () => (await base.listFiles()).find((f) => f.path === ENTRY)!.sha);
    const title = await compareTitleRadios(source);
    expect(title.getByRole('radio', { name: 'On disk · Mo R, 10m ago: Theirs' })).toBeDefined();
  });

  it('keeps the plain side name when the latest commit’s file is another one', async () => {
    const source = withHistory(createMemorySource(fixtureFiles()), async () => 'f'.repeat(40));
    const title = await compareTitleRadios(source);
    expect(title.getByRole('radio', { name: 'On disk: Theirs' })).toBeDefined();
  });

  it('keeps the plain side name when the history read fails', async () => {
    const source = Object.assign(Object.create(createMemorySource(fixtureFiles())) as ContentSource, {
      listVersions: vi.fn(async () => {
        throw new Error('no git');
      }),
    });
    const title = await compareTitleRadios(source);
    expect(title.getByRole('radio', { name: 'On disk: Theirs' })).toBeDefined();
  });
});
