// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});
const FILES: Record<string, FileInput> = {
  'cms/schema.json': SCHEMA,
  'cms/content/post/hello.md': '---\ntitle: Hello\n---\n',
};
const HOOK = 'https://api.vercel.com/v1/integrations/deploy/prj_x/abc';

function setup() {
  const fake = createFakeGitHub({ branches: { main: FILES, 'editlet/edit': FILES } });
  fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Edited\n---\n' });
  const sleep = vi.fn(async (_ms: number) => undefined);
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch, sleep });
  const source = createGitHubSource({
    owner: 'o',
    repo: 'r',
    branch: 'editlet/edit',
    client,
    cache: createMemoryCache(),
  });
  const merges = () => fake.calls.filter((c) => c.method === 'PUT' && c.url.endsWith('/merge'));
  /** The head the editor reviewed: the current branch head. */
  const reviewed = () => fake.state.refs.get('editlet/edit')!;
  return { fake, source, sleep, merges, reviewed };
}

describe('publish', () => {
  it('merges a clean PR, deletes the branch, base gets the content', async () => {
    const { fake, source, reviewed } = setup();
    const head = fake.state.refs.get('editlet/edit')!;
    const result = await source.publish({ headOid: reviewed() });
    expect(result).toMatchObject({
      status: 'merged',
      branchDeleted: true,
      pullRequest: { title: 'Publish editlet/edit' },
    });
    if (result.status !== 'merged') throw new Error('unreachable');
    expect(result.mergeOid).toBe(fake.state.refs.get('main'));
    expect(fake.state.refs.has('editlet/edit')).toBe(false);
    const mainFiles = fake.state.commits.get(fake.state.refs.get('main')!)!.files;
    expect(mainFiles.get('cms/content/post/hello.md')).toBe(
      fake.state.commits.get(head)!.files.get('cms/content/post/hello.md'),
    );
  });

  it('opens the PR when missing, reuses it when present', async () => {
    const { fake, source, reviewed } = setup();
    expect(fake.state.pulls).toHaveLength(0);
    await source.publish({ title: 'Ship it', headOid: reviewed() });
    expect(fake.state.pulls).toHaveLength(1);
    expect(fake.state.pulls[0]!.title).toBe('Ship it');

    const second = setup();
    const pr = await second.source.openPullRequest({ title: 'Existing' });
    const result = await second.source.publish({ headOid: second.reviewed() });
    expect(second.fake.state.pulls).toHaveLength(1);
    expect(result).toMatchObject({ status: 'merged', pullRequest: { number: pr.number, title: 'Existing' } });
  });

  it('sends the reviewed head sha and the merge method', async () => {
    const { fake, source, reviewed } = setup();
    const head = reviewed();
    const seen: unknown[] = [];
    const orig = fake.fetch;
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PUT') seen.push(JSON.parse(String(init.body)));
      return orig(input, init);
    }) as typeof fetch;
    const client = createGitHubClient({ token: 'tok', fetch: spy });
    const s = createGitHubSource({ owner: 'o', repo: 'r', branch: 'editlet/edit', client, cache: createMemoryCache() });
    await s.publish({ mergeMethod: 'squash', deleteBranch: false, headOid: head });
    expect(seen).toEqual([{ merge_method: 'squash', sha: head }]);
    expect(fake.state.refs.has('editlet/edit')).toBe(true);
    void source;
  });

  describe('blocked states never call merge', () => {
    it.each([
      ['BLOCKED', 'protected'],
      ['BEHIND', 'behind'],
      ['DIRTY', 'conflict'],
      ['DRAFT', 'protected'],
      ['SOMETHING_NEW', 'protected'],
    ])('%s -> %s', async (mergeState, reason) => {
      const { fake, source, merges, reviewed } = setup();
      await source.openPullRequest({ title: 'T' });
      fake.state.mergeStates.set(1, [mergeState]);
      const result = await source.publish({ headOid: reviewed() });
      expect(result).toMatchObject({
        status: 'blocked',
        reason,
        pullRequest: { url: 'https://github.com/o/r/pull/1' },
      });
      expect(merges()).toHaveLength(0);
      expect(fake.state.refs.has('editlet/edit')).toBe(true);
    });

    it.each(['CLEAN', 'HAS_HOOKS', 'UNSTABLE'])('%s merges', async (mergeState) => {
      const { fake, source, merges, reviewed } = setup();
      await source.openPullRequest({ title: 'T' });
      fake.state.mergeStates.set(1, [mergeState]);
      expect((await source.publish({ headOid: reviewed() })).status).toBe('merged');
      expect(merges()).toHaveLength(1);
    });
  });

  it('unknown polls then pending', async () => {
    const { fake, source, sleep, merges, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.mergeStates.set(1, ['UNKNOWN']);
    const result = await source.publish({ headOid: reviewed() });
    expect(result).toMatchObject({ status: 'blocked', reason: 'pending' });
    expect(sleep).toHaveBeenCalledTimes(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 3000, 4000, 5000]);
    expect(merges()).toHaveLength(0);
  });

  it('unknown that settles merges', async () => {
    const { fake, source, sleep, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.mergeStates.set(1, ['UNKNOWN', 'UNKNOWN', 'CLEAN']);
    expect((await source.publish({ headOid: reviewed() })).status).toBe('merged');
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('draft is marked ready first', async () => {
    const { fake, source, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.pulls[0]!.draft = true;
    const result = await source.publish({ headOid: reviewed() });
    expect(result.status).toBe('merged');
    expect(fake.calls.filter((c) => c.operation === 'Ready')).toHaveLength(1);
    expect(fake.state.pulls[0]!.draft).toBe(false);
  });

  it('reviewed head mismatch is stale and not merged', async () => {
    const { fake, source, merges, reviewed } = setup();
    const head = reviewed();
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Newer\n---\n' });
    const result = await source.publish({ headOid: head });
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale' });
    expect(merges()).toHaveLength(0);
  });

  it('a stale head on a draft PR is stale before the PR is marked ready', async () => {
    const { fake, source, merges, reviewed } = setup();
    const head = reviewed();
    await source.openPullRequest({ title: 'T' });
    fake.state.pulls[0]!.draft = true;
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Unreviewed\n---\n' });
    const result = await source.publish({ headOid: head });
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale' });
    expect(fake.calls.filter((c) => c.operation === 'Ready')).toHaveLength(0);
    expect(fake.state.pulls[0]!.draft).toBe(true);
    expect(merges()).toHaveLength(0);
  });

  it('a head that moves while the merge state is pending is stale', async () => {
    const { fake, source, merges, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.mergeStates.set(1, ['UNKNOWN', 'CLEAN']);
    const head = reviewed();
    const original = fake.graphqlOps.PullState!;
    let n = 0;
    fake.graphqlOps.PullState = (v, q) => {
      if (n++ === 1) fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Late\n---\n' });
      return original(v, q);
    };
    const result = await source.publish({ headOid: head });
    expect(result).toMatchObject({ status: 'blocked', reason: 'stale' });
    expect(merges()).toHaveLength(0);
  });

  it('publish from a non-cms branch is invalid_branch and touches nothing', async () => {
    const fake = createFakeGitHub({ branches: { main: FILES, develop: FILES } });
    fake.commit('develop', { 'src/app.ts': 'unreviewed' });
    const client = createGitHubClient({ token: 'tok', fetch: fake.fetch, sleep: async () => undefined });
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'develop', client, cache: createMemoryCache() });
    const headOid = fake.state.refs.get('develop')!;
    await expect(source.publish({ headOid })).rejects.toMatchObject({ code: 'invalid_branch' });
    await expect(source.openPullRequest({ title: 'x' })).rejects.toMatchObject({ code: 'invalid_branch' });
    expect(fake.calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false);
    expect(fake.calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(fake.state.pulls).toHaveLength(0);
  });

  it('405 from merge is protected with the message', async () => {
    const { fake, source, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.mergeFail.set(1, 405);
    expect(await source.publish({ headOid: reviewed() })).toMatchObject({
      status: 'blocked',
      reason: 'protected',
      message: 'Pull Request is not mergeable',
    });
    expect(fake.state.refs.has('editlet/edit')).toBe(true);
  });

  it('409 from merge is stale', async () => {
    const { fake, source, reviewed } = setup();
    await source.openPullRequest({ title: 'T' });
    fake.state.mergeFail.set(1, 409);
    expect(await source.publish({ headOid: reviewed() })).toMatchObject({ status: 'blocked', reason: 'stale' });
  });

  it('deploy hook runs after merge, never when blocked', async () => {
    const { fake, source, reviewed } = setup();
    const hook = vi.fn(async () => new Response('', { status: 201 }));
    vi.stubGlobal('fetch', hook);
    try {
      const result = await source.publish({ deployHookUrl: HOOK, headOid: reviewed() });
      expect(result).toMatchObject({ status: 'merged', deployHook: { ok: true, status: 201 } });
      expect(hook).toHaveBeenCalledWith(HOOK, { method: 'POST' });

      const blocked = setup();
      await blocked.source.openPullRequest({ title: 'T' });
      blocked.fake.state.mergeStates.set(1, ['BLOCKED']);
      hook.mockClear();
      await blocked.source.publish({ deployHookUrl: HOOK, headOid: blocked.reviewed() });
      expect(hook).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
    void fake;
  });

  it('a bad deploy hook url rejects before any side effect', async () => {
    for (const url of ['http://example.com/h', 'not a url']) {
      const { fake, source, merges, reviewed } = setup();
      await expect(source.publish({ deployHookUrl: url, headOid: reviewed() })).rejects.toThrow(
        new TypeError('Deploy hook URL must be https'),
      );
      expect(fake.calls.some((c) => c.method === 'POST' && c.url.endsWith('/pulls'))).toBe(false);
      expect(merges()).toHaveLength(0);
      expect(fake.state.pulls).toHaveLength(0);
    }
  });

  it('branch delete failure still reports merged', async () => {
    const { fake, source, reviewed } = setup();
    fake.restRoutes.unshift({
      method: 'DELETE',
      pattern: /^\/git\/refs\/heads\/.+$/,
      handle: () => new Response(JSON.stringify({ message: 'boom' }), { status: 500 }),
    });
    const result = await source.publish({ headOid: reviewed() });
    expect(result).toMatchObject({ status: 'merged', branchDeleted: false });
  });
});
