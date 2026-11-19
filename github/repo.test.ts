// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient, GitHubError } from './client.ts';
import { isEditletBranchName } from './index.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub, json, type FileInput } from './test/fakeGitHub.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});

const FILES: Record<string, FileInput> = {
  'cms/schema.json': SCHEMA,
  'cms/content/post/hello.md': '---\ntitle: Hello\n---\n',
  'cms/content/post/world.md': '---\ntitle: World\n---\n',
  'README.md': '# Site\n',
};

function setup(branches: Record<string, Record<string, FileInput>> = { main: FILES, 'editlet/edit': FILES }) {
  const fake = createFakeGitHub({ branches });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  const cache = createMemoryCache();
  const make = (branch: string) => createGitHubSource({ owner: 'o', repo: 'r', branch, client, cache });
  return { fake, make, source: make('editlet/edit') };
}

describe('listBranches', () => {
  it('returns cms branches with their open PR, paginated', async () => {
    const { fake, make } = setup({ main: FILES, 'editlet/a': FILES, 'editlet/b/c': FILES, 'feature/x': FILES });
    const source = make('editlet/a');
    fake.state.options.refsPageSize = 1;
    await source.openPullRequest({ title: 'A' });
    const branches = await source.listBranches();
    expect(branches.map((b) => b.name)).toEqual(['editlet/a', 'editlet/b/c']);
    expect(branches[0]).toMatchObject({
      headOid: fake.state.refs.get('editlet/a'),
      pullRequest: { title: 'A', isDraft: false, headOid: fake.state.refs.get('editlet/a') },
    });
    expect(branches[0]!.committedAt).toEqual(expect.any(String));
    expect(branches[1]!.pullRequest).toBeNull();
    expect(fake.calls.filter((c) => c.operation === 'Branches')).toHaveLength(2);
  });
});

describe('createBranch', () => {
  it('branches from the base head, then branch_exists', async () => {
    const { fake, source } = setup();
    const created = await source.createBranch('editlet/new/one');
    expect(created.branch).toBe('editlet/new/one');
    expect(fake.state.refs.get('editlet/new/one')).toBe(fake.state.refs.get('main'));
    await expect(source.createBranch('editlet/new/one')).rejects.toMatchObject({ code: 'branch_exists' });
  });

  it('isEditletBranchName is exported and matches what createBranch accepts', () => {
    expect(['editlet/a', 'editlet/home/edits', 'editlet/v1.2_x-y'].every((n) => isEditletBranchName(n))).toBe(true);
    expect(
      ['feature/x', 'editlet/', 'editlet/a..b', 'editlet/x.lock', 'editlet//x', 'editlet/-x', 'main'].some((n) =>
        isEditletBranchName(n),
      ),
    ).toBe(false);
  });

  it('rejects invalid names', async () => {
    const { source } = setup();
    for (const name of [
      'feature/x',
      'editlet/',
      'editlet/a..b',
      'editlet/x.lock',
      'editlet//x',
      'editlet/-x',
      'main',
    ]) {
      await expect(source.createBranch(name)).rejects.toMatchObject({ code: 'invalid_branch' });
    }
  });
});

describe('renameBranch', () => {
  it('moves the ref', async () => {
    const { fake, source } = setup();
    const head = fake.state.refs.get('editlet/edit');
    const renamed = await source.renameBranch('editlet/renamed');
    expect(renamed.branch).toBe('editlet/renamed');
    expect(fake.state.refs.has('editlet/edit')).toBe(false);
    expect(fake.state.refs.get('editlet/renamed')).toBe(head);
    await expect(source.renameBranch('feature/x')).rejects.toMatchObject({ code: 'invalid_branch' });
    await expect(renamed.renameBranch('main')).rejects.toMatchObject({ code: 'invalid_branch' });
  });

  it('refuses a non-cms current branch', async () => {
    const { make } = setup();
    await expect(make('main').renameBranch('editlet/x')).rejects.toMatchObject({ code: 'invalid_branch' });
  });

  it('branch_exists only for an "already exists" 422; other 422s rethrow', async () => {
    const { fake, source, make } = setup({ main: FILES, 'editlet/edit': FILES, 'editlet/taken': FILES });
    await expect(source.renameBranch('editlet/taken')).rejects.toMatchObject({ code: 'branch_exists' });
    fake.restRoutes.unshift({
      method: 'POST',
      pattern: /^\/branches\/.+\/rename$/,
      handle: () => json({ message: 'Validation Failed', errors: [{ message: 'Branch is protected' }] }, 422),
    });
    const err = await make('editlet/edit')
      .renameBranch('editlet/other')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err).toMatchObject({ code: 'http_error', status: 422, message: 'Validation Failed: Branch is protected' });
  });
});

describe('deleteBranch', () => {
  it('encodes segments and reports already gone', async () => {
    const { fake, make } = setup({ main: FILES, 'editlet/home/edits': FILES });
    const source = make('editlet/home/edits');
    expect(await source.deleteBranch()).toBe(true);
    expect(fake.calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/git/refs/heads/editlet/home/edits'))).toBe(
      true,
    );
    expect(fake.state.refs.has('editlet/home/edits')).toBe(false);
    expect(await source.deleteBranch()).toBe(false);
  });

  it('a 422 other than "does not exist" rethrows', async () => {
    const { fake, source } = setup();
    fake.restRoutes.unshift({
      method: 'DELETE',
      pattern: /^\/git\/refs\/heads\/.+$/,
      handle: () => json({ message: 'Cannot delete a protected branch' }, 422),
    });
    await expect(source.deleteBranch()).rejects.toMatchObject({ code: 'http_error', status: 422 });
    expect(fake.state.refs.has('editlet/edit')).toBe(true);
  });

  it('a 404 is already gone', async () => {
    const { fake, source } = setup();
    fake.restRoutes.unshift({ method: 'DELETE', pattern: /^\/git\/refs\/heads\/.+$/, handle: () => json({}, 404) });
    expect(await source.deleteBranch()).toBe(false);
  });

  it('refuses base and non-cms branches', async () => {
    const { make } = setup();
    await expect(make('main').deleteBranch()).rejects.toMatchObject({ code: 'invalid_branch' });
    await expect(make('feature/x').deleteBranch()).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('pull requests', () => {
  it('finds or creates, and handles already exists', async () => {
    const { fake, source } = setup();
    expect(await source.pullRequest()).toBeNull();
    const pr = await source.openPullRequest({ title: 'Edits', body: 'b' });
    expect(pr).toMatchObject({ title: 'Edits', isDraft: false, headOid: fake.state.refs.get('editlet/edit') });
    expect(pr.url).toContain('/pull/');
    expect(await source.pullRequest()).toEqual(pr);
    expect(await source.openPullRequest({ title: 'Other' })).toEqual(pr);
    expect(fake.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toHaveLength(1);
  });

  it('recovers when the PR appears between find and create', async () => {
    const { fake, source } = setup();
    const route = fake.restRoutes.find((r) => r.method === 'GET' && r.pattern.source.includes('pulls'))!;
    const original = route.handle;
    let first = true;
    route.handle = (req) => {
      if (first) {
        first = false;
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return original(req);
    };
    fake.state.pulls.push({
      number: 7,
      title: 'Raced',
      body: '',
      draft: false,
      head: 'editlet/edit',
      base: 'main',
      state: 'open',
    });
    expect(await source.openPullRequest({ title: 'Mine' })).toMatchObject({ number: 7, title: 'Raced' });
  });

  it('openPullRequest refuses a non-cms branch', async () => {
    const { fake, make } = setup({ main: FILES, develop: FILES });
    fake.commit('develop', { 'README.md': 'x' });
    await expect(make('develop').openPullRequest({ title: 'x' })).rejects.toMatchObject({ code: 'invalid_branch' });
    expect(fake.calls.some((c) => c.url.includes('/pulls'))).toBe(false);
  });

  it('no commits maps to no_changes', async () => {
    const { source } = setup({ main: FILES, 'editlet/edit': FILES });
    await source.createBranch('editlet/same');
    const same = source.withBranch('editlet/same');
    await expect(same.openPullRequest({ title: 'x' })).rejects.toMatchObject({ code: 'no_changes' });
  });
});

describe('compareFiles', () => {
  it('lists every path another branch changes against the base, from one REST compare', async () => {
    const { fake, make } = setup({ main: FILES, 'editlet/edit': FILES, 'editlet/other': FILES });
    fake.commit('editlet/other', {
      'cms/content/post/hello.md': '---\ntitle: Other\n---\n',
      'cms/content/post/world.md': null,
      'README.md': 'changed',
    });
    fake.commit('main', { 'other.txt': 'main moved' });
    const source = make('main');
    // Warm the snapshot: compareFiles itself reads no trees.
    await source.listFiles();
    const before = fake.calls.length;
    expect(await source.compareFiles('editlet/other')).toEqual({
      paths: ['README.md', 'cms/content/post/hello.md', 'cms/content/post/world.md'],
      complete: true,
    });
    const calls = fake.calls.slice(before);
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe('/repos/o/r/compare/main...editlet/other');
  });

  it('a rename lists the new and the old path', async () => {
    const { fake, source } = setup();
    fake.restRoutes.unshift({
      method: 'GET',
      pattern: /^\/compare\/.+$/,
      handle: () =>
        json({
          files: [
            {
              filename: 'cms/content/post/new-slug.md',
              previous_filename: 'cms/content/post/hello.md',
              status: 'renamed',
            },
            { filename: 'cms/content/post/world.md', status: 'modified' },
          ],
        }),
    });
    expect((await source.compareFiles('editlet/edit')).paths).toEqual([
      'cms/content/post/hello.md',
      'cms/content/post/new-slug.md',
      'cms/content/post/world.md',
    ]);
  });

  it('drops unchanged entries and flags a capped list', async () => {
    const { fake, source } = setup();
    const filler = Array.from({ length: 300 }, (_, i) => ({ filename: `pad/${i}.txt`, status: 'added' }));
    fake.restRoutes.unshift({
      method: 'GET',
      pattern: /^\/compare\/.+$/,
      handle: () => json({ files: [{ filename: 'a.md', status: 'unchanged' }, ...filler] }),
    });
    const result = await source.compareFiles('editlet/edit');
    expect(result.complete).toBe(false);
    expect(result.paths).toHaveLength(300);
    expect(result.paths).not.toContain('a.md');
  });
});

describe('compare', () => {
  it('lists added, modified and removed CMS files and ignores the rest', async () => {
    const { fake, source } = setup();
    const merge = fake.state.refs.get('main')!;
    fake.commit('editlet/edit', {
      'cms/content/post/hello.md': '---\ntitle: Changed\n---\n',
      'cms/content/post/new.md': '---\ntitle: New\n---\n',
      'cms/content/post/world.md': null,
      'cms/content/post/.hidden.md': 'x',
      'README.md': 'changed',
    });
    fake.commit('main', { 'other.txt': 'main moved' });
    const diff = await source.compare();
    expect(diff).toMatchObject({
      status: 'diverged',
      aheadBy: 2,
      behindBy: 1,
      mergeBaseOid: merge,
      headOid: fake.state.refs.get('editlet/edit'),
    });
    const sha = (branch: string, p: string) => fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(p)!;
    const baseSha = (p: string) => fake.state.commits.get(merge)!.files.get(p)!;
    expect(diff.files).toEqual([
      {
        path: 'cms/content/post/hello.md',
        status: 'modified',
        sha: sha('editlet/edit', 'cms/content/post/hello.md'),
        baseSha: baseSha('cms/content/post/hello.md'),
      },
      {
        path: 'cms/content/post/new.md',
        status: 'added',
        sha: sha('editlet/edit', 'cms/content/post/new.md'),
        baseSha: null,
      },
      {
        path: 'cms/content/post/world.md',
        status: 'removed',
        sha: null,
        baseSha: baseSha('cms/content/post/world.md'),
      },
    ]);
    expect(diff.otherFiles).toEqual([
      { path: 'README.md', status: 'modified' },
      { path: 'cms/content/post/.hidden.md', status: 'added' },
    ]);
    expect(diff.complete).toBe(true);
  });

  it('lists non-CMS changes a merge would bring in', async () => {
    const { fake, source } = setup();
    fake.commit('editlet/edit', { 'src/app.ts': 'export {};\n', 'cms/content/post/hello.md': '---\ntitle: H2\n---\n' });
    const diff = await source.compare();
    expect(diff.files.map((f) => f.path)).toEqual(['cms/content/post/hello.md']);
    expect(diff.otherFiles).toEqual([{ path: 'src/app.ts', status: 'added' }]);
    expect(diff.complete).toBe(true);
  });

  it('maps GitHub statuses and flags a capped file list', async () => {
    const { fake, source } = setup();
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: H2\n---\n' });
    const mergeBase = fake.state.refs.get('main')!;
    const extra = ['renamed', 'copied', 'changed', 'unchanged', 'removed'].map((status, i) => ({
      filename: `src/f${i}.ts`,
      status,
    }));
    const filler = Array.from({ length: 300 }, (_, i) => ({ filename: `pad/${i}.txt`, status: 'added' }));
    fake.restRoutes.unshift({
      method: 'GET',
      pattern: /^\/compare\/.+$/,
      handle: () =>
        json({
          status: 'ahead',
          ahead_by: 1,
          behind_by: 0,
          merge_base_commit: { sha: mergeBase },
          files: [{ filename: 'cms/content/post/hello.md', status: 'modified' }, ...extra, ...filler],
        }),
    });
    const diff = await source.compare();
    expect(diff.complete).toBe(false);
    expect(diff.files.map((f) => f.path)).toEqual(['cms/content/post/hello.md']);
    expect(diff.otherFiles.filter((f) => f.path.startsWith('src/'))).toEqual([
      { path: 'src/f0.ts', status: 'renamed' },
      { path: 'src/f1.ts', status: 'modified' },
      { path: 'src/f2.ts', status: 'modified' },
      { path: 'src/f4.ts', status: 'removed' },
    ]);
  });

  it('is identical with no files for a fresh branch', async () => {
    const { source } = setup({ main: FILES, 'editlet/edit': FILES });
    const same = await source.createBranch('editlet/same');
    expect(await same.compare()).toMatchObject({
      status: 'identical',
      aheadBy: 0,
      behindBy: 0,
      files: [],
      otherFiles: [],
      complete: true,
    });
  });
});

const withPrefix = (prefix: string) =>
  JSON.stringify({ ...JSON.parse(SCHEMA), git: { baseBranch: 'main', branchPrefix: prefix } });
const files = (prefix: string) => ({ ...FILES, 'cms/schema.json': withPrefix(prefix) });
const block = (n: number) => `<!-- editlet:start -->\n${n}\n<!-- editlet:end -->`;

describe('branch prefix', () => {
  it('reads git.branchPrefix from the schema, else editlet/', async () => {
    const { make } = setup({ main: files('site/'), 'site/a': files('site/'), 'editlet/b': FILES });
    expect(await make('main').branchPrefix()).toBe('site/');
    expect((await make('main').listBranches()).map((b) => b.name)).toEqual(['site/a']);
    await expect(make('main').createBranch('editlet/x')).rejects.toMatchObject({ code: 'invalid_branch' });
    expect((await make('main').createBranch('site/x')).branch).toBe('site/x');
    expect(await setup().make('main').branchPrefix()).toBe('editlet/');
  });

  it('takes the branchPrefix option over the schema', async () => {
    const { fake } = setup({ main: FILES, 'cms/a': FILES, 'editlet/b': FILES });
    const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, branchPrefix: 'cms/' });
    expect((await source.listBranches()).map((b) => b.name)).toEqual(['cms/a']);
    const { issues } = await source
      .withBranch('editlet/b')
      .commit([{ path: 'cms/content/post/x.md', content: 'x' }], 'X');
    expect(issues[0]?.message).toBe('Commits must go to a branch named cms/*, not "editlet/b"');
  });
});

describe('pull request style', () => {
  it('opens a draft and adds the labels', async () => {
    const { fake, source } = setup();
    const pr = await source.openPullRequest({ title: 'T', body: 'B', draft: true, labels: ['editlet', 'content'] });
    expect(pr).toMatchObject({ isDraft: true });
    expect(pr.labelError).toBeUndefined();
    expect(fake.state.pulls[0]).toMatchObject({ draft: true, body: 'B', labels: ['editlet', 'content'] });
  });

  it('keeps the pull request when the labels fail', async () => {
    const { fake, source } = setup();
    fake.state.options.labelsFail = true;
    const pr = await source.openPullRequest({ title: 'T', labels: ['editlet'] });
    expect(pr.number).toBe(1);
    expect(pr.labelError).toContain('Resource not accessible');
    expect(fake.state.pulls).toHaveLength(1);
  });

  it('adds no labels to a pull request it finds', async () => {
    const { fake, source } = setup();
    await source.openPullRequest({ title: 'T' });
    await source.openPullRequest({ title: 'T', labels: ['editlet'] });
    expect(fake.state.pulls[0]!.labels).toBeUndefined();
    expect(fake.calls.some((c) => c.url.includes('/labels'))).toBe(false);
  });

  it('refreshes only the Editlet part of the body', async () => {
    const { fake, source } = setup();
    expect(await source.refreshPullRequestBody('x')).toBe('none');
    await source.openPullRequest({ title: 'T', body: block(1) });
    fake.state.pulls[0]!.body = `Human note\n\n${block(1)}`;
    expect(await source.refreshPullRequestBody(block(2))).toBe('updated');
    expect(fake.state.pulls[0]!.body).toBe(`Human note\n\n${block(2)}`);
    expect(await source.refreshPullRequestBody(block(2))).toBe('unchanged');
    fake.state.pulls[0]!.body = 'Mine now';
    expect(await source.refreshPullRequestBody(block(3))).toBe('unchanged');
    expect(fake.state.pulls[0]!.body).toBe('Mine now');
  });

  it('reads the review state', async () => {
    const { fake, source } = setup();
    const pr = await source.openPullRequest({ title: 'T' });
    fake.state.pulls[0]!.review = {
      decision: 'REVIEW_REQUIRED',
      requested: ['@acme/admins', '@bob'],
      approved: ['carol'],
    };
    expect(await source.pullRequestReview(pr.number)).toEqual({
      decision: 'REVIEW_REQUIRED',
      requested: ['@acme/admins', '@bob'],
      approvedBy: ['carol'],
      changesRequestedBy: [],
    });
    expect(await source.pullRequestReview(99)).toBeNull();
  });
});

describe('branch and pull request errors', () => {
  const broken = { main: FILES, 'editlet/edit': { ...FILES, 'cms/schema.json': '{' } };

  it('createBranch rethrows a 422 that is not "already exists"', async () => {
    const { fake, source } = setup();
    fake.restRoutes.unshift({
      method: 'POST',
      pattern: /^\/git\/refs$/,
      handle: () => json({ message: 'Reference update failed' }, 422),
    });
    await expect(source.createBranch('editlet/new')).rejects.toMatchObject({ code: 'http_error', status: 422 });
    expect(fake.state.refs.has('editlet/new')).toBe(false);
  });

  it('createBranch needs the base branch: a broken schema rejects not_found', async () => {
    const { source } = setup(broken);
    await expect(source.createBranch('editlet/new')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('rename and delete still work on a branch whose schema is broken (no base to protect)', async () => {
    const { fake, source } = setup(broken);
    const renamed = await source.renameBranch('editlet/fixing');
    expect(fake.state.refs.has('editlet/fixing')).toBe(true);
    expect(await renamed.deleteBranch()).toBe(true);
    expect(fake.state.refs.has('editlet/fixing')).toBe(false);
  });

  it('openPullRequest rethrows when the "already exists" pull request cannot be found, and other errors', async () => {
    const { fake, source } = setup();
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Edited\n---\n' });
    fake.restRoutes.unshift({
      method: 'POST',
      pattern: /^\/pulls$/,
      handle: () => json({ message: 'Validation Failed', errors: [{ message: 'A pull request already exists' }] }, 422),
    });
    await expect(source.openPullRequest({ title: 'T' })).rejects.toMatchObject({ code: 'http_error', status: 422 });

    fake.restRoutes[0] = {
      method: 'POST',
      pattern: /^\/pulls$/,
      handle: () => json({ message: 'Validation Failed', errors: [{ message: 'Head sha is invalid' }] }, 422),
    };
    await expect(source.openPullRequest({ title: 'T' })).rejects.toMatchObject({ status: 422 });

    fake.restRoutes[0] = { method: 'POST', pattern: /^\/pulls$/, handle: () => json({ message: 'Boom' }, 500) };
    await expect(source.openPullRequest({ title: 'T' })).rejects.toBeInstanceOf(GitHubError);
    expect(fake.state.pulls).toHaveLength(0);
  });
});
