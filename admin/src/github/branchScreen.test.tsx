import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadBranch } from './BranchScreen';
import { tokenSession, writeSession } from './session';
import { activeBranchKey } from './workspace';

import { EditletError } from '../../../core/issues';
import type { GitHubSource } from '../../../github';
import { json } from '../../../github/test/fakeGitHub';
import { withEditletRoute } from '../../../loader/protocol';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';

const ENTRY = 'cms/content/post/hello-world.md';
const GONE = "Branch editlet/edit doesn't exist. It may have been merged or deleted.";

const main = () => screen.getByRole('main');

function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path)!;
  return new TextDecoder().decode(fake.state.blobs.get(sha));
}

/** `main` plus `editlet/edit`: post/hello-world retitled "Edited" and one file outside the CMS paths. */
function fakeWithEdit(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/edit', fake.state.refs.get('main')!);
  fake.commit('editlet/edit', {
    [ENTRY]: fileAt(fake, 'main', ENTRY).replace('title: Hello world', 'title: Edited'),
    'src/foo.ts': 'export const foo = 1;\n',
  });
  return fake;
}

function deploy(fake: AdminFakeGitHub, id: number, sha: string, ref: string, state: string, url?: string) {
  fake.state.deployments.unshift({
    id,
    sha,
    ref,
    environment: 'Preview',
    created_at: '2026-11-11T10:00:00Z',
    updated_at: '2026-11-11T10:01:00Z',
  });
  fake.state.deploymentStatuses.set(id, [
    { state, created_at: '2026-11-11T10:01:00Z', ...(url ? { environment_url: url } : {}) },
  ]);
}

/** `fake` with `POST …/pulls` held until the returned `release()`. */
function holdPullCreate(fake: AdminFakeGitHub): { github: AdminFakeGitHub; release(): void } {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (init?.method === 'POST' && url.pathname.endsWith('/pulls')) await gate;
    return fake.fetch(input, init);
  }) as typeof fetch;
  return { github: { ...fake, fetch: fetchFn }, release };
}

async function openBranch(fake: AdminFakeGitHub, opts: { route?: string; active?: string; param?: string } = {}) {
  if (opts.active) window.localStorage.setItem(activeBranchKey('o', 'r'), opts.active);
  window.history.replaceState(null, '', withEditletRoute('/editlet/', opts.route ?? 'branch:edit'));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(siteFetch(opts.param ? { ...LIVE_CONFIG, param: opts.param } : LIVE_CONFIG, fake));
  await screen.findByRole('button', { name: 'Branch' });
}

async function createButton(): Promise<HTMLButtonElement> {
  return (await within(main()).findByRole('button', { name: 'Create pull request' })) as HTMLButtonElement;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('branch screen', () => {
  it('shows the field diff, the other files, the crumb and no Publish', async () => {
    const fake = fakeWithEdit();
    await openBranch(fake);

    const file = await within(main()).findByRole('region', { name: ENTRY });
    expect(within(file).getByText('Modified')).toBeDefined();
    const title = within(file).getByRole('region', { name: 'Title' });
    expect(within(title).getByText('Hello world')).toBeDefined();
    expect(within(title).getByText('Edited')).toBeDefined();

    const other = within(main()).getByRole('list', { name: 'Other files' });
    expect(within(other).getByText('src/foo.ts')).toBeDefined();
    expect(within(main()).getByText('Merging the pull request brings these in too.')).toBeDefined();
    expect(within(main()).getByRole('heading', { name: 'editlet/edit' })).toBeDefined();
    expect((await createButton()).disabled).toBe(false);
    expect(within(main()).getByRole('button', { name: 'Edit on this branch' })).toBeDefined();
    expect(within(main()).queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(within(main()).queryByRole('region', { name: 'Live site' })).toBeNull();
  });

  it('Create pull request: busy, then the link and who merges it; nothing is merged', async () => {
    const fake = fakeWithEdit();
    const mainHead = fake.state.refs.get('main');
    const { github, release } = holdPullCreate(fake);
    await openBranch(github);

    const button = await createButton();
    fireEvent.click(button);
    await waitFor(() => expect(button.textContent).toBe('Creating…'));
    expect(button.disabled).toBe(true);
    await act(async () => release());

    const link = await within(main()).findByRole('link', { name: 'Pull request #1' });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(within(main()).getByText('A developer merges it on GitHub.')).toBeDefined();
    expect(within(main()).queryByRole('button', { name: 'Create pull request' })).toBeNull();
    expect(within(main()).queryByText('Draft')).toBeNull();

    expect(fake.state.pulls).toHaveLength(1);
    expect(fake.state.pulls[0]).toMatchObject({
      title: 'Update editlet/edit',
      head: 'editlet/edit',
      base: 'main',
      state: 'open',
    });
    expect(fake.state.refs.get('main')).toBe(mainHead);
    expect(fake.state.refs.has('editlet/edit')).toBe(true);
  });

  it('an open draft pull request: the link with a Draft badge, no Create pull request', async () => {
    const fake = fakeWithEdit();
    fake.state.pulls.push({
      number: 4,
      title: 'D',
      body: '',
      draft: true,
      head: 'editlet/edit',
      base: 'main',
      state: 'open',
    });
    await openBranch(fake);

    const link = await within(main()).findByRole('link', { name: 'Pull request #4' });
    expect(link.getAttribute('href')).toBe('https://github.com/o/r/pull/4');
    expect(within(main()).getByText('Draft')).toBeDefined();
    expect(within(main()).getByText('A developer merges it on GitHub.')).toBeDefined();
    expect(within(main()).queryByRole('button', { name: 'Create pull request' })).toBeNull();
  });

  it('GitHub refusing the pull request (no commits between) shows the error', async () => {
    const fake = fakeWithEdit();
    fake.restRoutes.unshift({
      method: 'POST',
      pattern: /^\/pulls$/,
      handle: () =>
        json({ message: 'Validation Failed', errors: [{ message: 'No commits between main and editlet/edit' }] }, 422),
    });
    await openBranch(fake);

    await act(async () => fireEvent.click(await createButton()));
    const alert = await within(main()).findByRole('alert');
    expect(within(alert).getByText('No changes between main and editlet/edit')).toBeDefined();
    expect((await createButton()).disabled).toBe(false);
    expect(within(main()).queryByRole('link', { name: /Pull request #/ })).toBeNull();
  });

  it('revisiting a branch deleted elsewhere shows it is gone, without the old diff', async () => {
    const fake = fakeWithEdit();
    await openBranch(fake, { active: 'editlet/edit' });
    await within(main()).findByRole('region', { name: ENTRY });
    const review = screen.getByRole('link', { name: 'Review changes' });
    fake.state.refs.delete('editlet/edit');

    fireEvent.click(screen.getByRole('link', { name: 'Home', hidden: true }));
    await waitFor(() => expect(within(main()).queryByRole('region', { name: ENTRY })).toBeNull());
    fireEvent.click(review);

    expect(await within(main()).findByText(GONE)).toBeDefined();
    expect(within(main()).queryByRole('region', { name: ENTRY })).toBeNull();
    expect(within(main()).queryByRole('button', { name: 'Create pull request' })).toBeNull();
  });

  it('a preview for the head sha links to the branch route on the preview URL', async () => {
    const fake = fakeWithEdit();
    deploy(fake, 3, fake.state.refs.get('editlet/edit')!, 'editlet/edit', 'success', 'https://preview.test/');
    await openBranch(fake);

    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    const link = await within(preview).findByRole('link', { name: 'Open preview' });
    expect(within(preview).getByText('Preview ready')).toBeDefined();
    expect(link.getAttribute('href')).toBe(withEditletRoute('https://preview.test/', 'branch:edit'));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
  });

  it('config.param: the preview link and the pull request body use the site parameter', async () => {
    const fake = fakeWithEdit();
    deploy(fake, 3, fake.state.refs.get('editlet/edit')!, 'editlet/edit', 'success', 'https://preview.test/');
    await openBranch(fake, { param: 'cms' });

    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    const link = await within(preview).findByRole('link', { name: 'Open preview' });
    expect(link.getAttribute('href')).toBe('https://preview.test/?cms=branch:edit');
    fireEvent.click(await createButton());
    await within(main()).findByRole('link', { name: 'Pull request #1' });
    expect(fake.state.pulls[0]!.body).toContain('/?cms=branch:edit');
  });

  it('an older preview: build in progress with the older link', async () => {
    const fake = fakeWithEdit();
    deploy(fake, 4, 'older', 'editlet/edit', 'success', 'https://old.test/');
    await openBranch(fake);

    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    expect(await within(preview).findByText('Build in progress')).toBeDefined();
    const link = within(preview).getByRole('link', { name: 'Older preview' });
    expect(link.getAttribute('href')).toBe(withEditletRoute('https://old.test/', 'branch:edit'));
  });

  it('a deployment URL that is not http(s) gets no link', async () => {
    const fake = fakeWithEdit();
    deploy(fake, 5, fake.state.refs.get('editlet/edit')!, 'editlet/edit', 'success', 'javascript:alert(1)');
    await openBranch(fake);

    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    expect(await within(preview).findByText('Preview ready')).toBeDefined();
    expect(within(preview).queryByRole('link')).toBeNull();
  });

  it('a build log URL that is not http(s) gets no link', async () => {
    const fake = fakeWithEdit();
    deploy(fake, 6, fake.state.refs.get('editlet/edit')!, 'editlet/edit', 'failure');
    fake.state.deploymentStatuses.get(6)![0]!.log_url = 'javascript:alert(1)';
    await openBranch(fake);

    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    expect(await within(preview).findByText('Preview build failed')).toBeDefined();
    expect(within(preview).queryByRole('link')).toBeNull();
  });

  it('no deployment: no preview yet', async () => {
    const fake = fakeWithEdit();
    await openBranch(fake);
    const preview = await within(main()).findByRole('region', { name: 'Preview' });
    expect(
      await within(preview).findByText(
        "No preview yet. The build may still be starting, or the host doesn't report deployments to GitHub. Review the diff below.",
      ),
    ).toBeDefined();
  });

  it('Edit on this branch makes it active and keeps the review', async () => {
    const fake = fakeWithEdit();
    await openBranch(fake);
    const file = await within(main()).findByRole('region', { name: ENTRY });
    const chip = screen.getByRole('button', { name: 'Branch' });
    expect(chip.textContent).toContain('main · live');

    await act(async () => fireEvent.click(within(main()).getByRole('button', { name: 'Edit on this branch' })));
    await waitFor(() => expect(chip.textContent).toContain('editlet/edit'));
    expect(window.localStorage.getItem(activeBranchKey('o', 'r'))).toBe('editlet/edit');
    expect(within(main()).queryByRole('button', { name: 'Edit on this branch' })).toBeNull();
    expect(file.isConnected).toBe(true);
  });

  it('the active branch: no Edit on this branch', async () => {
    const fake = fakeWithEdit();
    await openBranch(fake, { active: 'editlet/edit' });
    const chip = screen.getByRole('button', { name: 'Branch' });
    await waitFor(() => expect(chip.textContent).toContain('editlet/edit'));
    await within(main()).findByRole('region', { name: ENTRY });
    expect(within(main()).queryByRole('button', { name: 'Edit on this branch' })).toBeNull();
  });

  it('a branch with no changes cannot open a pull request', async () => {
    const fake = createAdminFakeGitHub();
    fake.state.refs.set('editlet/edit', fake.state.refs.get('main')!);
    await openBranch(fake);
    expect(await within(main()).findByText('No changes on this branch yet.')).toBeDefined();
    expect((await createButton()).disabled).toBe(true);
  });

  it('a lagging compare (identical, ahead 0) with changed files still allows Create pull request', async () => {
    const fake = fakeWithEdit();
    // REST compare still sees the old head (as GitHub does for a moment after a commit); the snapshots are fresh.
    const mergeBase = fake.state.refs.get('main')!;
    fake.restRoutes.unshift({
      method: 'GET',
      pattern: /^\/compare\//,
      handle: () =>
        json({ status: 'identical', ahead_by: 0, behind_by: 0, merge_base_commit: { sha: mergeBase }, files: [] }),
    });
    await openBranch(fake);

    await within(main()).findByRole('region', { name: ENTRY });
    expect((await createButton()).disabled).toBe(false);
    expect(within(main()).queryByText('No changes on this branch yet.')).toBeNull();
  });

  it('main ahead of the branch: a status line', async () => {
    const fake = fakeWithEdit();
    fake.commit('main', { 'README.md': 'one\n' });
    fake.commit('main', { 'README.md': 'two\n' });
    await openBranch(fake);
    expect(await within(main()).findByText('main has 2 newer commits.')).toBeDefined();
  });

  it('a branch that is gone', async () => {
    await openBranch(createAdminFakeGitHub(), { route: 'branch:gone' });
    expect(
      await within(main()).findByText("Branch editlet/gone doesn't exist. It may have been merged or deleted."),
    ).toBeDefined();
  });

  it('an invalid branch name', async () => {
    await openBranch(createAdminFakeGitHub(), { route: 'branch:a..b' });
    expect(await within(main()).findByText('Not a CMS branch')).toBeDefined();
  });
});

describe('loadBranch', () => {
  it('a branch without a schema names the schema path the shell reads', async () => {
    const src = { listFiles: async () => [] } as unknown as GitHubSource;
    const error = await loadBranch(src, 'site/schema.json').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditletError);
    expect((error as EditletError).issues).toEqual([
      { file: 'site/schema.json', path: '', message: 'No schema.json found' },
    ]);
  });
});

/** `main` and `editlet/edit` with `git` style keys in the schema. */
function withStyle(fake: AdminFakeGitHub, git: Record<string, unknown>, branches = ['main', 'editlet/edit']) {
  for (const branch of branches) {
    const schema = JSON.parse(fileAt(fake, branch, 'cms/schema.json'));
    fake.commit(branch, { 'cms/schema.json': JSON.stringify({ ...schema, git: { ...schema.git, ...git } }) });
  }
}

describe('pull request style and reviewers', () => {
  it('opens the pull request with the schema style: title, body, labels, draft', async () => {
    const fake = fakeWithEdit();
    withStyle(fake, {
      pullRequest: { title: 'Content: {name} by {login}', labels: ['editlet', 'content'], draft: true },
    });
    await openBranch(fake);
    fireEvent.click(await createButton());
    await within(main()).findByRole('link', { name: 'Pull request #1' });
    const pr = fake.state.pulls[0]!;
    expect(pr).toMatchObject({ title: 'Content: edit by octocat', draft: true, labels: ['editlet', 'content'] });
    expect(pr.body).toContain('<!-- editlet:start -->');
    expect(pr.body).toContain('Opened in Editlet by @octocat.');
    expect(pr.body).toContain('- Post · hello-world — updated');
    expect(pr.body).toContain('/?editlet=branch:edit');
    expect(await within(main()).findByText(/Code owners are asked to review/)).toBeDefined();
  });

  it('adds the editlet label by default and says when labels fail', async () => {
    const fake = fakeWithEdit();
    fake.state.options.labelsFail = true;
    await openBranch(fake);
    fireEvent.click(await createButton());
    expect(await within(main()).findByText(/^Labels weren't added: /)).toBeDefined();
    expect(fake.state.pulls).toHaveLength(1);
  });

  it('names the code owners before the pull request', async () => {
    const fake = fakeWithEdit();
    fake.commit('main', { '.github/CODEOWNERS': '* @acme/admins\n/cms/content/ @acme/editors\n' });
    await openBranch(fake);
    expect(await within(main()).findByText('Needs approval from @acme/editors, @acme/admins on GitHub.')).toBeDefined();
  });

  it('shows the reviewers of an open pull request', async () => {
    const fake = fakeWithEdit();
    fake.state.pulls.push({
      number: 1,
      title: 'T',
      body: '',
      draft: false,
      head: 'editlet/edit',
      base: 'main',
      state: 'open',
      review: { decision: 'REVIEW_REQUIRED', requested: ['@acme/editors'], approved: ['bob'] },
    });
    await openBranch(fake);
    expect((await within(main()).findByTestId('reviewers')).textContent).toBe(
      'Approved by @bob · Waiting for @acme/editors',
    );
  });

  it('collapses the other files for an editor', async () => {
    await openBranch(fakeWithEdit());
    const summary = await within(main()).findByText('Other files this merge brings in (1)');
    expect(summary.closest('details')?.open).toBe(false);
    expect(screen.getByText('Editor')).toBeDefined();
  });

  it('keeps the other files open for an admin', async () => {
    const admin = createAdminFakeGitHub({ admin: true });
    admin.state.refs.set('editlet/edit', admin.state.refs.get('main')!);
    admin.commit('editlet/edit', { 'src/foo.ts': 'x\n' });
    await openBranch(admin);
    expect(await within(main()).findByRole('heading', { name: 'Other files this merge brings in' })).toBeDefined();
    expect(screen.getByText('Admin')).toBeDefined();
  });

  it('follows git.branchPrefix of the base schema', async () => {
    const fake = createAdminFakeGitHub();
    withStyle(fake, { branchPrefix: 'cms/' }, ['main']);
    fake.state.refs.set('cms/edit', fake.state.refs.get('main')!);
    fake.commit('cms/edit', { [ENTRY]: fileAt(fake, 'main', ENTRY).replace('title: Hello world', 'title: Edited') });
    await openBranch(fake);
    expect(await within(main()).findByRole('heading', { name: 'cms/edit' })).toBeDefined();
    expect(await createButton()).toBeDefined();
  });
});
