import { DraftBadge, UnsavedLink, useEntryStatus, useUnsavedCount } from './entryStatus';

import { useLocalGit } from '../status/localGit';
import { BranchChip, StatusChip } from '../ui/parts/status-chips';

/**
 * Dev server: the checked-out git branch as the design's branch chip (FigCraft *Entry · saved (dev)*), disabled: there
 * is nothing to pick, the dev server works on whatever is checked out. Its description says whether everything is
 * committed. After it, one qualifier at most: the open entry's unsaved edits, or the files saved to disk and not
 * committed (*1 uncommitted*).
 */
export function LocalBranchBadge() {
  const raw = useLocalGit();
  // The chip needs a branch: not a git checkout, or a detached HEAD, shows *Local files*.
  const git = raw?.branch ? raw : null;
  const entry = useEntryStatus();
  const unsaved = useUnsavedCount(entry) > 0 || entry?.isNew === true;
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
