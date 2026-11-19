import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import type { BranchDiff, GitHubSource } from '../../../github';
import { useFiles } from '../data/queries';
import { useWorkspace } from '../github/workspace';

/** The query key of a branch's diff against the base branch at one head: a new head (a save) is a new key. */
export function branchDiffKey(branch: string, headOid: string) {
  return ['branch-status', branch, headOid] as const;
}

/**
 * `source.compare()` for the key of `headOid`. The compare reads the branch head again: when someone committed in
 * between, the diff is also stored under its own head, so the next listing (at that head) reads no second compare.
 */
async function compareAt(queryClient: QueryClient, source: GitHubSource, headOid: string): Promise<BranchDiff> {
  const diff = await source.compare();
  if (diff.headOid !== headOid) queryClient.setQueryData(branchDiffKey(source.branch, diff.headOid), diff);
  return diff;
}

/**
 * The query options of `source`'s diff at `headOid`. The changed files of one head never change (the three-dot
 * compare runs from the merge base), so the query is never stale: Home's count, the branch preview layer, the per-file
 * statuses and the pull request body refresh share one `compare()` per head, that is one per save. Only `files` and
 * `otherFiles` are fixed per head: `status`, `aheadBy` and `behindBy` move with the base branch, so callers that need
 * them (the branch screen) read their own compare.
 */
export function branchDiffQuery(queryClient: QueryClient, source: GitHubSource, headOid: string) {
  return {
    queryKey: branchDiffKey(source.branch, headOid),
    queryFn: () => compareAt(queryClient, source, headOid),
    staleTime: Infinity,
  };
}

/** `source`'s diff at its current head, from the shared cache (a save's head is read once by everyone). */
export async function fetchBranchDiff(queryClient: QueryClient, source: GitHubSource): Promise<BranchDiff> {
  return queryClient.fetchQuery(branchDiffQuery(queryClient, source, await source.head()));
}

/**
 * The active branch's head as of its file list: a save (or a commit elsewhere, once listed) gives a new one. `undefined`
 * outside GitHub mode, on the base branch, and until the file list and the head load; while a new head loads, the
 * previous head of the same branch.
 */
export function useBranchHead(): string | undefined {
  return useBranchHeadQuery().headOid;
}

function useBranchHeadQuery(): { headOid: string | undefined; failed: boolean } {
  const workspace = useWorkspace();
  const files = useFiles();
  const branch = workspace?.active ?? null;
  const head = useQuery({
    queryKey: ['branch-head', branch, files.dataUpdatedAt],
    queryFn: () => workspace!.source.head(),
    enabled: workspace !== null && !workspace.onBase && files.data !== undefined,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === branch ? prev : undefined),
  });
  if (workspace === null || workspace.onBase) return { headOid: undefined, failed: false };
  return { headOid: head.data, failed: head.isError || files.isError };
}

export interface ActiveBranchDiff {
  /**
   * The active branch's diff against the base branch. `undefined` outside GitHub mode, on the base branch (nothing to
   * compare) and while it loads; while a new head loads, the previous diff of the same branch.
   */
  diff: BranchDiff | undefined;
  /** `useBranchHead()`. */
  headOid: string | undefined;
  /** `diff` is the one of `headOid` (not the previous head's, kept while the new one loads). */
  current: boolean;
  /** The compare (or the head read) failed: there is no diff to wait for. */
  failed: boolean;
}

/** The active branch's diff (`source.compare()`), shared by every caller through one key per head. */
export function useBranchDiff(): ActiveBranchDiff {
  const workspace = useWorkspace();
  const queryClient = useQueryClient();
  const { headOid, failed: headFailed } = useBranchHeadQuery();
  const branch = workspace?.active ?? '';
  const diff = useQuery({
    queryKey: branchDiffKey(branch, headOid ?? ''),
    queryFn: () => compareAt(queryClient, workspace!.source, headOid!),
    staleTime: Infinity,
    enabled: workspace !== null && headOid !== undefined,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === branch ? prev : undefined),
  });
  if (headOid === undefined) return { diff: undefined, headOid, current: false, failed: headFailed };
  const current = diff.data !== undefined && !diff.isPlaceholderData;
  return { diff: diff.data, headOid, current, failed: !current && diff.isError };
}
