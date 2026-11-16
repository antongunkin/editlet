import type { ReactNode } from 'react';

import { Button } from './Button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './Dialog';

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** The destructive action's label, a verb ("Remove"). */
  confirmLabel: string;
  /** Called on confirm. The dialog closes first unless `pending` is set: then the caller closes it when done. */
  onConfirm: () => void;
  /** The action runs while the dialog stays open (a commit): the dialog does not close itself on confirm. */
  pending?: boolean;
  confirmDisabled?: boolean;
  /** Extra controls between the description and the buttons (the new-branch field). */
  children?: ReactNode;
};

/**
 * Asks before an action that cannot be undone from the form: a dialog with role `alertdialog`, a Cancel button first
 * (it takes the initial focus) and a red confirm button, right-aligned in one row: a small panel in the centre of the
 * window. It closes on either button or Escape, never on a click around it. With `pending` defined, confirm leaves it open for the caller to close.
 */
export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  confirmDisabled,
  children,
}: AlertDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent role="alertdialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirmDisabled || pending}
            onClick={() => {
              if (pending === undefined) onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
