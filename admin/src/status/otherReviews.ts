import { useQueries } from '@tanstack/react-query';

import type { CmsBranch } from '../../../github';
import { useBranches, useWorkspace } from '../github/workspace';

/** At most this many other pull requests are read (newest first): *In review* is then a lower bound. */
export const OTHER_REVIEWS_CAP = 10;

/** The query key of the paths a pull request's branch changes, at the pull request's head. */
export function prFilesKey(branch: string, headOid: string) {
  return ['pr-files', branch, headOid] as const;
}

/** The other branches with an open pull request that is not a draft, newest pull request first, at most the cap. */
export function otherReviewBranches(branches: CmsBranch[], active: string): CmsBranch[] {
  return branches
    .filter((b) => b.name !== active && b.pullRequest !== null && !b.pullRequest.isDraft)
    .toSorted((a, b) => b.pullRequest!.number - a.pullRequest!.number)
    .slice(0, OTHER_REVIEWS_CAP);
}

export interface OtherReviews {
  /** Every path the other open, non-draft pull requests change (a lower bound past the caps). */
  paths: ReadonlySet<string>;
  /** Every read has answered (a failed one counts as answered, with no paths). */
  ready: boolean;
}

const EMPTY: ReadonlySet<string> = new Set();

/** The last union: a result object changing (a refetch flag) must not give `useFileStatuses` a new `Set`. */
let last: { text: string; paths: ReadonlySet<string> } = { text: '', paths: EMPTY };

function combinePaths(results: { data?: { paths: string[] }; isPending: boolean }[]) {
  const paths = [...new Set(results.flatMap((r) => r.data?.paths ?? []))].toSorted();
  const text = paths.join('\n');
  if (text !== last.text) last = { text, paths: paths.length === 0 ? EMPTY : new Set(paths) };
  return { paths: last.paths, pending: results.some((r) => r.isPending) };
}

/**
 * *In review* from the other branches' pull requests (changes across entries T8): for each other `editlet/*` branch
 * with an open, non-draft pull request (from `['branches']`, newest 10), the paths it changes against the base branch
 * (`compareFiles`: one REST compare, at most 300 files), cached by the pull request's head (`['pr-files', branch,
 * headOid]`, never stale). Nothing outside GitHub mode.
 */
export function useOtherReviews(): OtherReviews {
  const workspace = useWorkspace();
  const branches = useBranches();
  const others = workspace && branches.data ? otherReviewBranches(branches.data, workspace.active) : [];
  const read = useQueries({
    queries: others.map((b) => ({
      queryKey: prFilesKey(b.name, b.pullRequest!.headOid),
      queryFn: () => workspace!.source.compareFiles(b.name),
      staleTime: Infinity,
      retry: false,
    })),
    // Re-run only when a result changes, so `paths` keeps its identity between renders.
    combine: combinePaths,
  });
  // A failed branch listing is settled too (no other pull requests known).
  return { paths: read.paths, ready: workspace === null || (!branches.isPending && !read.pending) };
}
