// useBranchDiff over a stubbed workspace and file list: one key per head, no diff from another branch, failures.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { branchDiffKey, useBranchDiff } from './branchDiff';

import type { BranchDiff } from '../../../github';

type Source = { branch: string; head(): Promise<string>; compare(): Promise<BranchDiff> };

const state = vi.hoisted(() => ({
  workspace: null as { active: string; onBase: boolean; source: Source } | null,
  filesAt: 1,
}));

vi.mock('../github/workspace', () => ({ useWorkspace: () => state.workspace }));
vi.mock('../data/queries', () => ({
  useFiles: () => ({ data: [], dataUpdatedAt: state.filesAt, isError: false }),
}));

const diffAt = (headOid: string, paths: string[]): BranchDiff => ({
  status: 'ahead',
  aheadBy: 1,
  behindBy: 0,
  mergeBaseOid: 'base',
  headOid,
  files: paths.map((path) => ({ path, status: 'modified', sha: 's', baseSha: 'b' })),
  otherFiles: [],
  complete: true,
});

/** A source on `branch` at `head`, whose compare answers `diff` (or throws). */
function source(branch: string, head: string, diff: BranchDiff | Error) {
  const compare = vi.fn(async () => {
    if (diff instanceof Error) throw diff;
    return diff;
  });
  return { branch, head: async () => head, compare } satisfies Source;
}

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.filesAt = 1;
});

describe('useBranchDiff', () => {
  it('nothing on the base branch: no head read, no compare', async () => {
    const src = source('main', 'h1', diffAt('h1', ['a.md']));
    state.workspace = { active: 'main', onBase: true, source: src };
    const { result } = renderHook(() => useBranchDiff(), { wrapper });
    expect(result.current).toEqual({ diff: undefined, headOid: undefined, current: false, failed: false });
    expect(src.compare).not.toHaveBeenCalled();
  });

  it('loads the diff of the head and marks it current', async () => {
    const src = source('editlet/a', 'h1', diffAt('h1', ['a.md']));
    state.workspace = { active: 'editlet/a', onBase: false, source: src };
    const { result } = renderHook(() => useBranchDiff(), { wrapper });
    await waitFor(() => expect(result.current.current).toBe(true));
    expect(result.current.headOid).toBe('h1');
    expect(result.current.diff?.files.map((f) => f.path)).toEqual(['a.md']);
    expect(client.getQueryData(branchDiffKey('editlet/a', 'h1'))).toBeDefined();
  });

  it('a switch to another branch never shows the first branch’s diff', async () => {
    const a = source('editlet/a', 'h1', diffAt('h1', ['a.md']));
    state.workspace = { active: 'editlet/a', onBase: false, source: a };
    const { result, rerender } = renderHook(() => useBranchDiff(), { wrapper });
    await waitFor(() => expect(result.current.current).toBe(true));
    let resolve!: (d: BranchDiff) => void;
    const b = {
      branch: 'editlet/b',
      head: async () => 'h2',
      compare: () => new Promise<BranchDiff>((r) => (resolve = r)),
    };
    state.workspace = { active: 'editlet/b', onBase: false, source: b };
    rerender();
    await waitFor(() => expect(result.current.headOid).toBe('h2'));
    expect(result.current.diff).toBeUndefined();
    expect(result.current.current).toBe(false);
    resolve(diffAt('h2', ['b.md']));
    await waitFor(() => expect(result.current.diff?.files.map((f) => f.path)).toEqual(['b.md']));
  });

  it('a compare that finds a newer head stores the diff under that head too', async () => {
    const src = source('editlet/a', 'h1', diffAt('h2', ['a.md']));
    state.workspace = { active: 'editlet/a', onBase: false, source: src };
    const { result } = renderHook(() => useBranchDiff(), { wrapper });
    await waitFor(() => expect(result.current.current).toBe(true));
    expect(client.getQueryData(branchDiffKey('editlet/a', 'h2'))).toBe(result.current.diff);
  });

  it('a failed compare: failed, no diff', async () => {
    const src = source('editlet/a', 'h1', new Error('boom'));
    state.workspace = { active: 'editlet/a', onBase: false, source: src };
    const { result } = renderHook(() => useBranchDiff(), { wrapper });
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.diff).toBeUndefined();
    expect(result.current.current).toBe(false);
  });
});
