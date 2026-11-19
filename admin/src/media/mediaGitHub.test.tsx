import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

// The Media screen on the live site: commits go to an Editlet branch, never to the base branch.

const main = () => screen.getByRole('main');
const COVER = 'cms/content/post/hello-world/cover.webp';
const UPLOAD = 'cms/content/media/new.png';

const has = (fake: AdminFakeGitHub, branch: string, path: string) =>
  fake.state.commits.get(fake.state.refs.get(branch)!)!.files.has(path);

/** Opens `?editlet=media`; `wrap` changes the site's fetch (made after the route is set: config.json is next to it). */
async function openMedia(fake: AdminFakeGitHub, branch?: string, wrap = (f: typeof fetch) => f) {
  if (branch) window.localStorage.setItem(activeBranchKey('o', 'r'), branch);
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'media'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(wrap(siteFetch(LIVE_CONFIG, fake)));
  await screen.findByTitle(COVER);
}

const upload = () =>
  fireEvent.change(screen.getByTestId('media-upload-file'), {
    target: { files: [new File([new Uint8Array([1, 2])], 'new.png')] },
  });

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

const failing = (base: typeof fetch) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    if (body.includes('createCommitOnBranch')) throw new TypeError('Failed to fetch');
    return base(input, init);
  }) as typeof fetch;

describe('Media on GitHub', () => {
  it('asks for a new branch on the base branch and commits the upload there', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main');
    await openMedia(fake);
    upload();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Upload new.png' })).toBeDefined();
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('media'));
    const commit = within(dialog).getByRole('button', { name: 'Commit on branch' });
    await waitFor(() => expect(commit).toHaveProperty('disabled', false));

    fireEvent.change(field, { target: { value: 'bad name!' } });
    expect(await within(dialog).findByText('Use letters, digits and dashes')).toBeDefined();
    expect(commit).toHaveProperty('disabled', true);
    fireEvent.change(field, { target: { value: 'spring-images' } });

    await act(async () => fireEvent.click(commit));
    await waitFor(() => expect(fake.state.refs.has('editlet/spring-images')).toBe(true));
    await waitFor(() => expect(has(fake, 'editlet/spring-images', UPLOAD)).toBe(true));
    expect(fake.state.refs.get('main')).toBe(mainHead);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('button', { name: /^Branch / })).toHaveProperty(
      'textContent',
      'editlet/spring-images',
    );
  });

  it('commits straight to the active Editlet branch', async () => {
    const fake = createAdminFakeGitHub();
    fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
    await openMedia(fake, 'editlet/a');
    upload();
    await waitFor(() => expect(has(fake, 'editlet/a', UPLOAD)).toBe(true));
    expect(has(fake, 'main', UPLOAD)).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the dialog open with a new suggestion when the branch name was taken meanwhile', async () => {
    const fake = createAdminFakeGitHub();
    await openMedia(fake);
    upload();
    const dialog = await screen.findByRole('dialog');
    const commit = within(dialog).getByRole('button', { name: 'Commit on branch' });
    await waitFor(() => expect(commit).toHaveProperty('disabled', false));
    // Someone else creates the suggested branch after the listing was read.
    fake.state.refs.set('editlet/media', fake.state.refs.get('main')!);
    await act(async () => fireEvent.click(commit));
    // The listing is read again and the suggestion moves on to a free name; nothing was committed.
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('media-2'));
    expect(has(fake, 'editlet/media', UPLOAD)).toBe(false);
    expect(within(main()).queryByRole('alert')).toBeNull();
  });

  it('says GitHub cannot be reached when a commit fails on the network', async () => {
    const fake = createAdminFakeGitHub();
    fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
    await openMedia(fake, 'editlet/a', failing);
    upload();
    expect((await within(main()).findByRole('alert')).textContent).toContain("Can't reach GitHub");
  });
});
