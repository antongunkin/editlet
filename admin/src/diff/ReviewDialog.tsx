import type { ReactNode } from 'react';

import { DiffHunk } from './DiffHunk';

import type { FieldDiffRow } from '../entry/diff';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui';

export type ReviewDialogProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Changed fields (`entryDiff`), one diff row each. */
  rows: FieldDiffRow[];
  /** Repo paths of staged image files that go into the same commit. */
  newFiles: string[];
  /** Confirm button label. */
  confirmLabel?: string;
  busy?: boolean;
  /** Also disables the confirm button (e.g. no usable new-branch name yet). */
  confirmDisabled?: boolean;
  /** Rendered between the changes and the buttons (e.g. the new-branch field). */
  children?: ReactNode;
  onConfirm(): void;
};

/** One before/after section per changed field (label, type, key), line numbers for markdown. */
export function FieldDiffList({ rows }: { rows: FieldDiffRow[] }) {
  return (
    <>
      {rows.map((row) => (
        <section key={row.key} className="editlet-diff-hunk" aria-label={row.label}>
          <div className="editlet-diff-hunk__header">
            <span className="editlet-diff-hunk__header-label">{row.label}</span>
            <span className="editlet-diff-hunk__header-format">{row.type}</span>
            <span className="editlet-diff-hunk__header-spacer" />
            <code className="editlet-diff-hunk__header-key">{row.key}</code>
          </div>
          <div className="editlet-diff-hunk__body">
            <DiffHunk before={row.before} after={row.after} showLineNumbers={row.type === 'markdown'} />
          </div>
        </section>
      ))}
    </>
  );
}

/** "Review changes": one before/after diff per changed field, the new image files, `children`, then Cancel / Save. */
export function ReviewDialog({
  open,
  onOpenChange,
  rows,
  newFiles,
  confirmLabel = 'Save',
  busy,
  confirmDisabled,
  children,
  onConfirm,
}: ReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="editlet-review-dialog">
        <DialogHeader>
          <DialogTitle>Review changes</DialogTitle>
          <DialogDescription>
            {rows.length === 0 && newFiles.length === 0 ? 'No changes.' : 'These changes are saved in one commit.'}
          </DialogDescription>
        </DialogHeader>
        <div className="editlet-u-stack editlet-u-gap-3 editlet-review-dialog__body">
          <FieldDiffList rows={rows} />
          {newFiles.length > 0 ? (
            <section className="editlet-diff-hunk" aria-label="New files">
              <div className="editlet-diff-hunk__header">
                <span className="editlet-diff-hunk__header-label">New files</span>
              </div>
              <ul className="editlet-diff-hunk__body editlet-review-dialog__files">
                {newFiles.map((p) => (
                  <li key={p} className="editlet-u-mono editlet-u-text-xs">
                    + {p}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy || confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
