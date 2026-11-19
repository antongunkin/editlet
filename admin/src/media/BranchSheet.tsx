import { useId, type ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import type { FinalFocus } from '../ui/parts/focus';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';

export interface BranchSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** What is about to be committed: *Upload spare.png*. */
  title: string;
  /** The commit goes on: the CTA is busy. */
  busy?: boolean;
  /** The branch name is missing or taken. */
  disabled?: boolean;
  /** The CTA's label: *Commit on branch*. */
  label: string;
  onSubmit(): void;
  /** Where the focus goes when it closes (the ⋯ the change was started from). */
  finalFocus?: FinalFocus;
  /** The new-branch field. */
  children: ReactNode;
}

/**
 * The modal an upload or a replace on the base branch opens (FigCraft *Media · upload on main*): the live site is never
 * written, so the change goes to a new branch whose name the editor can change. Enter in the field commits too.
 */
export function BranchSheet({
  open,
  onOpenChange,
  title,
  busy,
  disabled,
  label,
  onSubmit,
  finalFocus,
  children,
}: BranchSheetProps) {
  const formId = useId();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      finalFocus={finalFocus}
      sub="The change is committed to a new branch."
      bar={
        <BottomBar>
          <Button variant="primary" size="lg" full type="submit" form={formId} loading={busy} disabled={disabled}>
            {label}
          </Button>
        </BottomBar>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-2 px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!disabled && !busy) onSubmit();
        }}
      >
        {children}
      </form>
    </Sheet>
  );
}
