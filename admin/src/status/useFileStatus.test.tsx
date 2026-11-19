// useFileStatuses over stubbed inputs: the GitHub branch diff and branch listing, or the dev server's git route.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toLocalGit } from './localGit';
import { fileStatuses, fileStatusLabel, useFileStatuses } from './useFileStatus';

import { DEV_API_BASE } from '../../../core/devApi';
import type { BranchDiff, CmsBranch } from '../../../github';

type StubWorkspace = {
  active: string;
  onBase: boolean;
  source: { compareFiles(branch: string): Promise<{ paths: string[]; complete: boolean }> };
};

const state = vi.hoisted(() => ({
  workspace: null as StubWorkspace | null,
  /** What `compareFiles` answers per branch (other branches' pull requests). */
  prFiles: {} as Record<string, string[]>,
  compared: [] as string[],
  branches: undefined as CmsBranch[] | undefined,
  branchesFailed: false,
  diff: undefined as BranchDiff | undefined,
  /** The paths of the changes buffer's entries (*Unsaved*). */
  buffered: [] as string[],
}));

vi.mock('../github/workspace', () => ({
  useWorkspace: () => state.workspace,
  useBranches: () => ({ data: state.branches, isPending: state.branches === undefined && !state.branchesFailed }),
}));
vi.mock('../changes/trayContext', () => ({
  useBuffer: () => ({ entries: state.buffered.map((path) => ({ path })), ready: true }),
}));
vi.mock('./branchDiff', () => ({ useBranchDiff: () => ({ diff: state.diff, failed: false }) }));

const POST = 'cms/content/post/hello.md';
const AUTHOR = 'cms/content/author/dana.md';
const GONE = 'cms/content/post/old.md';

function diffOf(files: Record<string, 'added' | 'modified' | 'removed'>): BranchDiff {
  return {
    status: 'ahead',
    aheadBy: 1,
    behindBy: 0,
    mergeBaseOid: 'b'.repeat(40),
    headOid: 'h'.repeat(40),
    files: Object.entries(files).map(([path, status]) => ({ path, status, sha: null, baseSha: null })),
    otherFiles: [],
    complete: true,
  };
}

function branch(name: string, pullRequest: { isDraft: boolean; number?: number } | null): CmsBranch {
  return {
    name,
    headOid: 'h'.repeat(40),
    committedAt: null,
    pullRequest: pullRequest && {
      number: pullRequest.number ?? 2,
      url: 'u',
      title: 't',
      isDraft: pullRequest.isDraft,
      headOid: `${name}-head`,
    },
  };
}

/** A workspace on `active`, whose source answers `compareFiles` from `state.prFiles`. */
function onBranch(active: string, onBase = false): StubWorkspace {
  return {
    active,
    onBase,
    source: {
      compareFiles: async (name) => {
        state.compared.push(name);
        return { paths: state.prFiles[name] ?? [], complete: true };
      },
    },
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** A wrapper that keeps one client across rerenders (the cache is part of what is tested). */
function sharedClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** Answers `GET /__editlet/git` with `body`; returns the call count. */
function devGit(body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

beforeEach(() => {
  state.workspace = null;
  state.prFiles = {};
  state.compared = [];
  state.branches = undefined;
  state.branchesFailed = false;
  state.diff = undefined;
  state.buffered = [];
});

afterEach(() => vi.unstubAllGlobals());

describe('fileStatuses', () => {
  it('the badge is the first of unsaved, review, changed; refs hold every status of a file', () => {
    const s = fileStatuses({ unsaved: [POST], review: [POST, AUTHOR], changed: [POST, AUTHOR, GONE], ready: true });
    expect(s.of(POST)).toBe('unsaved');
    expect(s.of(AUTHOR)).toBe('review');
    expect(s.of(GONE)).toBe('changed');
    expect(s.of('cms/content/post/other.md')).toBeNull();
    expect([...s.refs.unsaved]).toEqual([POST]);
    expect([...s.refs.review].toSorted()).toEqual([AUTHOR, POST]);
    expect(s.refs.changed.size).toBe(3);
  });

  it('nothing while not ready', () => {
    const s = fileStatuses({ unsaved: [], review: [], changed: [POST], ready: false });
    expect(s.of(POST)).toBeNull();
    expect(s.ready).toBe(false);
  });

  it('labels', () => {
    expect(fileStatusLabel('unsaved')).toBe('Unsaved');
    expect(fileStatusLabel('review')).toBe('In review');
    expect(fileStatusLabel('changed')).toBe('Changed');
  });
});

describe('useFileStatuses in GitHub mode', () => {
  it('a branch without a pull request: its diff is changed, nothing in review', () => {
    state.workspace = onBranch('editlet/a');
    state.branches = [branch('editlet/a', null)];
    state.diff = diffOf({ [POST]: 'modified', [GONE]: 'removed' });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    expect(result.current.ready).toBe(true);
    expect(result.current.of(POST)).toBe('changed');
    expect(result.current.refs.changed.has(GONE)).toBe(true);
    expect(result.current.refs.review.size).toBe(0);
    expect(result.current.refs.unsaved.size).toBe(0);
  });

  it('an open pull request: the same files are in review (and still changed)', () => {
    state.workspace = onBranch('editlet/a');
    state.branches = [branch('editlet/a', { isDraft: false })];
    state.diff = diffOf({ [POST]: 'modified' });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    expect(result.current.of(POST)).toBe('review');
    expect(result.current.refs.changed.has(POST)).toBe(true);
  });

  it('a draft pull request: changed, not in review', () => {
    state.workspace = onBranch('editlet/a');
    state.branches = [branch('editlet/a', { isDraft: true })];
    state.diff = diffOf({ [POST]: 'modified' });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    expect(result.current.of(POST)).toBe('changed');
    expect(result.current.refs.review.size).toBe(0);
  });

  it('the base branch: nothing from the active diff, ready once the branches load', () => {
    state.workspace = onBranch('main', true);
    state.diff = diffOf({ [POST]: 'modified' }); // never read on the base branch
    const loading = renderHook(() => useFileStatuses(), { wrapper });
    expect(loading.result.current.ready).toBe(false);
    state.branches = [branch('editlet/a', null)];
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    expect(result.current.ready).toBe(true);
    expect(result.current.of(POST)).toBeNull();
    expect(result.current.refs.changed.size).toBe(0);
  });

  it('not ready while the diff loads', () => {
    state.workspace = onBranch('editlet/a');
    state.branches = [];
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    expect(result.current.ready).toBe(false);
  });

  it('makes no dev API request', () => {
    state.workspace = onBranch('main', true);
    const calls = devGit({ branch: 'main', changes: 0 });
    renderHook(() => useFileStatuses(), { wrapper });
    expect(calls).toEqual([]);
  });
});

describe('other branches’ pull requests (In review)', () => {
  it('on the base branch: the files of the open, non-draft pull requests are in review; drafts are ignored', async () => {
    state.workspace = onBranch('main', true);
    state.branches = [
      branch('editlet/a', { isDraft: false, number: 1 }),
      branch('editlet/draft', { isDraft: true, number: 2 }),
      branch('editlet/none', null),
    ];
    state.prFiles = { 'editlet/a': [POST], 'editlet/draft': [AUTHOR] };
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.of(POST)).toBe('review');
    expect(result.current.of(AUTHOR)).toBeNull();
    expect(state.compared).toEqual(['editlet/a']);
  });

  it('on a branch: the active branch is not read again; another pull request marks its files in review', async () => {
    state.workspace = onBranch('editlet/a');
    state.branches = [branch('editlet/a', null), branch('editlet/b', { isDraft: false, number: 5 })];
    state.diff = diffOf({ [POST]: 'modified' });
    state.prFiles = { 'editlet/b': [AUTHOR] };
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.of(AUTHOR)).toBe('review'));
    expect(result.current.of(POST)).toBe('changed');
    expect(state.compared).toEqual(['editlet/b']);
  });

  it('reads the newest 10 pull requests only', async () => {
    state.workspace = onBranch('main', true);
    state.branches = Array.from({ length: 12 }, (_, i) =>
      branch(`editlet/p${i + 1}`, { isDraft: false, number: i + 1 }),
    );
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(state.compared.toSorted()).toEqual(Array.from({ length: 10 }, (_, i) => `editlet/p${i + 3}`).toSorted());
  });

  it('a new pull request head reads the branch again; the same head does not', async () => {
    state.workspace = onBranch('main', true);
    state.branches = [branch('editlet/a', { isDraft: false })];
    state.prFiles = { 'editlet/a': [POST] };
    const view = renderHook(() => useFileStatuses(), { wrapper: sharedClient() });
    await waitFor(() => expect(view.result.current.of(POST)).toBe('review'));
    view.rerender();
    expect(state.compared).toEqual(['editlet/a']);
    state.branches = [
      {
        ...branch('editlet/a', { isDraft: false }),
        pullRequest: { ...branch('x', { isDraft: false }).pullRequest!, headOid: 'new-head' },
      },
    ];
    state.prFiles = { 'editlet/a': [AUTHOR] };
    view.rerender();
    await waitFor(() => expect(view.result.current.of(AUTHOR)).toBe('review'));
    expect(state.compared).toEqual(['editlet/a', 'editlet/a']);
  });

  it('settles with no statuses when the branch listing fails', async () => {
    state.workspace = onBranch('main', true);
    state.branches = undefined;
    state.branchesFailed = true;
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.refs.review.size).toBe(0);
  });

  it('a failed read leaves no statuses from it and still settles', async () => {
    state.workspace = onBranch('main', true);
    state.workspace.source.compareFiles = async () => {
      throw new Error('boom');
    };
    state.branches = [branch('editlet/a', { isDraft: false })];
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.refs.review.size).toBe(0);
  });
});

describe('the changes buffer', () => {
  it('the buffered entries are unsaved, and still in the other sets of their file', async () => {
    state.workspace = onBranch('editlet/spring');
    state.branches = [branch('editlet/spring', { isDraft: false })];
    state.diff = diffOf({ [POST]: 'modified' });
    state.buffered = [POST, AUTHOR];
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.of(POST)).toBe('unsaved');
    expect(result.current.of(AUTHOR)).toBe('unsaved');
    expect([...result.current.refs.unsaved]).toEqual([POST, AUTHOR]);
    expect([...result.current.refs.review]).toEqual([POST]);
  });
});

describe('useFileStatuses in dev mode', () => {
  it('the uncommitted files are changed; never in review', async () => {
    const calls = devGit({
      branch: 'main',
      changes: 2,
      files: [
        { path: POST, status: 'modified' },
        { path: AUTHOR, status: 'added' },
      ],
      project: 'abc',
    });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(calls).toEqual([`${DEV_API_BASE}/git`]);
    expect(result.current.of(POST)).toBe('changed');
    expect(result.current.of(AUTHOR)).toBe('changed');
    expect(result.current.refs.review.size).toBe(0);
  });

  it('a detached HEAD still has its files', async () => {
    devGit({ branch: null, changes: 1, files: [{ path: POST, status: 'modified' }], project: 'abc' });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.of(POST)).toBe('changed'));
  });

  it('an older dev server without files: ready, no statuses', async () => {
    devGit({ branch: 'main', changes: 3 });
    const { result } = renderHook(() => useFileStatuses(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.refs.changed.size).toBe(0);
  });
});

describe('toLocalGit', () => {
  it('fills what an older dev server does not send', () => {
    expect(toLocalGit({ branch: 'main', changes: 1 })).toEqual({
      branch: 'main',
      changes: 1,
      files: [],
      project: 'default',
    });
  });

  it('keeps files and project', () => {
    const files = [{ path: POST, status: 'removed' as const }];
    expect(toLocalGit({ branch: null, changes: 1, files, project: 'p1' })).toEqual({
      branch: null,
      changes: 1,
      files,
      project: 'p1',
    });
  });
});
