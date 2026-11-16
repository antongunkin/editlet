import { useId, useState } from 'react';

import { BranchDialog } from './BranchDialog';
import { useBranches, useWorkspace } from './workspace';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

/** Status-bar branch button (small, ghost): `main · live` on the base branch, else the active branch and its open PR number. Opens the picker. */
export function BranchChip() {
  const workspace = useWorkspace();
  const branches = useBranches();
  const [open, setOpen] = useState(false);
  const nameId = useId();
  if (!workspace) return null;

  const pr = workspace.onBase ? null : branches.data?.find((b) => b.name === workspace.active)?.pullRequest;
  const label = workspace.onBase ? `${workspace.base} · live` : workspace.active;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="editlet-branch-chip"
        icon={<Icon.GitBranch size={14} />}
        aria-label="Branch"
        aria-describedby={nameId}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen(true)}
      >
        <span id={nameId} className="editlet-branch-chip__name">
          {label}
        </span>
        {pr ? (
          <>
            {' '}
            <span className="editlet-branch-chip__pr">#{pr.number}</span>
          </>
        ) : null}
      </Button>
      <BranchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
