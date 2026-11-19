import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startLogin, type AuthSession } from '../../../auth/client';
import type { AdminConfig } from '../../config';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import {
  closeSheets,
  findCta,
  openCollection,
  openSaveTo,
  reviewSheet,
  rowText,
  setField,
  sheet,
} from '../test/render';

vi.mock('../../../auth/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../auth/client')>();
  return { ...actual, startLogin: vi.fn() };
});

const login = vi.mocked(startLogin);
const CONFIG: AdminConfig = { ...LIVE_CONFIG, authUrl: 'https://auth.test' };
const ENTRY = 'cms/content/post/hello-world.md';

const session: AuthSession = {
  accessToken: 'gho_e2e',
  tokenType: 'bearer',
  expiresAt: null,
  refreshToken: null,
  refreshTokenExpiresAt: null,
};

const main = () => screen.getByRole('main');

/** The text of `path` at the head of `branch`. */
function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path)!;
  return new TextDecoder().decode(fake.state.blobs.get(sha));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/editlet/');
  login.mockReset();
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

/** `fake` whose every request body is kept, to check what the admin never sends. */
function recording(fake: AdminFakeGitHub): { github: AdminFakeGitHub; bodies: string[] } {
  const bodies: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof init?.body === 'string') bodies.push(init.body);
    return fake.fetch(input, init);
  }) as typeof fetch;
  return { github: { ...fake, fetch: fetchFn }, bodies };
}

/** The branch chip is the window's on Home and the entry screen's own on the entry: look it up each time. */
const branchChip = () => screen.getByRole('button', { name: /^Branch / });

describe('GitHub mode end to end', () => {
  it('signs in, saves an edit on main to a new branch, reviews it and creates its pull request', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main');
    const { github, bodies } = recording(fake);
    login.mockResolvedValue(session);
    renderLiveApp(siteFetch(CONFIG, github));

    // Sign in → Home on main.
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with GitHub' }));
    expect(login).toHaveBeenCalledWith({ workerUrl: 'https://auth.test/' });
    await screen.findByRole('button', { name: /^Branch / });
    await waitFor(() => expect(branchChip().textContent).toBe('main live'));
    expect(screen.queryByRole('link', { name: 'Review changes' })).toBeNull();

    // Open post/hello-world and edit its title.
    await openCollection(within(main()), 'Post');
    // The fixture's post collection has no titleField: the row is titled by its slug.
    fireEvent.click(await within(main()).findByRole('button', { name: /^hello-world/ }));
    await within(main()).findByRole('button', { name: /^Title/ });
    expect(rowText('Title')).toContain('Hello world');
    await setField('Title', 'Hello from GitHub');
    fireEvent.click(await findCta('Save 1 change'));

    // Save on main → Your changes → Save to, with the suggested new branch.
    await reviewSheet();
    const saveTo = await openSaveTo();
    const field = saveTo.getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    await act(async () => fireEvent.click(saveTo.getByRole('button', { name: 'Save to new branch' })));
    await waitFor(() => expect(branchChip().textContent).toContain('editlet/post-hello-world'));
    expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toContain('title: Hello from GitHub');
    expect(fileAt(fake, 'main', ENTRY)).toContain('title: Hello world');

    // Review changes → the branch screen; its Changes sheet has the Title row of the diff.
    // It is the entry's CTA now that the form is clean on a branch; the form remounts once on the saved file.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('link', { name: 'Review changes' }));
      expect(new URLSearchParams(window.location.search).get('editlet')).toMatch(/^branch:/);
    });
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Review changes' })).toBeDefined();
    fireEvent.click(await within(main()).findByRole('button', { name: /^Changes/ }));
    const changes = await sheet('Changes');
    const row = within(changes.getByRole('region', { name: ENTRY })).getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello from GitHub')).toBeDefined();
    await closeSheets();
    expect(within(main()).queryByRole('button', { name: 'Publish' })).toBeNull();

    // Create pull request → the link to it; main is untouched.
    const create = (await within(main()).findByRole('button', { name: 'Create pull request' })) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    await act(async () => fireEvent.click(create));
    const link = await within(main()).findByRole('link', { name: /^Open pull request/ });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/1');
    expect(within(main()).getByRole('heading', { level: 1, name: 'Pull request #1' })).toBeDefined();
    expect(within(main()).getByText('A developer merges it into main on GitHub')).toBeDefined();

    expect(fake.state.pulls).toEqual([
      expect.objectContaining({ head: 'editlet/post-hello-world', base: 'main', state: 'open' }),
    ]);
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect(fileAt(fake, 'main', ENTRY)).toContain('title: Hello world');
    expect(fake.state.refs.has('editlet/post-hello-world')).toBe(true);
    expect(branchChip().textContent).toContain('editlet/post-hello-world');

    // The admin never merges: no REST merge, no GraphQL merge or auto-merge.
    expect(
      fake.calls.filter((c) => c.method === 'PUT' && /\/pulls\/\d+\/merge$/.test(new URL(c.url).pathname)),
    ).toEqual([]);
    expect(bodies.filter((b) => /mergePullRequest|enablePullRequestAutoMerge/.test(b))).toEqual([]);
    expect(fake.calls.filter((c) => c.operation && /merge/i.test(c.operation))).toEqual([]);
  });
});
