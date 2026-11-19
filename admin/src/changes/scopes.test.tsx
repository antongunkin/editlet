// The buffer across branches (changes-across-entries T9): *n unsaved* per branch in the picker, and a Home banner for
// a branch that is gone, with Move to main and Discard.
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMemoryCache, type GitHubCache } from '../../../github';
import { withEditletRoute } from '../../../loader/protocol';
import { tokenSession, writeSession } from '../github/session';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { sheetElement } from '../test/render';

// Every source of the app shares this cache (the test seeds and reads rows through it).
const shared = vi.hoisted(() => ({ cache: null as GitHubCache | null }));
vi.mock('../../../github/cache.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../github/cache.ts')>()),
  openGitHubCache: () => shared.cache!,
}));

let cache: GitHubCache;

beforeEach(() => {
  cache = createMemoryCache();
  shared.cache = cache;
});

afterEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
});

function fakeWithSpring(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/spring', fake.state.refs.get('main')!);
  fake.commit('editlet/spring', { 'cms/content/post/spring.md': '---\ntitle: Spring\n---\n' });
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

const seed = (scope: string, ...paths: string[]) =>
  Promise.all(
    paths.map((path) => cache.pending(scope).put({ path, content: `---\ntitle: ${path}\n---\n`, sha: null })),
  );

async function openHome(fake = fakeWithSpring()) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', ''));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  await screen.findByRole('link', { name: /^All content/ }, { timeout: 8000 });
}

describe('unsaved entries per branch', () => {
  it('the Branches sheet says how many each branch holds', async () => {
    await seed('o/r#editlet/spring', 'cms/content/post/a.md', 'cms/content/post/b.md');
    await seed('o/r#main', 'cms/content/post/c.md');
    // Staged images are not entries.
    await cache.pending('o/r#main').put({ path: 'cms/content/post/c/i.png', content: new Uint8Array([1]), sha: null });
    await openHome();
    fireEvent.click(await screen.findByRole('button', { name: /^Branch /, hidden: true }));
    const dialog = await sheetElement('Branches');
    const spring = await within(dialog).findByRole('button', { name: /^editlet\/spring/ });
    expect(spring.textContent).toContain('2 unsaved');
    expect(within(dialog).getByRole('button', { name: /^main/ }).textContent).toContain('1 unsaved');
  });
});

describe('a branch that is gone', () => {
  it('Home says so; Move to main brings the rows to the base branch', async () => {
    await seed('o/r#editlet/gone', 'cms/content/post/a.md', 'cms/content/post/b.md');
    await openHome();
    expect(await screen.findByText(/2 unsaved entries were on editlet\/gone, which no longer exists/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Move to main' }));
    await waitFor(() => expect(screen.queryByText(/were on editlet\/gone/)).toBeNull());
    expect((await cache.pending('o/r#main').list()).map((r) => r.path)).toEqual([
      'cms/content/post/a.md',
      'cms/content/post/b.md',
    ]);
    expect(await cache.pending('o/r#editlet/gone').list()).toEqual([]);
    // Home counts them now (the base branch is the active one).
    expect(await screen.findByRole('button', { name: /^Unsaved(?! changes)/ })).toBeDefined();
  });

  it('Discard removes them', async () => {
    await seed('o/r#editlet/gone', 'cms/content/post/a.md');
    await openHome();
    expect(await screen.findByText(/1 unsaved entry was on editlet\/gone, which no longer exists/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByText(/was on editlet\/gone/)).toBeNull());
    expect(await cache.pending('o/r#editlet/gone').list()).toEqual([]);
    expect(await cache.pending('o/r#main').list()).toEqual([]);
  });

  it('a branch GitHub still lists is not gone', async () => {
    await seed('o/r#editlet/spring', 'cms/content/post/a.md');
    await openHome();
    await waitFor(() => expect(screen.queryByText(/no longer exists/)).toBeNull());
    expect(screen.queryByRole('button', { name: 'Move to main' })).toBeNull();
  });
});
