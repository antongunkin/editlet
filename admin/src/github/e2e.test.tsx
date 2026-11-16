import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startLogin, type AuthSession } from '../../../auth/client';
import type { AdminConfig } from '../../config';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { entryActions } from '../test/render';

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
    const chip = await screen.findByRole('button', { name: 'Branch' });
    await waitFor(() => expect(chip.textContent).toBe('main · live'));
    expect(screen.queryByRole('link', { name: 'Review changes' })).toBeNull();

    // Open post/hello-world and edit its title.
    fireEvent.click(await within(main()).findByRole('link', { name: 'Post (1)' }));
    // The fixture's post collection has no titleField: the row is titled by its slug.
    fireEvent.click(await within(main()).findByRole('link', { name: 'hello-world' }));
    const title = (await within(main()).findByLabelText(/^Title/)) as HTMLInputElement;
    expect(title.value).toBe('Hello world');
    fireEvent.change(title, { target: { value: 'Hello from GitHub' } });
    fireEvent.click(entryActions().getByRole('button', { name: 'Save' }));

    // Save on main → New branch.
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save to branch' })));
    await waitFor(() => expect(chip.textContent).toContain('editlet/post-hello-world'));
    expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toContain('title: Hello from GitHub');
    expect(fileAt(fake, 'main', ENTRY)).toContain('title: Hello world');

    // Review changes → the Title row of the diff.
    fireEvent.click(await screen.findByRole('link', { name: 'Review changes' }));
    const file = await within(main()).findByRole('region', { name: ENTRY });
    const row = within(file).getByRole('region', { name: 'Title' });
    expect(within(row).getByText('Hello world')).toBeDefined();
    expect(within(row).getByText('Hello from GitHub')).toBeDefined();
    expect(within(main()).queryByRole('button', { name: 'Publish' })).toBeNull();

    // Create pull request → the link to it; main is untouched.
    const create = (await within(main()).findByRole('button', { name: 'Create pull request' })) as HTMLButtonElement;
    await waitFor(() => expect(create.disabled).toBe(false));
    await act(async () => fireEvent.click(create));
    const link = await within(main()).findByRole('link', { name: 'Pull request #1' });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/1');
    expect(within(main()).getByText('A developer merges it on GitHub.')).toBeDefined();

    expect(fake.state.pulls).toEqual([
      expect.objectContaining({ head: 'editlet/post-hello-world', base: 'main', state: 'open' }),
    ]);
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect(fileAt(fake, 'main', ENTRY)).toContain('title: Hello world');
    expect(fake.state.refs.has('editlet/post-hello-world')).toBe(true);
    expect(chip.textContent).toContain('editlet/post-hello-world');

    // The admin never merges: no REST merge, no GraphQL merge or auto-merge.
    expect(
      fake.calls.filter((c) => c.method === 'PUT' && /\/pulls\/\d+\/merge$/.test(new URL(c.url).pathname)),
    ).toEqual([]);
    expect(bodies.filter((b) => /mergePullRequest|enablePullRequestAutoMerge/.test(b))).toEqual([]);
    expect(fake.calls.filter((c) => c.operation && /merge/i.test(c.operation))).toEqual([]);
  });
});
