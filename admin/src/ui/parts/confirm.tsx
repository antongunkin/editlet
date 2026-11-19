import { AlertDialog } from '@base-ui/react/alert-dialog';
import { useContext, useRef, type ReactNode, type RefObject } from 'react';

import { Grabber } from './chrome';
import type { FinalFocus } from './focus';
import { SheetPortal } from './sheet';

import { Button } from '../primitives/button';

export type ConfirmProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  /** The destructive action's label, a verb ("Remove"). */
  confirmLabel: string;
  /** Called on confirm. The confirm closes first unless `pending` is set: then the caller closes it when done. */
  onConfirm: () => void;
  /** The action runs while the confirm stays open (a commit): it does not close itself on confirm. */
  pending?: boolean;
  confirmDisabled?: boolean;
  /** Extra controls between the description and the buttons (the new-branch field). */
  children?: ReactNode;
  /** Where the focus goes on open: Cancel by default; a field among `children` when the confirm asks for a value (Rename). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Where the focus goes when it closes (the ⋯ button of the row it was opened from: `ui/parts/focus.ts`). */
  finalFocus?: FinalFocus;
};

/**
 * Asks before an action that cannot be undone from the form (FigCraft `more.confirm`): a card docked at the bottom of
 * the screen that only dims it (no push-back), with role `alertdialog`. A decorative handle, the title, the text, any
 * extra controls, the red confirm button and Cancel, which takes the initial focus (or `initialFocus`). Escape and Cancel close it, a click
 * on the scrim does not. With `pending` defined, confirm leaves it open for the caller to close.
 */
export function Confirm({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  pending,
  confirmDisabled,
  children,
  initialFocus,
  finalFocus,
}: ConfirmProps) {
  const container = useContext(SheetPortal) ?? undefined;
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialog.Portal container={container}>
        <AlertDialog.Backdrop className="sheet-scrim fixed inset-0 z-50 bg-overlay" />
        <AlertDialog.Popup
          initialFocus={initialFocus ?? cancel}
          finalFocus={finalFocus}
          data-slot="confirm"
          className="sheet-motion fixed inset-x-0 bottom-0 z-50 flex max-h-full flex-col gap-3 overflow-y-auto rounded-t-3xl bg-card px-4 pb-5 text-card-foreground shadow-modal outline-none"
        >
          <Grabber />
          <AlertDialog.Title className="m-0 text-center text-2xl font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="m-0 text-center text-base text-muted-foreground">
            {description}
          </AlertDialog.Description>
          {children}
          <Button
            variant="danger"
            full
            disabled={confirmDisabled || pending}
            onClick={() => {
              if (pending === undefined) onOpenChange(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
          <Button ref={cancel} variant="ghost" full onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
