import { useBranchDiff } from '../status/branchDiff';

/**
 * The files the active branch changes against the base: the shared branch diff (one compare per head, so one per
 * save). `null` outside GitHub mode, on the base branch and while it loads.
 */
export function useBranchChanges(): number | null {
  return useBranchDiff().diff?.files.length ?? null;
}
