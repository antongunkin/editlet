import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { DraftBadge, UnsavedLink, useEntryStatus } from './entryStatus';

import { DEV_API_BASE, type DevGitResponse } from '../../../core/devApi';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

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
 * Dev server: the checked-out git branch, as the same small button as GitHub mode's branch picker, disabled (there is
 * nothing to pick: the dev server works on whatever is checked out). The icon shows git only: green when everything is committed, orange when
 * files are saved to disk and not committed. Unsaved form edits are a separate link next to it, one qualifier at most.
 */
export function LocalBranchBadge() {
  const git = useLocalGit();
  const entry = useEntryStatus();
  const unsaved = entry !== null && (entry.dirty || entry.isNew);
  const uncommitted = git ? `${git.changes} uncommitted` : '';
  const tone = (git?.changes ?? 0) > 0 ? 'changed' : 'ok';
  return (
    <>
      {git ? (
        <Button
          variant="ghost"
          size="sm"
          className="editlet-branch-chip"
          icon={<Icon.GitBranch size={14} />}
          disabled
          data-tone={tone}
          title={git.changes === 0 ? `${git.branch}: all changes committed` : `${git.branch}: ${uncommitted}`}
        >
          <span className="editlet-branch-chip__name">{git.branch}</span>
        </Button>
      ) : (
        <span className="editlet-window__status-text">Local files</span>
      )}
      {unsaved ? (
        <UnsavedLink entry={entry} />
      ) : git && git.changes > 0 ? (
        <span className="editlet-branch-chip__changes">{uncommitted}</span>
      ) : null}
      {entry ? <DraftBadge entry={entry} /> : null}
    </>
  );
}
