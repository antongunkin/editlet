// The shared branch diff over the GitHub fake: Home's count, the branch preview and the pull request body refresh read
// one compare per head, so a save costs one compare.
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { findCta, saveReview, setField } from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';

function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path)!;
  return new TextDecoder().decode(fake.state.blobs.get(sha));
}

/** `main` plus `editlet/a` (one edit) with an open pull request. */
function fakeWithPullRequest(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
  fake.commit('editlet/a', { [ENTRY]: fileAt(fake, 'main', ENTRY).replace('title: Hello world', 'title: On A') });
  fake.state.pulls.push({
    number: 3,
    title: 'A',
    body: '',
    draft: false,
    head: 'editlet/a',
    base: 'main',
    state: 'open',
  });
  return fake;
}

const compares = (fake: AdminFakeGitHub) => fake.calls.filter((c) => new URL(c.url).pathname.includes('/compare/'));

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('one branch diff per head', () => {
  it('a save on a branch with an open pull request runs one compare', async () => {
    const fake = fakeWithPullRequest();
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/a');
    window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post/hello-world'));
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, fake));
    await screen.findByRole('button', { name: /^Title/ });
    // The preview layer read the branch on load: one compare for this head.
    await waitFor(() => expect(compares(fake)).toHaveLength(1));

    await setField('Title', 'On B');
    fireEvent.click(await findCta(/^Save/));
    await saveReview();
    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: On B'));
    // The pull request body refresh and the preview's new head share the new head's compare.
    await waitFor(() => expect(fake.state.pulls[0]!.body).toContain('editlet:'));
    await new Promise((r) => setTimeout(r, 200));
    expect(compares(fake)).toHaveLength(2);
  });
});
