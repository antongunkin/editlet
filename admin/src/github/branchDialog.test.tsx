import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSession, tokenSession, writeSession } from './session';
import { activeBranchKey } from './workspace';

import { withEditletRoute } from '../../../loader/protocol';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

const SPRING_POST = 'cms/content/post/spring.md';

/** `main` plus `editlet/spring` (one more post, open PR #1). */
function seededFake(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/spring', fake.state.refs.get('main')!);
  fake.commit('editlet/spring', { [SPRING_POST]: '---\ntitle: Spring\n---\n' });
  fake.state.pulls.push({
    number: 1,
    title: 'Spring',
    body: '',
    draft: false,
    head: 'editlet/spring',
    base: 'main',
    state: 'open',
  });
  return fake;
}

/** Routes every GitHub request with a string body (GraphQL) through `intercept`, which may call `pass()` (the fake). */
function withIntercept(
  fake: AdminFakeGitHub,
  intercept: (body: string, pass: () => Promise<Response>) => Promise<Response>,
): AdminFakeGitHub {
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const pass = () => fake.fetch(input, init);
    return typeof init?.body === 'string' ? intercept(init.body, pass) : pass();
  }) as typeof fetch;
  return { ...fake, fetch: fetchFn };
}

const reviewRoute = (link: HTMLElement) => new URL(link.getAttribute('href')!).searchParams.get('editlet');

async function openApp(fake = seededFake(), route = '') {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  const chip = await screen.findByRole('button', { name: 'Branch' });
  return { fake, chip };
}

const main = () => screen.getByRole('main');

async function openDialog(chip: HTMLElement) {
  fireEvent.click(chip);
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('button', { name: /^editlet\/spring/ });
  return dialog;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('branch chip and picker', () => {
  it('shows the base branch as live, the login and no Review changes link', async () => {
    const { chip } = await openApp();
    expect(chip.textContent).toBe('main · live');
    expect(screen.getByText('octocat')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Review changes' })).toBeNull();
  });

  it('lists the base branch first, then editlet/* branches with their pull request state', async () => {
    const fake = seededFake();
    fake.state.refs.set('editlet/draft', fake.state.refs.get('main')!);
    fake.state.pulls.push({
      number: 2,
      title: 'D',
      body: '',
      draft: true,
      head: 'editlet/draft',
      base: 'main',
      state: 'open',
    });
    fake.state.refs.set('editlet/plain', fake.state.refs.get('main')!);
    const { chip } = await openApp(fake);
    const dialog = await openDialog(chip);

    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      expect.stringContaining('main'),
      expect.stringContaining('editlet/draft'),
      expect.stringContaining('editlet/plain'),
      expect.stringContaining('editlet/spring'),
    ]);
    expect(within(rows[0]!).getByText('Live site · edits here start a new branch')).toBeDefined();
    expect(within(rows[0]!).getByRole('button').getAttribute('aria-current')).toBe('true');
    expect(within(rows[1]!).getByText('Draft PR #2')).toBeDefined();
    expect(within(rows[2]!).getByText('No pull request')).toBeDefined();
    expect(within(rows[3]!).getByText('PR #1')).toBeDefined();
    const review = within(rows[3]!).getByRole('link', { name: 'Review' });
    expect(reviewRoute(review)).toBe('branch:spring');
  });

  it('filters the editlet/* rows by the input and keeps the base row', async () => {
    const { chip } = await openApp();
    const dialog = await openDialog(chip);
    const input = within(dialog).getByLabelText('Find or create a branch');

    fireEvent.change(input, { target: { value: 'SPR' } });
    expect(within(dialog).getByRole('button', { name: /^editlet\/spring/ })).toBeDefined();
    fireEvent.change(input, { target: { value: 'autumn' } });
    expect(within(dialog).queryByRole('button', { name: /^editlet\/spring/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^main/ })).toBeDefined();
  });

  it('a row click switches the branch: chip, Review changes and the branch content follow', async () => {
    const { chip } = await openApp();
    expect(await within(main()).findByRole('link', { name: 'Post (1)' })).toBeDefined();
    const dialog = await openDialog(chip);

    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chip.textContent).toBe('editlet/spring #1');
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('editlet/spring');
    expect(await within(main()).findByRole('link', { name: 'Post (2)' })).toBeDefined();
    const review = screen.getByRole('link', { name: 'Review changes' });
    expect(reviewRoute(review)).toBe('branch:spring');

    fireEvent.click(chip);
    const again = await screen.findByRole('dialog');
    const active = within(again).getByRole('button', { name: /^editlet\/spring/ });
    expect(active.getAttribute('aria-current')).toBe('true');
  });

  it('the Review link opens the branch route and closes the dialog', async () => {
    const { chip } = await openApp();
    const dialog = await openDialog(chip);
    const row = within(dialog)
      .getByRole('button', { name: /^editlet\/spring/ })
      .closest('li')!;
    fireEvent.click(within(row).getByRole('link', { name: 'Review' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(new URL(window.location.href).searchParams.get('editlet')).toBe('branch:spring');
    expect(chip.textContent).toBe('main · live');
  });

  it('offers to create a typed branch from main and activates it', async () => {
    const { fake, chip } = await openApp();
    const dialog = await openDialog(chip);
    fireEvent.change(within(dialog).getByLabelText('Find or create a branch'), { target: { value: 'New Idea' } });

    const create = within(dialog).getByRole('button', { name: 'Create editlet/new-idea from main' });
    await act(async () => fireEvent.click(create));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.state.refs.get('editlet/new-idea')).toBe(fake.state.refs.get('main'));
    expect(chip.textContent).toBe('editlet/new-idea');
  });

  it('does not offer to create a listed branch, and disables an invalid name', async () => {
    const { chip } = await openApp();
    const dialog = await openDialog(chip);
    const input = within(dialog).getByLabelText('Find or create a branch');

    fireEvent.change(input, { target: { value: 'spring' } });
    expect(within(dialog).queryByRole('button', { name: /^Create/ })).toBeNull();

    fireEvent.change(input, { target: { value: 'a..b' } });
    const create = within(dialog).getByRole('button', { name: 'Create editlet/a..b from main' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(within(dialog).getByText('Use letters, digits and dashes')).toBeDefined();
  });

  it('a branch created elsewhere meanwhile is reported as existing', async () => {
    const { fake, chip } = await openApp();
    const dialog = await openDialog(chip);
    fake.state.refs.set('editlet/late', fake.state.refs.get('main')!);
    fireEvent.change(within(dialog).getByLabelText('Find or create a branch'), { target: { value: 'late' } });

    await act(async () =>
      fireEvent.click(within(dialog).getByRole('button', { name: 'Create editlet/late from main' })),
    );
    expect(await within(dialog).findByText('A branch with this name already exists')).toBeDefined();
    expect(chip.textContent).toBe('main · live');
  });

  it('asks the unsaved-changes guard before switching', async () => {
    const { fake, chip } = await openApp(seededFake(), 'post/hello-world');
    const title = await within(main()).findByLabelText(/^Title/);
    fireEvent.change(title, { target: { value: 'Unsaved' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const dialog = await openDialog(chip);
    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(chip.textContent).toBe('main · live');
    expect((within(main()).getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Unsaved');

    fireEvent.change(within(dialog).getByLabelText('Find or create a branch'), { target: { value: 'other' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create editlet/other from main' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(chip.textContent).toBe('main · live');
    expect(fake.state.refs.has('editlet/other')).toBe(false);
  });
});

describe('user menu', () => {
  it('shows the login initial when the avatar does not load', async () => {
    await openApp();
    const menu = screen.getByTitle('octocat');
    const img = menu.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('https://avatars.test/octocat.png');
    fireEvent.error(img);
    expect(menu.querySelector('img')).toBeNull();
    expect(menu.querySelector('.editlet-user-menu__avatar')!.textContent).toBe('O');
    expect(within(menu).getByRole('button', { name: 'Sign out', hidden: true })).toBeDefined();
  });

  it('Sign out clears the session and shows the sign-in screen', async () => {
    await openApp();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out', hidden: true }));
    expect(await screen.findByLabelText('Personal access token')).toBeDefined();
    expect(readSession(window.sessionStorage)).toBeNull();
  });
});

describe('shell banners in github mode', () => {
  it('a stored branch that is gone shows the fallback notice, not a load error', async () => {
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/gone');
    let releaseBranches!: () => void;
    const held = new Promise<void>((resolve) => (releaseBranches = resolve));
    let goneFailed = false;
    const fake = withIntercept(seededFake(), async (body, pass) => {
      if (body.includes('query Branches')) await held;
      const res = await pass();
      if (body.includes('refs/heads/editlet/gone')) goneFailed = true;
      return res;
    });
    const { chip } = await openApp(fake);
    expect(chip.textContent).toBe('editlet/gone');
    await waitFor(() => expect(goneFailed).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();

    releaseBranches();
    expect(await screen.findByText('Branch editlet/gone no longer exists. Showing main.')).toBeDefined();
    expect(chip.textContent).toBe('main · live');
    expect(await within(main()).findByRole('link', { name: 'Post (1)' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a restored branch with a broken schema keeps the shell, so the editor can switch back', async () => {
    const fake = seededFake();
    fake.state.refs.set('editlet/broken', fake.state.refs.get('main')!);
    fake.commit('editlet/broken', { 'cms/schema.json': '{ not json' });
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/broken');
    const { chip } = await openApp(fake);

    expect(await within(main()).findByRole('heading', { name: 'The schema has errors' })).toBeDefined();
    expect(within(main()).getByRole('alert').textContent).toContain('cms/schema.json');
    expect(chip.textContent).toBe('editlet/broken');

    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole('button', { name: /^main/ }));
    expect(await within(main()).findByRole('link', { name: 'Post (1)' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'The schema has errors' })).toBeNull();
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('main');
  });

  it('a failed file list on GitHub shows the GitHub banner', async () => {
    const fake = withIntercept(seededFake(), async (body, pass) => {
      if (body.includes('refs/heads/editlet/spring')) throw new TypeError('fetch failed');
      return pass();
    });
    const { chip } = await openApp(fake);
    expect(await within(main()).findByRole('link', { name: 'Post (1)' })).toBeDefined();
    const dialog = await openDialog(chip);
    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Can't load from GitHub: Can't reach GitHub")).toBeDefined();
    expect(chip.textContent).toBe('editlet/spring #1');

    // The shell (and the chip) stay, so the editor can switch back.
    fireEvent.click(chip);
    fireEvent.click(await screen.findByRole('button', { name: /^main/ }));
    expect(await within(main()).findByRole('link', { name: 'Post (1)' })).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Try again" on the GitHub banner reloads the file list', async () => {
    let offline = true;
    const fake = withIntercept(seededFake(), async (body, pass) => {
      if (offline && body.includes('refs/heads/editlet/spring')) throw new TypeError('fetch failed');
      return pass();
    });
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/spring');
    await openApp(fake);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText("Can't load from GitHub: Can't reach GitHub")).toBeDefined();
    offline = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(main()).findByRole('link', { name: 'Post (2)' })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
