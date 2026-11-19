import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { DraftBadge, UnsavedLink, useEntryStatus } from './entryStatus';

import { DEV_API_BASE, type DevGitResponse } from '../../../core/devApi';
import { BranchChip, StatusChip } from '../ui/parts/status-chips';

const POLL_MS = 3000;

/** The dev server's git state, polled while the tab is visible. `null` when it is not known. */
function useLocalGit(): DevGitResponse | null {
  const git = useQuery({
    queryKey: ['local-git'],
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`${DEV_API_BASE}/git`);
      if (!res.ok) throw new Error(`git: ${res.status}`);
      return (await res.json()) as DevGitResponse;
    },
    retry: false,
  });
  return git.data?.branch ? git.data : null;
}

/**
 * Dev server: the checked-out git branch as the design's branch chip (FigCraft *Entry · saved (dev)*), disabled: there
 * is nothing to pick, the dev server works on whatever is checked out. Its description says whether everything is
 * committed. After it, one qualifier at most: the open entry's unsaved edits, or the files saved to disk and not
 * committed (*1 uncommitted*).
 */
export function LocalBranchBadge() {
  const git = useLocalGit();
  const entry = useEntryStatus();
  const unsaved = entry !== null && (entry.dirty || entry.isNew);
  const uncommitted = git ? `${git.changes} uncommitted` : '';
  const state = git
    ? git.changes === 0
      ? `${git.branch}: all changes committed`
      : `${git.branch}: ${uncommitted}`
    : '';
  return (
    <>
      {git ? (
        <BranchChip
          name={git.branch ?? ''}
          disabled
          // The name says it is the branch and which (*Branch main*); GitHub mode's chip opens the picker instead.
          aria-label={`Branch ${git.branch}`}
          description={state}
          title={state}
          className="max-w-64"
        />
      ) : (
        <span className="text-sm text-muted-foreground">Local files</span>
      )}
      {unsaved ? (
        <UnsavedLink entry={entry} />
      ) : git && git.changes > 0 ? (
        <StatusChip tone="unsaved">{uncommitted}</StatusChip>
      ) : null}
      {entry ? <DraftBadge entry={entry} /> : null}
    </>
  );
}
