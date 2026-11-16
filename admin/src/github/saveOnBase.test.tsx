import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenSession, writeSession } from './session';
import { activeBranchKey } from './workspace';

import { readEditletRoute, withEditletRoute } from '../../../loader/protocol';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { entryActions } from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';
const RELOAD_COPY =
  'This entry changed on GitHub since you opened it. Reload to read it, then review your change again.';

const main = () => screen.getByRole('main');
const saveButton = () => entryActions().getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const titleInput = () => within(main()).findByLabelText(/^Title/) as Promise<HTMLInputElement>;

/** The text of `path` at the head of `branch`, or `undefined` when the file is not there. */
function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string | undefined {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path);
  return sha === undefined ? undefined : new TextDecoder().decode(fake.state.blobs.get(sha));
}

/** `main` plus `editlet/a`, where post/hello-world is titled "On A". */
function fakeWithBranch(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
  fake.commit('editlet/a', { [ENTRY]: fileAt(fake, 'main', ENTRY)!.replace('title: Hello world', 'title: On A') });
  return fake;
}

/** `fake`, with the `createCommitOnBranch` request answered by `answer` instead. */
function failingCommits(fake: AdminFakeGitHub, answer: () => Promise<Response>): AdminFakeGitHub {
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    if (href === 'https://api.github.com/graphql' && body.includes('createCommitOnBranch')) return answer();
    return fake.fetch(input, init);
  }) as typeof globalThis.fetch;
  return { ...fake, fetch };
}

async function openEntry(fake: AdminFakeGitHub, branch?: string) {
  if (branch) window.localStorage.setItem(activeBranchKey('o', 'r'), branch);
  window.history.replaceState(null, '', withEditletRoute('/editlet/', 'post/hello-world'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  const chip = await screen.findByRole('button', { name: 'Branch' });
  const title = await titleInput();
  return { chip, title };
}

/** Edits the title and opens the review dialog. */
async function reviewTitle(title: HTMLInputElement, value: string) {
  fireEvent.change(title, { target: { value } });
  fireEvent.click(saveButton());
  return screen.findByRole('dialog');
}

/** Opens the branch picker and clicks the row whose name matches. */
async function pick(chip: HTMLElement, name: RegExp) {
  fireEvent.click(chip);
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(await within(dialog).findByRole('button', { name }));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('saving while the base branch is active', () => {
  it('asks for a new branch, creates it from main and commits there', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main');
    const { chip, title } = await openEntry(fake);
    const screenSection = main().querySelector('.editlet-screen')!;

    const dialog = await reviewTitle(title, 'Hello there');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    expect(within(dialog).getByText('editlet/')).toBeDefined();
    expect(
      within(dialog).getByText(
        'main is the live site. This change goes to a new branch; create a pull request from the branch screen.',
      ),
    ).toBeDefined();

    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save to branch' })));
    await waitFor(() => expect(fake.state.refs.has('editlet/post-hello-world')).toBe(true));
    await waitFor(() => expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toContain('title: Hello there'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
    await waitFor(() => expect(chip.textContent).toBe('editlet/post-hello-world'));
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('editlet/post-hello-world');

    // The entry screen stays mounted (no reload through "Loading…") and adopts the committed file: clean, saved value.
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    expect(screenSection.isConnected).toBe(true);
    expect((await titleInput()).value).toBe('Hello there');
    expect(within(main()).queryByRole('status')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('suggests a unique name and reports a taken one', async () => {
    const fake = createAdminFakeGitHub();
    fake.state.refs.set('editlet/post-hello-world', fake.state.refs.get('main')!);
    const { title } = await openEntry(fake);

    const dialog = await reviewTitle(title, 'Hello there');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world-2'));

    fireEvent.change(field, { target: { value: 'post-hello-world' } });
    expect(within(dialog).getByText('A branch with this name already exists')).toBeDefined();
    const confirm = within(dialog).getByRole('button', { name: 'Save to branch' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('a name taken on GitHub meanwhile keeps the dialog open with the next free name', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main')!;
    const { chip, title } = await openEntry(fake);

    const dialog = await reviewTitle(title, 'Hello there');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    fake.state.refs.set('editlet/post-hello-world', mainHead);

    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save to branch' })));
    await waitFor(() => expect(field.value).toBe('post-hello-world-2'));
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(fake.state.refs.get('editlet/post-hello-world')).toBe(mainHead);
    expect(chip.textContent).toBe('main · live');

    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save to branch' })));
    await waitFor(() => expect(fileAt(fake, 'editlet/post-hello-world-2', ENTRY)).toContain('title: Hello there'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
  });

  it('an invalid name disables the confirm button', async () => {
    const fake = createAdminFakeGitHub();
    const { title } = await openEntry(fake);

    const dialog = await reviewTitle(title, 'Hello there');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    fireEvent.change(field, { target: { value: 'a..b' } });

    expect(within(dialog).getByText('Use letters, digits and dashes')).toBeDefined();
    const confirm = within(dialog).getByRole('button', { name: 'Save to branch' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect([...fake.state.refs.keys()]).toEqual(['main']);
  });

  it('a typed name is normalised and used', async () => {
    const fake = createAdminFakeGitHub();
    const { chip, title } = await openEntry(fake);

    const dialog = await reviewTitle(title, 'Hello there');
    fireEvent.change(within(dialog).getByLabelText(/^New branch/), { target: { value: 'Spring Copy' } });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save to branch' })));

    await waitFor(() => expect(fileAt(fake, 'editlet/spring-copy', ENTRY)).toContain('title: Hello there'));
    await waitFor(() => expect(chip.textContent).toBe('editlet/spring-copy'));
  });

  it('a delete on main goes to a new branch', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main');
    const { chip } = await openEntry(fake);

    fireEvent.click(entryActions().getByRole('button', { name: 'Delete', hidden: true }));
    const dialog = await screen.findByRole('alertdialog');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete on branch' })));

    await waitFor(() => expect(readEditletRoute(window.location.href)).toBe('post'));
    expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toBeUndefined();
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect(fileAt(fake, 'main', ENTRY)).toBeDefined();
    await waitFor(() => expect(chip.textContent).toBe('editlet/post-hello-world'));
  });
});

describe('saving on a cms branch', () => {
  it('shows no branch field and commits to the active branch', async () => {
    const fake = fakeWithBranch();
    const mainHead = fake.state.refs.get('main');
    const { chip, title } = await openEntry(fake, 'editlet/a');
    expect(title.value).toBe('On A');

    const dialog = await reviewTitle(title, 'On A again');
    expect(within(dialog).queryByLabelText(/^New branch/)).toBeNull();
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })));

    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: On A again'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect([...fake.state.refs.keys()].toSorted()).toEqual(['editlet/a', 'main']);
    expect(chip.textContent).toBe('editlet/a');
  });

  it('a commit made on GitHub since the entry was read shows the reload copy, and Reload reads it', async () => {
    const fake = fakeWithBranch();
    const { title } = await openEntry(fake, 'editlet/a');
    fake.commit('editlet/a', {
      [ENTRY]: fileAt(fake, 'editlet/a', ENTRY)!.replace('title: On A', 'title: From GitHub'),
    });

    const dialog = await reviewTitle(title, 'Mine');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })));

    const alert = await within(main()).findByRole('alert');
    expect(alert.textContent).toContain(RELOAD_COPY);
    expect(alert.textContent).not.toContain('Changed on GitHub since it was read');
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
    await waitFor(async () => expect((await titleInput()).value).toBe('From GitHub'));
  });
});

describe('commit errors', () => {
  it('a commit that cannot reach GitHub says so', async () => {
    const fake = failingCommits(fakeWithBranch(), () => Promise.reject(new TypeError('Failed to fetch')));
    const { title } = await openEntry(fake, 'editlet/a');

    const dialog = await reviewTitle(title, 'Mine');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })));

    expect(await within(main()).findByText("Can't reach GitHub")).toBeDefined();
    expect(within(main()).queryByText('Failed to fetch')).toBeNull();
    expect((await titleInput()).value).toBe('Mine');
  });

  it('a commit refused with 403 names the repository', async () => {
    const fake = failingCommits(fakeWithBranch(), async () =>
      Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    );
    const { title } = await openEntry(fake, 'editlet/a');

    const dialog = await reviewTitle(title, 'Mine');
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })));

    expect(await within(main()).findByText("Your GitHub account can't write to o/r")).toBeDefined();
    expect(within(main()).queryByText('Resource not accessible by integration')).toBeNull();
  });
});

describe('switching branch in the picker', () => {
  it('reloads the open entry from the chosen branch after the editor discards changes', async () => {
    const fake = fakeWithBranch();
    // main's file list is loaded (and cached) first, so the switch back to it does not pass through "Loading…".
    const { chip } = await openEntry(fake);
    await pick(chip, /^editlet\/a/);
    await waitFor(async () => expect((await titleInput()).value).toBe('On A'));

    fireEvent.change(await titleInput(), { target: { value: 'Unsaved' } });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await pick(chip, /^main/);
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');

    await waitFor(async () => expect((await titleInput()).value).toBe('Hello world'));
    expect(saveButton().disabled).toBe(true);
    expect(chip.textContent).toBe('main · live');
    expect(within(main()).queryByRole('status')).toBeNull();
  });
});

describe('commit style', () => {
  it('commits with the template and the Editlet-Source trailer', async () => {
    const fake = fakeWithBranch();
    const { title } = await openEntry(fake, 'editlet/a');
    const dialog = await reviewTitle(title, 'Styled');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: Styled'));
    const head = fake.state.commits.get(fake.state.refs.get('editlet/a')!)!;
    expect(head.message).toBe('Update post/hello-world\n\nEditlet-Source: admin');
  });

  it('names the code owners in the review dialog', async () => {
    const fake = fakeWithBranch();
    fake.commit('main', { '.github/CODEOWNERS': '* @acme/admins\n/cms/content/ @acme/editors\n' });
    const { title } = await openEntry(fake, 'editlet/a');
    const dialog = await reviewTitle(title, 'Owned');
    expect(await within(dialog).findByText('Needs approval from @acme/editors on GitHub.')).toBeDefined();
  });

  it('rewrites the Editlet part of the open pull request body after a save', async () => {
    const fake = fakeWithBranch();
    fake.state.pulls.push({
      number: 1,
      title: 'T',
      body: 'Note from a human\n\n<!-- editlet:start -->\nold\n<!-- editlet:end -->',
      draft: false,
      head: 'editlet/a',
      base: 'main',
      state: 'open',
    });
    const { title } = await openEntry(fake, 'editlet/a');
    const dialog = await reviewTitle(title, 'Again');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fake.state.pulls[0]!.body).toContain('- Post · hello-world — updated'));
    expect(fake.state.pulls[0]!.body.startsWith('Note from a human\n\n<!-- editlet:start -->')).toBe(true);
    expect(fake.state.pulls[0]!.body).not.toContain('old');
  });
});
