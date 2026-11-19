import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { pendingCopies, pendingNewEntries } from '../entry/pending';
import type { SourceChange } from '../source/local';
import {
  findCta,
  fixtureFiles,
  moreAction,
  moreActions,
  renderApp,
  reviewSheet,
  saveReview,
  setField,
} from '../test/render';

const PATH = 'cms/content/post/hello-world.md';

async function openPost() {
  const source = createMemorySource(fixtureFiles());
  const commit = vi.spyOn(source, 'commit');
  renderApp({ route: 'post/hello-world', source });
  await screen.findByRole('button', { name: /^Title/ });
  return { source, commit };
}

const changesOf = (commit: ReturnType<typeof vi.spyOn>) => (commit.mock.calls[0] as [SourceChange[], string])[0];

afterEach(() => {
  vi.restoreAllMocks();
  pendingNewEntries.clear();
  pendingCopies.clear();
  window.history.replaceState(null, '', '/');
});

describe('⋯ → Duplicate', () => {
  it('opens the copy as a new entry at <slug>-copy; Save writes it with the body and the images referenced', async () => {
    const { commit } = await openPost();
    await moreAction('Duplicate');
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello world (copy)' })).toBeTruthy();
    expect(window.location.href).toContain('post/hello-world-copy');
    expect(await screen.findByText('Duplicated')).toBeTruthy();
    fireEvent.click(await findCta('Save'));
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [change] = changesOf(commit);
    expect(change!.path).toBe('cms/content/post/hello-world-copy.md');
    expect(change!.content).toContain('title: Hello world (copy)');
    expect(change!.content).toContain('src: hello-world/cover.webp');
    expect(change!.content).toContain('Hello!');
    expect(change!.content).toContain('draft: true');
  });

  it('Undo goes back to the original and closes the toast', async () => {
    await openPost();
    await moreAction('Duplicate');
    await screen.findByRole('heading', { level: 1, name: 'Hello world (copy)' });
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Hello world' })).toBeTruthy();
    expect(window.location.href).not.toContain('hello-world-copy');
    await waitFor(() => expect(screen.queryByText('Duplicated')).toBeNull());
  });

  it('is off while the form has unsaved edits', async () => {
    await openPost();
    await setField('Title', 'Changed');
    const actions = await moreActions();
    expect((actions.getByRole('button', { name: /^Duplicate/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('⋯ → Set as draft', () => {
  it('is an unsaved edit of the draft flag; Save writes draft: true', async () => {
    const { commit } = await openPost();
    await moreAction('Set as draft');
    fireEvent.click(await findCta('Save 1 change'));
    expect((await reviewSheet()).getByText(/Draft/)).toBeTruthy();
    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const [change] = changesOf(commit);
    expect(change!.path).toBe(PATH);
    expect(change!.content).toContain('draft: true');
  });

  it('reads Set as published on a draft and toggles back to the saved file', async () => {
    await openPost();
    await moreAction('Set as draft');
    await findCta('Save 1 change');
    await act(async () => {});
    await moreAction('Set as published');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull());
  });
});
