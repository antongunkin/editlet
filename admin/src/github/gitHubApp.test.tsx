import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenSession, writeSession } from './session';

import type { GitHubCache } from '../../../github/cache.ts';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { fixtureFiles } from '../test/fixture';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { HOME_LOADED } from '../test/render';

// One memory cache for the whole admin of a test (in jsdom there is no IndexedDB), so the test can see its rows and
// count the calls on it.
const cache = vi.hoisted(() => ({ current: null as GitHubCache | null }));
vi.mock('../../../github/cache.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../github/cache.ts')>();
  return { ...actual, openGitHubCache: () => (cache.current ??= actual.createMemoryCache()) };
});

// The live-site gate: access check, then the git style read from the base branch's schema.

const SCHEMA_URL = 'https://api.github.com/repos/o/r/contents/cms/schema.json';
const MINUTE = 60_000;
const ENTRY = 'cms/content/post/hello-world.md';
const BLOB = 'a'.repeat(40);
/** The scope of the base branch's unsaved edits (`owner/repo#branch`). */
const SCOPE = 'o/r#main';

function open(github: AdminFakeGitHub, wrap = (f: typeof fetch) => f) {
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(wrap(siteFetch(LIVE_CONFIG, github)));
}

/** Waits for the Home screen; the cache of the admin is in `cache`. */
async function loaded(): Promise<GitHubCache> {
  const main = await screen.findByRole('main');
  await within(main).findByRole('link', { name: HOME_LOADED });
  return cache.current!;
}

/** A cached blob, a cached last commit and an unsaved edit of the entry, as a visit leaves them. */
async function seed(c: GitHubCache) {
  await c.putBlobs([{ sha: BLOB, bytes: new TextEncoder().encode('title: Hello world') }]);
  await c.putLastCommits('main', [{ path: ENTRY, sha: BLOB, event: null }]);
  await c.pending(SCOPE).put({ path: ENTRY, content: 'title: Unsaved', sha: BLOB, base: 'title: Hello world' });
}

/** What the cache still holds of `seed`. */
async function holdings(c: GitHubCache) {
  return {
    blobs: (await c.getBlobs([BLOB])).size,
    lastCommits: (await c.getLastCommits('main', [{ path: ENTRY, sha: BLOB }])).size,
    pending: (await c.pending(SCOPE).list()).map((change) => change.path),
  };
}

/** Pastes `token` into the sign-in dialog. */
function useToken(dialog: HTMLElement, token: string) {
  const toggle = within(dialog).queryByRole('button', { name: 'Use a personal access token' });
  if (toggle) fireEvent.click(toggle);
  fireEvent.change(within(dialog).getByLabelText('Personal access token'), { target: { value: token } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Use token' }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  cache.current = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('GitHubApp', () => {
  it('shows the Admin role to a repository admin', async () => {
    open(createAdminFakeGitHub({ admin: true }));
    const main = await screen.findByRole('main');
    expect(await within(main).findByRole('link', { name: HOME_LOADED })).toBeDefined();
    // The role is in the account sheet the header's avatar opens.
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(await screen.findByText('Admin')).toBeDefined();
    expect(screen.queryByText('Editor')).toBeNull();
  });

  it('stays collapsed when it was minimized while the shell was still loading', async () => {
    // Every screen before the shell has a window frame of its own: the choice must outlive it.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = (base: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (href.startsWith(SCHEMA_URL)) await held;
        return base(input, init);
      }) as typeof fetch;
    open(createAdminFakeGitHub(), slow);
    expect(await screen.findByText('Loading…')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(document.querySelector('[data-editlet="window"][data-collapsed]')).not.toBeNull();

    release();
    const main = await screen.findByRole('main');
    expect(main.closest('[data-editlet="window"][data-collapsed]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Editlet' }));
    expect(main.closest('[data-editlet="window"][data-collapsed]')).toBeNull();
  });

  it.each([
    [
      'without a schema on the base branch',
      () => {
        const { 'cms/schema.json': _, ...rest } = fixtureFiles();
        return rest;
      },
    ],
    ['with a broken schema on the base branch', () => ({ ...fixtureFiles(), 'cms/schema.json': '{' })],
  ])('opens the shell with the default git style %s', async (_, files) => {
    open(createAdminFakeGitHub({ files: files() }));
    expect(await screen.findByRole('main')).toBeDefined();
    expect(screen.queryByText("Can't check your access")).toBeNull();
  });

  it('says it cannot check access when the schema read fails, and Try again reads it again', async () => {
    // The query retries once: both reads fail, then GitHub answers again.
    let failing = true;
    const flaky = (base: typeof fetch) =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (href.startsWith(SCHEMA_URL) && failing) {
          return Response.json({ message: 'Server Error' }, { status: 500 });
        }
        return base(input, init);
      }) as typeof fetch;
    open(createAdminFakeGitHub(), flaky);
    expect(await screen.findByText("Can't check your access")).toBeDefined();
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    const main = await screen.findByRole('main');
    await waitFor(() => expect(within(main).getByRole('link', { name: HOME_LOADED })).toBeDefined());
  });
});

describe('the cached content on sign-out and account switch', () => {
  it('a sign-out drops the cached blobs and last commits once, and keeps the unsaved edits', async () => {
    open(createAdminFakeGitHub());
    const c = await loaded();
    await seed(c);
    const clear = vi.spyOn(c, 'clearContent');
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in to edit' })).toBeDefined();

    expect(clear).toHaveBeenCalledTimes(1);
    expect(await holdings(c)).toEqual({ blobs: 0, lastCommits: 0, pending: [ENTRY] });
  });

  it('a session that lapses by itself keeps the cache, and the same account signing in again keeps it too', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    open(createAdminFakeGitHub());
    const c = await loaded();
    await seed(c);
    const clear = vi.spyOn(c, 'clearContent');

    act(() => vi.advanceTimersByTime(61 * MINUTE));
    const dialog = await screen.findByRole('dialog', { name: 'Sign in again' });
    expect(clear).not.toHaveBeenCalled();
    expect(await holdings(c)).toEqual({ blobs: 1, lastCommits: 1, pending: [ENTRY] });

    useToken(dialog, 'pat_2');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(clear).not.toHaveBeenCalled();
    expect(await holdings(c)).toEqual({ blobs: 1, lastCommits: 1, pending: [ENTRY] });
  });

  it('signing in as another account drops the cached blobs and last commits, and keeps the unsaved edits', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // `pat_other` is another login (`someone`); the fake answers `octocat` for every other token.
    open(
      createAdminFakeGitHub(),
      (base) =>
        (async (input: RequestInfo | URL, init?: RequestInit) => {
          const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const auth = new Headers(init?.headers).get('authorization');
          if (href === 'https://api.github.com/user' && auth === 'Bearer pat_other') {
            return Response.json({ login: 'someone', avatar_url: 'https://avatars.test/someone.png' });
          }
          return base(input, init);
        }) as typeof fetch,
    );
    const c = await loaded();
    await seed(c);
    const clear = vi.spyOn(c, 'clearContent');

    act(() => vi.advanceTimersByTime(61 * MINUTE));
    useToken(await screen.findByRole('dialog', { name: 'Sign in again' }), 'pat_other');

    await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
    await waitFor(async () => expect(await holdings(c)).toEqual({ blobs: 0, lastCommits: 0, pending: [ENTRY] }));
  });
});
