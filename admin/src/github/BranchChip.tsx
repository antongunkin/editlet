import { useState } from 'react';

import { BranchDialog } from './BranchDialog';
import { useBranches, useWorkspace } from './workspace';

import { BranchChip as Chip } from '../ui/parts/status-chips';

/** The status line's branch chip: `main live` on the base branch, else the active branch and its open PR number. Opens the picker. */
export function BranchChip() {
  const workspace = useWorkspace();
  const branches = useBranches();
  const [open, setOpen] = useState(false);
  if (!workspace) return null;

  const pr = workspace.onBase ? null : branches.data?.find((b) => b.name === workspace.active)?.pullRequest;
  const name = workspace.onBase ? workspace.base : workspace.active;
  const suffix = workspace.onBase ? 'live' : pr ? `#${pr.number}` : undefined;
  return (
    <>
      <Chip
        name={name}
        suffix={suffix}
        offBase={!workspace.onBase}
        description={workspace.onBase ? `${name} · live` : pr ? `${name} #${pr.number}` : name}
        className="max-w-64"
        // The visible text is part of the name (WCAG 2.5.3, label in name): *Branch main live*.
        aria-label={`Branch ${name}${suffix ? ` ${suffix}` : ''}`}
        aria-haspopup="dialog"
        title={workspace.onBase ? `${name} · live` : name}
        onClick={() => setOpen(true)}
      />
      <BranchDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
