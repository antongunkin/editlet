import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';

import { activeBranchKey, useBranches, useWorkspace, WorkspaceProvider } from './workspace';

import { createMemorySource } from '../../../core/source';
import { createGitHubClient } from '../../../github';
import { useCommit, useFiles } from '../data/queries';
import { SourceProvider, useSource } from '../source/context';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { createTestQueryClient } from '../test/render';

const CONFIG = { owner: 'o', repo: 'r', baseBranch: 'main' };
const KEY = activeBranchKey('o', 'r');

type Fake = ReturnType<typeof createAdminFakeGitHub>;

/** A `editlet/*` branch off main's head, optionally with one more commit. */
function branchOff(fake: Fake, name: string, files?: Record<string, string>) {
  fake.state.refs.set(name, fake.state.refs.get('main')!);
  if (files) fake.commit(name, files);
}

function setup(fake = createAdminFakeGitHub()) {
  const queryClient: QueryClient = createTestQueryClient();
  const client = createGitHubClient({ token: 'test', fetch: fake.fetch });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider config={CONFIG} client={client} storage={window.localStorage}>
        {children}
      </WorkspaceProvider>
    </QueryClientProvider>
  );
  return { fake, queryClient, wrapper };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('workspace', () => {
  it('stores the active branch under the namespaced per-repo key', () => {
    expect(KEY).toBe('editlet:branch:o/r');
  });

  it('is null outside a provider', () => {
    const { result } = renderHook(() => useWorkspace());
    expect(result.current).toBeNull();
  });

  it('defaults to the base branch and provides its source', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => ({ ws: useWorkspace()!, source: useSource() }), { wrapper });
    expect(result.current.ws.base).toBe('main');
    expect(result.current.ws.active).toBe('main');
    expect(result.current.ws.onBase).toBe(true);
    expect(result.current.ws.source.branch).toBe('main');
    expect(result.current.source).toBe(result.current.ws.source);
    expect(result.current.ws.fallbackNotice).toBeNull();
    expect(result.current.ws.restoring).toBe(false);
  });

  it('memoises one source per branch', () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkspace()!, { wrapper });
    const x = result.current.sourceFor('editlet/x');
    expect(x.branch).toBe('editlet/x');
    expect(result.current.sourceFor('editlet/x')).toBe(x);
    expect(result.current.sourceFor('main')).toBe(result.current.source);
  });

  it('switchTo persists the branch and rebinds the source', async () => {
    const fake = createAdminFakeGitHub();
    branchOff(fake, 'editlet/x');
    const { wrapper } = setup(fake);
    const { result } = renderHook(() => ({ ws: useWorkspace()!, source: useSource() }), { wrapper });
    act(() => result.current.ws.switchTo('editlet/x'));
    expect(result.current.ws.restoring).toBe(false);
    expect(window.localStorage.getItem(KEY)).toBe('editlet/x');
    expect(result.current.ws.active).toBe('editlet/x');
    expect(result.current.ws.onBase).toBe(false);
    expect(result.current.ws.source.branch).toBe('editlet/x');
    expect(result.current.source).toBe(result.current.ws.source);
  });

  it('restores a stored branch that still exists', async () => {
    const fake = createAdminFakeGitHub();
    branchOff(fake, 'editlet/kept');
    window.localStorage.setItem(KEY, 'editlet/kept');
    const { wrapper } = setup(fake);
    const { result } = renderHook(() => ({ ws: useWorkspace()!, branches: useBranches() }), { wrapper });
    expect(result.current.ws.active).toBe('editlet/kept');
    expect(result.current.ws.restoring).toBe(true);
    await waitFor(() => expect(result.current.ws.restoring).toBe(false));
    expect(result.current.branches.data!.map((b) => b.name)).toEqual(['editlet/kept']);
    expect(result.current.ws.active).toBe('editlet/kept');
    expect(result.current.ws.fallbackNotice).toBeNull();
  });

  it('ignores a stored value that is not a CMS branch', () => {
    window.localStorage.setItem(KEY, 'feature/other');
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkspace()!, { wrapper });
    expect(result.current.active).toBe('main');
  });

  it('createBranch creates the ref from the base head and makes it active', async () => {
    const { fake, wrapper } = setup();
    const { result } = renderHook(() => ({ ws: useWorkspace()!, branches: useBranches() }), { wrapper });
    await waitFor(() => expect(result.current.branches.data).toEqual([]));
    let created: Awaited<ReturnType<typeof result.current.ws.createBranch>> | undefined;
    await act(async () => {
      created = await result.current.ws.createBranch('editlet/new');
    });
    expect(fake.state.refs.get('editlet/new')).toBe(fake.state.refs.get('main'));
    expect(created!.branch).toBe('editlet/new');
    expect(result.current.ws.active).toBe('editlet/new');
    expect(result.current.ws.source).toBe(created);
    expect(window.localStorage.getItem(KEY)).toBe('editlet/new');
    await waitFor(() => expect(result.current.branches.data?.map((b) => b.name)).toEqual(['editlet/new']));
  });

  it('falls back to base when the stored branch is gone', async () => {
    window.localStorage.setItem(KEY, 'editlet/gone');
    const { wrapper } = setup();
    const { result } = renderHook(() => useWorkspace()!, { wrapper });
    expect(result.current.active).toBe('editlet/gone');
    expect(result.current.restoring).toBe(true);
    await waitFor(() => expect(result.current.active).toBe('main'));
    expect(result.current.restoring).toBe(false);
    expect(result.current.onBase).toBe(true);
    expect(result.current.fallbackNotice).toBe('Branch editlet/gone no longer exists. Showing main.');
    expect(window.localStorage.getItem(KEY)).toBe('main');
  });

  it('stops restoring when the branch listing fails', async () => {
    window.localStorage.setItem(KEY, 'editlet/gone');
    const fake = createAdminFakeGitHub();
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === 'string' ? init.body : '';
      if (body.includes('query Branches')) return Response.json({ message: 'Server Error' }, { status: 500 });
      return fake.fetch(input, init);
    }) as typeof fetch;
    const { wrapper } = setup({ ...fake, fetch: failing });
    const { result } = renderHook(() => useWorkspace()!, { wrapper });
    expect(result.current.restoring).toBe(true);
    await waitFor(() => expect(result.current.restoring).toBe(false));
    expect(result.current.active).toBe('editlet/gone');
    expect(result.current.fallbackNotice).toBeNull();
  });

  it('keys the file list per branch', async () => {
    const fake = createAdminFakeGitHub();
    branchOff(fake, 'editlet/x', { 'cms/content/post/extra.md': '---\ntitle: Extra\n---\n' });
    const { queryClient, wrapper } = setup(fake);
    const { result } = renderHook(() => ({ ws: useWorkspace()!, files: useFiles() }), { wrapper });
    await waitFor(() => expect(result.current.files.data).toBeDefined());
    expect(queryClient.getQueryCache().find({ queryKey: ['files', 'main'] })).toBeDefined();
    const mainPaths = result.current.files.data!.map((f) => f.path);
    expect(mainPaths).not.toContain('cms/content/post/extra.md');

    act(() => result.current.ws.switchTo('editlet/x'));
    await waitFor(() => expect(result.current.files.data?.map((f) => f.path)).toContain('cms/content/post/extra.md'));
    expect(queryClient.getQueryCache().find({ queryKey: ['files', 'editlet/x'] })).toBeDefined();
    expect(queryClient.getQueryCache().find({ queryKey: ['files', 'main'] })?.state.data).toBeDefined();
  });

  it('useCommit with newBranch creates the branch from main, switches, and commits there', async () => {
    const { fake, wrapper } = setup();
    const mainHead = fake.state.refs.get('main');
    const { result } = renderHook(() => ({ ws: useWorkspace()!, commit: useCommit() }), { wrapper });
    await act(() =>
      result.current.commit.mutateAsync({
        changes: [{ path: 'cms/content/post/new.md', content: '---\ntitle: New\n---\n' }],
        message: 'Add post',
        newBranch: 'editlet/post-new',
      }),
    );
    expect(fake.state.refs.get('main')).toBe(mainHead);
    const head = fake.state.commits.get(fake.state.refs.get('editlet/post-new')!)!;
    expect(head.parent).toBe(mainHead);
    expect(head.files.has('cms/content/post/new.md')).toBe(true);
    expect(result.current.ws.active).toBe('editlet/post-new');
  });
});

describe('useCommit without a workspace', () => {
  it('rejects newBranch', async () => {
    const queryClient = createTestQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <SourceProvider source={createMemorySource({})}>{children}</SourceProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCommit(), { wrapper });
    await expect(
      act(() => result.current.mutateAsync({ changes: [], message: 'x', newBranch: 'editlet/x' })),
    ).rejects.toThrow(/workspace/i);
  });
});
