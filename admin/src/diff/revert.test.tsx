import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import {
  closeSheet,
  findCta,
  openEntryDiff,
  renderApp,
  reviewSheet,
  rowText,
  saveReview,
  setField,
  sheet,
} from '../test/render';

// The changes tray (spec 2026-11-19-admin-changes-tray.md): Revert this change per field, and the commit's Note.

async function openPost() {
  const source = createMemorySource(fixtureFiles());
  const commit = vi.spyOn(source, 'commit');
  renderApp({ route: 'post/hello-world', source });
  await screen.findByRole('button', { name: /^Title/ });
  return { commit };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Revert this change', () => {
  it('puts one field back; the counts follow, and the other change is saved alone', async () => {
    const { commit } = await openPost();
    await setField('Title', 'Hello there');
    await setField('Body', 'A new body.');
    fireEvent.click(await findCta('Save 2 changes'));
    const review = await reviewSheet();
    expect(review.getByRole('heading', { name: '1 entry, 2 fields' })).toBeDefined();

    const diff = await openEntryDiff('Hello there');
    fireEvent.click(within(diff.getByRole('region', { name: 'Title' })).getByRole('button', { name: /Revert/ }));
    await waitFor(() => expect(diff.queryByRole('region', { name: 'Title' })).toBeNull());
    expect(diff.getByRole('region', { name: 'Body' })).toBeDefined();
    // Under the open diff, the list and the entry are hidden from assistive technology.
    expect(review.getByRole('heading', { name: '1 entry, 1 field', hidden: true })).toBeDefined();
    await closeSheet();

    await saveReview();
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1));
    const [changes] = commit.mock.calls[0]!;
    expect(String(changes[0]!.content)).toContain('title: Hello world');
    expect(String(changes[0]!.content)).toContain('A new body.');
    await waitFor(() => expect(rowText('Title')).toBe(rowText('Title').replace('Changed', '')));
  });

  it('the last revert closes Your changes: the entry is clean', async () => {
    await openPost();
    await setField('Title', 'Hello there');
    fireEvent.click(await findCta('Save 1 change'));
    const diff = await openEntryDiff('Hello there');
    fireEvent.click(diff.getByRole('button', { name: 'Revert this change: Title' }));
    // The last revert empties the buffer (written at once while the tray is open) and the tray closes.
    await waitFor(() => expect(rowText('Title')).toContain('Hello world'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull());
  });

  it('dev mode has no Note row', async () => {
    await openPost();
    await setField('Title', 'Hello there');
    fireEvent.click(await findCta('Save 1 change'));
    const review = await reviewSheet();
    expect(review.queryByRole('button', { name: /^Note/ })).toBeNull();
  });
});

describe('Note', () => {
  it('goes into the commit message between the subject and the trailer', async () => {
    const github = createAdminFakeGitHub();
    github.state.refs.set('editlet/a', github.state.refs.get('main')!);
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');
    window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post/hello-world'));
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, github));
    const main = await screen.findByRole('main');
    await within(main).findByRole('button', { name: /^Title/ });
    await setField('Title', 'Hello there');
    fireEvent.click(await findCta('Save 1 change'));

    const review = await reviewSheet();
    fireEvent.click(review.getByRole('button', { name: /^Note\s*Add a note \(optional\)/ }));
    const note = await sheet('Note');
    fireEvent.change(note.getByRole('textbox', { name: 'Note' }), {
      target: { value: 'Shorter title.\nAsked by Mo.' },
    });
    fireEvent.click(note.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(review.getByRole('button', { name: /^Note\s*Shorter title\.$/ })).toBeDefined());

    await act(async () => saveReview());
    const head = () => github.state.commits.get(github.state.refs.get('editlet/a')!)!;
    await waitFor(() => expect(head().message).toContain('Shorter title.'));
    expect(head().message).toBe('Update post/hello-world\n\nShorter title.\nAsked by Mo.\n\nEditlet-Source: admin');
  });
});
