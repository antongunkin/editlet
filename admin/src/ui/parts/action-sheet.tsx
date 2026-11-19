import { Dialog } from '@base-ui/react/dialog';
import { useContext, type ReactElement, type ReactNode } from 'react';

import { Card } from './card';
import { Grabber } from './chrome';
import { SheetPortal } from './sheet';

import { Button } from '../primitives/button';

export type ActionSheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The control that opens it (the ⋯ `IconButton`); omitted when the caller controls `open`. */
  trigger?: ReactElement;
  /** What the actions act on (the entry's title). */
  title: string;
  /** `ActionRow`s. Each one's `onClick` does its action and closes the sheet (`onOpenChange(false)`). */
  children: ReactNode;
};

/**
 * A short list of actions (FigCraft `ui4.action_sheet`, *Entry · ⋯*): a tray panel docked at the bottom that only dims
 * the screen, with the handle, a muted title, the actions in a card and Cancel. Escape, Cancel and a tap on the scrim
 * close it; focus returns to the trigger.
 */
export function ActionSheet({ open, defaultOpen, onOpenChange, trigger, title, children }: ActionSheetProps) {
  const container = useContext(SheetPortal) ?? undefined;
  return (
    <Dialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
    >
      {trigger ? <Dialog.Trigger render={trigger} /> : null}
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="sheet-scrim fixed inset-0 z-50 bg-overlay" />
        <Dialog.Popup
          data-slot="action-sheet"
          className="sheet-motion fixed inset-x-0 bottom-0 z-50 flex max-h-full flex-col overflow-y-auto rounded-t-3xl bg-background px-2 pb-5 text-foreground shadow-modal outline-none"
        >
          <Grabber />
          <Dialog.Title className="m-0 px-4 pt-1 pb-2 text-center text-sm font-medium text-tray-muted-foreground">
            {title}
          </Dialog.Title>
          <Card>{children}</Card>
          <Dialog.Close
            render={
              <Button variant="ghost" full className="mt-2">
                Cancel
              </Button>
            }
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
