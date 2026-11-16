// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { triggerDeployHook } from './deploy.ts';
import { createGitHubSource } from './source.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});
const FILES: Record<string, FileInput> = { 'cms/schema.json': SCHEMA };

function setup() {
  const fake = createFakeGitHub({ branches: { main: FILES, 'editlet/edit': FILES } });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  const source = createGitHubSource({
    owner: 'o',
    repo: 'r',
    branch: 'editlet/edit',
    client,
    cache: createMemoryCache(),
  });
  return { fake, source };
}

const dep = (id: number, sha: string, ref: string) => ({
  id,
  sha,
  ref,
  environment: 'Preview',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:01:00Z',
});

describe('latestDeployment', () => {
  it('finds the latest deployment by head sha with environment_url', async () => {
    const { fake, source } = setup();
    const head = fake.state.refs.get('editlet/edit')!;
    fake.state.deployments.push(dep(2, head, head), dep(1, head, head));
    fake.state.deploymentStatuses.set(2, [
      { state: 'success', environment_url: 'https://x.vercel.app', log_url: 'https://log', created_at: 't' },
      { state: 'in_progress', created_at: 't0' },
    ]);
    expect(await source.latestDeployment()).toEqual({
      id: 2,
      sha: head,
      ref: head,
      environment: 'Preview',
      state: 'success',
      url: 'https://x.vercel.app',
      logUrl: 'https://log',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:01:00Z',
    });
  });

  it('falls back to the ref query', async () => {
    const { fake, source } = setup();
    const head = fake.state.refs.get('editlet/edit')!;
    fake.state.deployments.push(dep(5, 'other', 'editlet/edit'));
    fake.state.deploymentStatuses.set(5, [{ state: 'failure', created_at: 't' }]);
    const found = await source.latestDeployment();
    expect(found).toMatchObject({ id: 5, state: 'failure', url: null, logUrl: null });
    const urls = fake.calls.map((c) => c.url);
    expect(urls.some((u) => u.includes(`deployments?sha=${head}`))).toBe(true);
    expect(
      urls.some((u) => u.includes('deployments?ref=editlet%2Fedit') || u.includes('deployments?ref=editlet/edit')),
    ).toBe(true);
  });

  it('uses the given ref (the base branch)', async () => {
    const { fake, source } = setup();
    const main = fake.state.refs.get('main')!;
    fake.state.deployments.push(dep(9, main, main));
    expect((await source.latestDeployment('main'))?.id).toBe(9);
  });

  it('no statuses -> pending', async () => {
    const { fake, source } = setup();
    const head = fake.state.refs.get('editlet/edit')!;
    fake.state.deployments.push(dep(3, head, head));
    expect(await source.latestDeployment()).toMatchObject({ id: 3, state: 'pending', url: null });
  });

  it('none -> null', async () => {
    const { source } = setup();
    expect(await source.latestDeployment()).toBeNull();
  });
});

describe('triggerDeployHook', () => {
  const URL_ = 'https://api.vercel.com/v1/integrations/deploy/prj/abc';

  it('posts with no headers and no body', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 201 }));
    expect(await triggerDeployHook(URL_, { fetch })).toEqual({ ok: true, status: 201 });
    expect(fetch).toHaveBeenCalledWith(URL_, { method: 'POST' });
  });

  it('reports a failing response', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 500 }));
    expect(await triggerDeployHook(URL_, { fetch })).toEqual({ ok: false, status: 500 });
  });

  it('CORS / network rejection -> nulls', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await triggerDeployHook(URL_, { fetch })).toEqual({ ok: null, status: null });
  });

  it('non-https throws and sends nothing', async () => {
    const fetch = vi.fn();
    await expect(triggerDeployHook('http://example.com/h', { fetch })).rejects.toThrow('Deploy hook URL must be https');
    expect(fetch).not.toHaveBeenCalled();
  });
});
