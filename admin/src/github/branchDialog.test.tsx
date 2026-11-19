import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readSession, tokenSession, writeSession } from './session';
import { activeBranchKey } from './workspace';

import { withEditletRoute } from '../../../loader/protocol';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { closeSheets, rowText, setField, sheetElement } from '../test/render';

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

async function openApp(fake = seededFake(), route = '', homeLoaded = route === '') {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  // Home is drawn again when it has loaded, and with it the chip and any sheet opened from it: wait for it first.
  if (homeLoaded) await screen.findByRole('link', { name: /^All content/ });
  await screen.findByRole('button', { name: /^Branch / });
  return { fake };
}

const main = () => screen.getByRole('main');
/**
 * The branch chip of the open screen: the screen draws it (Home's bottom bar), so a re-render makes a new one. A sheet
 * over it hides it from the accessibility tree.
 */
const chipNow = () => screen.getByRole('button', { name: /^Branch /, hidden: true });
/** The entry count Home's *All content* row shows. */
const contentCount = async () =>
  Number((await within(main()).findByRole('link', { name: /^All content/ })).textContent!.match(/(\d+) entr/)![1]);
/** The Review link of editlet/spring: *Review* and the branch in sr-only text (jsdom joins the two without a space). */
const REVIEW_SPRING = /^Review ?editlet\/spring$/;

/** Opens the Branches sheet from the chip and waits for the listing. */
async function openDialog() {
  fireEvent.click(chipNow());
  const dialog = await sheetElement('Branches');
  await within(dialog).findByRole('button', { name: /^editlet\/spring/ });
  return dialog;
}

/** Types `value` into the find field, clicks the *Create editlet/<name>* row and returns the New branch sheet. */
async function openCreate(dialog: HTMLElement, value: string, name: string) {
  fireEvent.change(within(dialog).getByRole('searchbox', { name: 'Find or create a branch' }), { target: { value } });
  const row = within(dialog).getByRole('button', { name: new RegExp(`^Create ${name.replace(/[.]/g, '\\.')}`) });
  expect(row.textContent).toContain('From main');
  fireEvent.click(row);
  const sheet = await sheetElement('New branch');
  return { sheet, field: within(sheet).getByRole('textbox', { name: 'Branch name' }) as HTMLInputElement };
}

/** No modal sheet left open (a toast is a non-modal dialog). */
const noSheets = () =>
  waitFor(() =>
    expect(screen.queryAllByRole('dialog').filter((d) => d.getAttribute('aria-modal') !== 'false')).toEqual([]),
  );

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('branch chip and picker', () => {
  it('shows the base branch as live, the login and no Review changes link', async () => {
    await openApp();
    expect(chipNow().textContent).toBe('main live');
    expect(await screen.findByRole('button', { name: 'Account' })).toBeDefined();
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
    await openApp(fake);
    const dialog = await openDialog();

    const rows = within(within(dialog).getByRole('list', { name: 'Branches' })).getAllByRole('listitem');
    expect(rows.map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      expect.stringContaining('main'),
      expect.stringContaining('editlet/draft'),
      expect.stringContaining('editlet/plain'),
      expect.stringContaining('editlet/spring'),
    ]);
    expect(within(rows[0]!).getByText('Live site · edits here start a new branch')).toBeDefined();
    expect(within(rows[0]!).getByRole('button').getAttribute('aria-current')).toBe('true');
    expect(within(rows[1]!).getByText(/^Draft pull request #2/)).toBeDefined();
    expect(within(rows[1]!).getByText('Draft')).toBeDefined();
    expect(within(rows[2]!).getByText(/^No pull request/)).toBeDefined();
    expect(within(rows[3]!).getByText(/^Pull request #1/)).toBeDefined();
    expect(within(rows[3]!).getByText('In review')).toBeDefined();
    // The base branch has no Review link; each editlet/* branch has one to its branch screen.
    expect(within(rows[0]!).queryByRole('link')).toBeNull();
    // Its visible text is Review; the branch name is for screen readers.
    const review = within(rows[3]!).getByRole('link', { name: REVIEW_SPRING });
    expect(reviewRoute(review)).toBe('branch:spring');
  });

  it('filters the editlet/* rows by the input and keeps the base row', async () => {
    await openApp();
    const dialog = await openDialog();
    const input = within(dialog).getByRole('searchbox', { name: 'Find or create a branch' });

    fireEvent.change(input, { target: { value: 'SPR' } });
    expect(within(dialog).getByRole('button', { name: /^editlet\/spring/ })).toBeDefined();
    fireEvent.change(input, { target: { value: 'autumn' } });
    expect(within(dialog).queryByRole('button', { name: /^editlet\/spring/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^main/ })).toBeDefined();
  });

  it('a row click switches the branch: chip, Review changes and the branch content follow', async () => {
    await openApp();
    const before = await contentCount();
    const dialog = await openDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(chipNow().textContent).toBe('editlet/spring #1');
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('editlet/spring');
    // editlet/spring has one more post than main.
    await waitFor(async () => expect(await contentCount()).toBe(before + 1));
    const review = screen.getByRole('link', { name: 'Review changes' });
    expect(reviewRoute(review)).toBe('branch:spring');

    fireEvent.click(chipNow());
    const again = await screen.findByRole('dialog');
    const active = within(again).getByRole('button', { name: /^editlet\/spring/ });
    expect(active.getAttribute('aria-current')).toBe('true');
  });

  it('the Review link opens the branch route and closes the Branches sheet', async () => {
    await openApp();
    const dialog = await openDialog();
    const row = within(dialog)
      .getByRole('button', { name: /^editlet\/spring/ })
      .closest('li')!;
    fireEvent.click(within(row).getByRole('link', { name: REVIEW_SPRING }));
    await noSheets();
    expect(new URL(window.location.href).searchParams.get('editlet')).toBe('branch:spring');
    expect(chipNow().textContent).toBe('main live');
  });

  it('offers to create a typed branch from main and activates it', async () => {
    const { fake } = await openApp();
    const dialog = await openDialog();
    // The create row names the normalised branch; New branch keeps the typed text and says what it creates.
    const { sheet, field } = await openCreate(dialog, 'New Idea', 'editlet/new-idea');
    expect(field.value).toBe('New Idea');
    expect(within(sheet).getByText('Creates editlet/new-idea from main.')).toBeDefined();

    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Create branch' })));
    await noSheets();
    expect(fake.state.refs.get('editlet/new-idea')).toBe(fake.state.refs.get('main'));
    expect(chipNow().textContent).toBe('editlet/new-idea');
  });

  it('does not offer to create a listed branch, and disables an invalid name', async () => {
    await openApp();
    const dialog = await openDialog();
    const input = within(dialog).getByRole('searchbox', { name: 'Find or create a branch' });

    fireEvent.change(input, { target: { value: 'spring' } });
    expect(within(dialog).queryByRole('button', { name: /^Create/ })).toBeNull();

    const { sheet, field } = await openCreate(dialog, 'a..b', 'editlet/a..b');
    const create = within(sheet).getByRole('button', { name: 'Create branch' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(within(sheet).getByText('Use letters, digits and dashes')).toBeDefined();
    // Enter in the field submits the form: still nothing is created.
    fireEvent.submit(field.form!);
    expect(within(sheet).queryByRole('alert')).toBeNull();
    expect(sheet.isConnected).toBe(true);
  });

  it('New branch marks a listed name as taken before any request', async () => {
    const { fake } = await openApp();
    const dialog = await openDialog();
    const { sheet, field } = await openCreate(dialog, 'fresh', 'editlet/fresh');
    const before = fake.calls.length;
    fireEvent.change(field, { target: { value: 'spring' } });
    const create = within(sheet).getByRole('button', { name: 'Create branch' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(within(sheet).getByRole('alert').textContent).toBe('A branch with this name already exists');
    fireEvent.submit(field.form!);
    expect(fake.calls.slice(before).filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('Escape closes New branch first, then Branches', async () => {
    await openApp();
    const dialog = await openDialog();
    const { sheet } = await openCreate(dialog, 'fresh', 'editlet/fresh');
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(sheet.isConnected).toBe(false));
    expect(dialog.isConnected).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(dialog.isConnected).toBe(false));
  });

  it('a branch created elsewhere meanwhile is reported as existing', async () => {
    const { fake } = await openApp();
    const dialog = await openDialog();
    fake.state.refs.set('editlet/late', fake.state.refs.get('main')!);
    const { sheet } = await openCreate(dialog, 'late', 'editlet/late');

    await act(async () => fireEvent.click(within(sheet).getByRole('button', { name: 'Create branch' })));
    expect((await within(sheet).findByRole('alert')).textContent).toBe('A branch with this name already exists');
    expect(chipNow().textContent).toBe('main live');
  });

  it('asks the unsaved-changes guard before switching', async () => {
    const { fake } = await openApp(seededFake(), 'post/hello-world');
    await within(main()).findByRole('button', { name: /^Title/ });
    await setField('Title', 'Unsaved');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');
    expect(chipNow().textContent).toBe('main live');

    const { sheet } = await openCreate(dialog, 'other', 'editlet/other');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Create branch' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(chipNow().textContent).toBe('main live');
    expect(fake.state.refs.has('editlet/other')).toBe(false);
    // The form under the sheets kept the edit.
    await closeSheets();
    expect(rowText('Title')).toContain('Unsaved');
  });
});

describe('account sheet', () => {
  const openAccount = async () => {
    await openApp();
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
    return await screen.findByRole('dialog', { name: 'Account' });
  };

  it('shows the login and has Sign out', async () => {
    const account = await openAccount();
    expect(within(account).getByText('octocat')).toBeDefined();
    expect(within(account).getByRole('button', { name: 'Sign out' })).toBeDefined();
  });

  it('Sign out clears the session and shows the sign-in screen', async () => {
    const account = await openAccount();
    fireEvent.click(within(account).getByRole('button', { name: 'Sign out' }));
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
    await openApp(fake, '', false);
    expect(chipNow().textContent).toBe('editlet/gone');
    await waitFor(() => expect(goneFailed).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole('alert')).toBeNull();

    releaseBranches();
    expect(await screen.findByText('Branch editlet/gone no longer exists. Showing main.')).toBeDefined();
    expect(chipNow().textContent).toBe('main live');
    expect(await contentCount()).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a restored branch with a broken schema keeps the shell, so the editor can switch back', async () => {
    const fake = seededFake();
    fake.state.refs.set('editlet/broken', fake.state.refs.get('main')!);
    fake.commit('editlet/broken', { 'cms/schema.json': '{ not json' });
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/broken');
    await openApp(fake, '', false);

    expect(await within(main()).findByRole('heading', { name: 'The schema has errors' })).toBeDefined();
    expect(within(main()).getByRole('alert').textContent).toContain('cms/schema.json');
    expect(chipNow().textContent).toBe('editlet/broken');

    fireEvent.click(chipNow());
    fireEvent.click(await screen.findByRole('button', { name: /^main/ }));
    expect(await contentCount()).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'The schema has errors' })).toBeNull();
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('main');
  });

  it('a failed file list on GitHub shows the GitHub banner', async () => {
    const fake = withIntercept(seededFake(), async (body, pass) => {
      if (body.includes('refs/heads/editlet/spring')) throw new TypeError('fetch failed');
      return pass();
    });
    await openApp(fake);
    expect(await contentCount()).toBeGreaterThan(0);
    const dialog = await openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /^editlet\/spring/ }));

    // The banner sits in the shell's assertive live region, which was on the page before it.
    const message = await screen.findByText("Can't load from GitHub: Can't reach GitHub");
    expect(message.closest('[aria-live="assertive"]')).not.toBeNull();
    expect(chipNow().textContent).toBe('editlet/spring #1');

    // The shell (and the chip) stay, so the editor can switch back.
    fireEvent.click(chipNow());
    fireEvent.click(await screen.findByRole('button', { name: /^main/ }));
    expect(await contentCount()).toBeGreaterThan(0);
    expect(screen.queryByText("Can't load from GitHub: Can't reach GitHub")).toBeNull();
  });

  it('"Try again" on the GitHub banner reloads the file list', async () => {
    let offline = true;
    const fake = withIntercept(seededFake(), async (body, pass) => {
      if (offline && body.includes('refs/heads/editlet/spring')) throw new TypeError('fetch failed');
      return pass();
    });
    window.localStorage.setItem(activeBranchKey('o', 'r'), 'editlet/spring');
    await openApp(fake, '', false);

    const banner = (await screen.findByText("Can't load from GitHub: Can't reach GitHub")).closest<HTMLElement>(
      '[data-slot="banner"]',
    )!;
    offline = false;
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }));
    expect(await contentCount()).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByText("Can't load from GitHub: Can't reach GitHub")).toBeNull());
  });
});
