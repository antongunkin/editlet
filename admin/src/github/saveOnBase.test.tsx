import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenSession, writeSession } from './session';
import { activeBranchKey } from './workspace';

import { readEditletRoute, withEditletRoute } from '../../../loader/protocol';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import {
  cta,
  findCta,
  moreAction,
  openSaveTo,
  reviewCta,
  rowText,
  saveReview,
  setField,
  sheet,
  sheetCta,
  sheetElement,
} from '../test/render';

const ENTRY = 'cms/content/post/hello-world.md';
const RELOAD_COPY =
  'This entry changed on GitHub since you opened it. Reload to read it, then review your change again.';

const main = () => screen.getByRole('main');
/** The branch chip is in the entry screen's status line: a branch switch remounts the screen, so look it up each time. */
const branchChip = () => screen.getByRole('button', { name: /^Branch / });

/** Waits for the Title row to show `value`. */
const titleShows = (value: string) => waitFor(() => expect(rowText('Title')).toContain(value));
/** No placeholder rows: the screen did not go back through loading. */
const notLoading = () => expect(main().querySelector('[data-slot="row"][aria-busy="true"]')).toBeNull();

/** The text of `path` at the head of `branch`, or `undefined` when the file is not there. */
function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string | undefined {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path);
  return sha === undefined ? undefined : new TextDecoder().decode(fake.state.blobs.get(sha));
}

/** How many history reads `versionsAs` has answered (a negative test waits for the read before it asserts). */
let versionReads = 0;

/** `fake`, with the answer to the history read (`query Versions`) changed by `answer` (it gets the real response). */
function versionsAs(fake: AdminFakeGitHub, answer: (real: Response) => Promise<Response> | Response): AdminFakeGitHub {
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : '';
    const real = await fake.fetch(input, init);
    if (!body.includes('query Versions')) return real;
    versionReads += 1;
    return answer(real);
  }) as typeof globalThis.fetch;
  return { ...fake, fetch };
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
  await screen.findByRole('button', { name: /^Title/ });
  await screen.findByRole('button', { name: /^Branch / });
  return { chip: branchChip };
}

/** Edits the title and opens the save review (*Your changes*). */
async function reviewTitle(value: string) {
  await setField('Title', value);
  fireEvent.click(await findCta(/^Save/));
  return sheetElement('Your changes');
}

/** On main: the open review's CTA opens *Save to*; its element, its New branch field and its CTA. */
async function saveToSheet() {
  await openSaveTo();
  const saveTo = await sheetElement('Save to');
  const field = within(saveTo).getByLabelText(/^New branch/) as HTMLInputElement;
  return { saveTo, field, confirm: sheetCta(saveTo) };
}

/** On main: edits the title and opens *Save to* from the review. */
async function saveToTitle(value: string) {
  await reviewTitle(value);
  return saveToSheet();
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
    const { chip } = await openEntry(fake);
    // The entry screen must not go back through its loading rows while the save switches the branch.
    let sawLoading = false;
    const watch = new MutationObserver(() => {
      if (main().querySelector('[data-slot="row"][aria-busy="true"]')) sawLoading = true;
    });
    watch.observe(main(), { subtree: true, childList: true, attributes: true });

    // Your changes says the commit goes to a new branch from main; its CTA does not save yet but opens Save to.
    const review = await reviewTitle('Hello there');
    const commitRows = within(within(review).getByRole('list', { name: 'Commit' }));
    expect(commitRows.getByRole('button', { name: /^Save to/ }).textContent).toContain('main · new branch');
    expect((await reviewCta()).textContent).toBe('Save 1 change');
    const { saveTo, field, confirm } = await saveToSheet();
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    expect(within(saveTo).getByText('editlet/')).toBeDefined();
    expect(within(saveTo).getByText('main is the live site, so this change goes to a new branch.')).toBeDefined();
    expect(confirm.textContent).toBe('Save to new branch');

    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(fake.state.refs.has('editlet/post-hello-world')).toBe(true));
    await waitFor(() => expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toContain('title: Hello there'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
    await waitFor(() => expect(chip().textContent).toBe('editlet/post-hello-world'));
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('editlet/post-hello-world');

    // The entry screen does not reload through its loading rows and adopts the committed file: clean, saved value.
    // Clean on a branch: the CTA leads to the branch's review.
    await waitFor(() => expect(cta()?.textContent).toBe('Review changes'));
    expect(cta()!.tagName).toBe('A');
    watch.disconnect();
    expect(sawLoading).toBe(false);
    expect(rowText('Title')).toContain('Hello there');
    notLoading();
    // No modal left open (a toast is a non-modal dialog).
    expect(screen.queryAllByRole('dialog').filter((d) => d.getAttribute('aria-modal') !== 'false')).toEqual([]);
  });

  it('suggests a unique name and reports a taken one', async () => {
    const fake = createAdminFakeGitHub();
    fake.state.refs.set('editlet/post-hello-world', fake.state.refs.get('main')!);
    await openEntry(fake);

    const { saveTo, field, confirm } = await saveToTitle('Hello there');
    await waitFor(() => expect(field.value).toBe('post-hello-world-2'));

    fireEvent.change(field, { target: { value: 'post-hello-world' } });
    expect(within(saveTo).getByRole('alert').textContent).toBe('A branch with this name already exists');
    expect(confirm.disabled).toBe(true);
  });

  it('a name taken on GitHub meanwhile keeps Save to open with the next free name', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main')!;
    await openEntry(fake);

    const { saveTo, field, confirm } = await saveToTitle('Hello there');
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    fake.state.refs.set('editlet/post-hello-world', mainHead);

    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(field.value).toBe('post-hello-world-2'));
    // Save to stays open on top of Your changes.
    expect(saveTo.isConnected).toBe(true);
    expect(screen.getAllByRole('dialog').at(-1)).toBe(saveTo);
    expect(fake.state.refs.get('editlet/post-hello-world')).toBe(mainHead);
    // Still on main (the chip is under the sheets, hidden from the accessibility tree).
    expect(screen.getByRole('button', { name: /^Branch /, hidden: true }).textContent).toBe('main live');

    await act(async () => fireEvent.click(confirm));
    await waitFor(() => expect(fileAt(fake, 'editlet/post-hello-world-2', ENTRY)).toContain('title: Hello there'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
  });

  it('an invalid name disables the confirm button', async () => {
    const fake = createAdminFakeGitHub();
    await openEntry(fake);

    const { saveTo, field, confirm } = await saveToTitle('Hello there');
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    fireEvent.change(field, { target: { value: 'a..b' } });

    expect(within(saveTo).getByRole('alert').textContent).toBe('Use letters, digits and dashes');
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    // Enter in the field submits the same form: still nothing.
    fireEvent.submit(field.form!);
    expect([...fake.state.refs.keys()]).toEqual(['main']);
  });

  it('a typed name is normalised and used', async () => {
    const fake = createAdminFakeGitHub();
    const { chip } = await openEntry(fake);

    await reviewTitle('Hello there');
    await saveReview({ branch: 'Spring Copy' });

    await waitFor(() => expect(fileAt(fake, 'editlet/spring-copy', ENTRY)).toContain('title: Hello there'));
    await waitFor(() => expect(chip().textContent).toBe('editlet/spring-copy'));
  });

  it('a delete on main goes to a new branch', async () => {
    const fake = createAdminFakeGitHub();
    const mainHead = fake.state.refs.get('main');
    const { chip } = await openEntry(fake);

    await moreAction('Delete…');
    const dialog = await screen.findByRole('alertdialog');
    const field = within(dialog).getByLabelText(/^New branch/) as HTMLInputElement;
    await waitFor(() => expect(field.value).toBe('post-hello-world'));
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Delete on branch' })));

    await waitFor(() => expect(readEditletRoute(window.location.href)).toBe('post'));
    expect(fileAt(fake, 'editlet/post-hello-world', ENTRY)).toBeUndefined();
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect(fileAt(fake, 'main', ENTRY)).toBeDefined();
    await waitFor(() => expect(chip().textContent).toBe('editlet/post-hello-world'));
  });
});

describe('saving on a cms branch', () => {
  it('shows no branch field and commits to the active branch', async () => {
    const fake = fakeWithBranch();
    const mainHead = fake.state.refs.get('main');
    const { chip } = await openEntry(fake, 'editlet/a');
    await titleShows('On A');

    // Save to names the active branch and opens nothing; the CTA saves at once.
    const review = await reviewTitle('On A again');
    const commitRows = within(within(review).getByRole('list', { name: 'Commit' }));
    expect(commitRows.getByText('editlet/a')).toBeDefined();
    expect(commitRows.queryByRole('button', { name: /^Save to/ })).toBeNull();
    expect(screen.queryByLabelText(/^New branch/)).toBeNull();
    await act(async () => fireEvent.click(await reviewCta()));
    expect(screen.queryByRole('dialog', { name: 'Save to' })).toBeNull();

    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: On A again'));
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect([...fake.state.refs.keys()].toSorted()).toEqual(['editlet/a', 'main']);
    expect(chip().textContent).toBe('editlet/a');
  });

  it('a commit made on GitHub since the entry was read: Compare changes, pick per field, then save on the new sha', async () => {
    const fake = fakeWithBranch();
    await openEntry(fake, 'editlet/a');
    fake.commit('editlet/a', {
      [ENTRY]: fileAt(fake, 'editlet/a', ENTRY)!.replace('title: On A', 'title: From GitHub'),
    });

    await reviewTitle('Mine');
    await saveReview();

    // The edits stay; the banner says why and the one CTA compares (FigCraft *Entry · conflict*).
    expect(
      await within(main()).findByText('Someone saved this entry on GitHub after you opened it. Your edits are kept.'),
    ).toBeDefined();
    expect(within(main()).queryByText(RELOAD_COPY)).toBeNull();
    fireEvent.click(await findCta('Compare changes'));
    const compare = await sheet('Compare changes');
    expect(compare.getByText('1 field changed on GitHub')).toBeDefined();
    const title = within(compare.getByRole('radiogroup', { name: 'Title' }));
    expect(title.getByRole('radio', { name: 'Yours: Mine' }).getAttribute('aria-checked')).toBe('true');
    // The newer side says who saved it and when (the latest commit of the file is the file the screen holds).
    expect(title.getByRole('radio', { name: /^On GitHub · jane, .+: From GitHub$/ })).toBeDefined();
    fireEvent.click(compare.getByRole('button', { name: 'Apply 1 choice' }));

    // Yours kept, on top of the newer file: the next save goes through.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Compare changes' })).toBeNull());
    expect(rowText('Title')).toContain('Mine');
    fireEvent.click(await findCta('Save 1 change'));
    await saveReview();
    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: Mine'));
  });

  it('compare card without who and when: the history read fails, or its latest file is not the one the screen holds', async () => {
    const edit = (fake: AdminFakeGitHub) =>
      fake.commit('editlet/a', {
        [ENTRY]: fileAt(fake, 'editlet/a', ENTRY)!.replace('title: On A', 'title: From GitHub'),
      });
    const compareTitle = async () => {
      // The read of who saved the newer file starts as soon as the refused save has the newer file: count from here.
      versionReads = 0;
      await reviewTitle('Mine');
      await saveReview();
      fireEvent.click(await findCta('Compare changes'));
      const compare = await sheet('Compare changes');
      // The label would be drawn once the history read has been answered: wait for it, then let the answer settle.
      await waitFor(() => expect(versionReads).toBeGreaterThan(0));
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      return within(compare.getByRole('radiogroup', { name: 'Title' }));
    };

    // A rejected read: the plain side name.
    const refused = versionsAs(fakeWithBranch(), async () => new Response('nope', { status: 500 }));
    await openEntry(refused, 'editlet/a');
    edit(refused);
    expect((await compareTitle()).getByRole('radio', { name: 'On GitHub: From GitHub' })).toBeDefined();
    cleanup();

    // The latest commit's file is another blob than the one the screen read (a newer commit since): the plain name too.
    const other = versionsAs(fakeWithBranch(), async (real) => {
      const json = (await real.json()) as {
        data: { repository: { ref: { target: { history: { nodes: { file: { oid: string } }[] } } } } };
      };
      for (const node of json.data.repository.ref.target.history.nodes) node.file.oid = 'f'.repeat(40);
      return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
    });
    await openEntry(other, 'editlet/a');
    edit(other);
    expect((await compareTitle()).getByRole('radio', { name: 'On GitHub: From GitHub' })).toBeDefined();
  });

  it('picking the GitHub version everywhere leaves the entry clean on the newer file', async () => {
    const fake = fakeWithBranch();
    await openEntry(fake, 'editlet/a');
    fake.commit('editlet/a', {
      [ENTRY]: fileAt(fake, 'editlet/a', ENTRY)!.replace('title: On A', 'title: From GitHub'),
    });
    await reviewTitle('Mine');
    await saveReview();
    fireEvent.click(await findCta('Compare changes'));
    const compare = await sheet('Compare changes');
    fireEvent.click(compare.getByRole('radio', { name: /^On GitHub · jane, .+: From GitHub$/ }));
    fireEvent.click(compare.getByRole('button', { name: 'Apply 1 choice' }));
    await titleShows('From GitHub');
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull());
  });
});

describe('commit errors', () => {
  it('a commit that cannot reach GitHub says so', async () => {
    const fake = failingCommits(fakeWithBranch(), () => Promise.reject(new TypeError('Failed to fetch')));
    await openEntry(fake, 'editlet/a');

    await reviewTitle('Mine');
    await saveReview();

    expect(await within(main()).findByText("Can't reach GitHub")).toBeDefined();
    expect(within(main()).queryByText('Failed to fetch')).toBeNull();
    expect(rowText('Title')).toContain('Mine');
  });

  it('a commit refused with 403 names the repository', async () => {
    const fake = failingCommits(fakeWithBranch(), async () =>
      Response.json({ message: 'Resource not accessible by integration' }, { status: 403 }),
    );
    await openEntry(fake, 'editlet/a');

    await reviewTitle('Mine');
    await saveReview();

    expect(await within(main()).findByText("Your GitHub account can't write to o/r")).toBeDefined();
    expect(within(main()).queryByText('Resource not accessible by integration')).toBeNull();
  });
});

describe('switching branch in the picker', () => {
  it('reloads the open entry from the chosen branch after the editor discards changes', async () => {
    const fake = fakeWithBranch();
    // main's file list is loaded (and cached) first, so the switch back to it does not pass through "Loading…".
    const { chip } = await openEntry(fake);
    await pick(chip(), /^editlet\/a/);
    await titleShows('On A');

    await setField('Title', 'Unsaved');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await pick(chip(), /^main/);
    expect(confirm).toHaveBeenCalledWith('Discard unsaved changes?');

    await titleShows('Hello world');
    expect(cta()).toBeNull();
    expect(chip().textContent).toBe('main live');
    notLoading();
  });
});

describe('commit style', () => {
  it('commits with the template and the Editlet-Source trailer', async () => {
    const fake = fakeWithBranch();
    await openEntry(fake, 'editlet/a');
    await reviewTitle('Styled');
    await saveReview();
    await waitFor(() => expect(fileAt(fake, 'editlet/a', ENTRY)).toContain('title: Styled'));
    const head = fake.state.commits.get(fake.state.refs.get('editlet/a')!)!;
    expect(head.message).toBe('Update post/hello-world\n\nEditlet-Source: admin');
  });

  it('names the code owners in Your changes', async () => {
    const fake = fakeWithBranch();
    fake.commit('main', { '.github/CODEOWNERS': '* @acme/admins\n/cms/content/ @acme/editors\n' });
    await openEntry(fake, 'editlet/a');
    const dialog = await reviewTitle('Owned');
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
    await openEntry(fake, 'editlet/a');
    await reviewTitle('Again');
    await saveReview();
    await waitFor(() => expect(fake.state.pulls[0]!.body).toContain('- Post · hello-world — updated'));
    expect(fake.state.pulls[0]!.body.startsWith('Note from a human\n\n<!-- editlet:start -->')).toBe(true);
    expect(fake.state.pulls[0]!.body).not.toContain('old');
  });
});
