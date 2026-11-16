import * as React from 'react';

import { Button } from './Button';
import { cn } from './cn';
import { Icon } from './Icon';

/**
 * Controlled native `<dialog>`. `Dialog` holds `open` + `onOpenChange`; `DialogContent` renders the modal `<dialog>`
 * while open. The admin already lives in a window (the loader's iframe), so the `<dialog>` is a near-opaque, blurred sheet
 * over that window in its theme, with the content right on it: it scrolls under a close button that stays put. Escape, a
 * click on the bare sheet outside the content column, and the close button all call `onOpenChange(false)`. A dialog with
 * role `alertdialog` is a narrow column in the centre instead: no close button, and a click around it does nothing; it
 * waits for an explicit answer (one of its buttons or Escape).
 */

/**
 * What the window draws on every open dialog's sheet: its resize edges. A modal `<dialog>` makes the rest of the page
 * inert, the window's own edges included, so they are drawn again inside the dialog. `null` outside the window.
 */
export const DialogEdges = React.createContext<React.ReactNode>(null);

type DialogContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  descriptionId: string;
};

const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  setOpen: () => {},
  titleId: '',
  descriptionId: '',
});

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children?: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  const uid = React.useId();
  const ctx = React.useMemo(
    () => ({ open, setOpen: onOpenChange, titleId: `${uid}-title`, descriptionId: `${uid}-desc` }),
    [open, onOpenChange, uid],
  );
  return <DialogContext.Provider value={ctx}>{children}</DialogContext.Provider>;
}

export type DialogContentProps = React.HTMLAttributes<HTMLDialogElement> & {
  /** `false`: no close button; Escape and a backdrop click do nothing (the dialog closes only when `open` changes). */
  closable?: boolean;
};

export function DialogContent({ className, children, onClick, closable = true, ...props }: DialogContentProps) {
  const { open, setOpen, titleId, descriptionId } = React.useContext(DialogContext);
  const edges = React.useContext(DialogEdges);
  const alert = props.role === 'alertdialog';
  const closesOnSheet = closable && !alert;
  const dialogRef = React.useRef<HTMLDialogElement>(null);

  // Promote to native modal mode while open so the browser handles ::backdrop + top-layer.
  React.useLayoutEffect(() => {
    if (!open) return;
    const d = dialogRef.current;
    if (!d) return;
    if (typeof d.showModal === 'function') {
      try {
        if (d.open) d.close();
        d.showModal();
      } catch {
        // Best effort only.
      }
      if (!d.open) d.setAttribute('open', '');
    } else {
      d.setAttribute('open', '');
    }
    return () => {
      try {
        if (d.open && typeof d.close === 'function') d.close();
      } catch {
        // Ignore cleanup failures.
      }
    };
  }, [open]);

  // Block the native cancel → close chain; Escape is handled by the keydown listener below.
  React.useEffect(() => {
    if (!open) return;
    const d = dialogRef.current;
    if (!d) return;
    const preventCancel = (e: Event) => e.preventDefault();
    d.addEventListener('cancel', preventCancel);
    return () => d.removeEventListener('cancel', preventCancel);
  }, [open]);

  React.useEffect(() => {
    if (!open || !closable) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, setOpen, closable]);

  if (!open) return null;

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
    <dialog
      ref={dialogRef}
      className={cn('editlet-dialog__content', className)}
      data-state="open"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(e) => {
        // A click on the bare sheet, outside the content column, closes like a backdrop click.
        const target = e.target as HTMLElement;
        if (
          closesOnSheet &&
          (target === e.currentTarget || target.matches('.editlet-dialog__panel, .editlet-dialog__scroll'))
        )
          setOpen(false);
        onClick?.(e);
      }}
      {...props}
    >
      <div className="editlet-dialog__panel">
        {/* The panel stays still and this scrolls, so the close button (outside it) never scrolls away. */}
        <div className="editlet-dialog__scroll">
          <div className="editlet-dialog__inner">{children}</div>
        </div>
        {closable && !alert ? (
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className="editlet-dialog__close"
            onClick={() => setOpen(false)}
            aria-label="Close"
          >
            <Icon.X size={16} />
          </Button>
        ) : null}
      </div>
      {edges}
    </dialog>
  );
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('editlet-dialog__header', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('editlet-dialog__footer', className)} {...props} />;
}

export function DialogTitle({ className, children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = React.useContext(DialogContext);
  return (
    <h2 id={titleId} className={cn('editlet-dialog__title', className)} {...props}>
      {children}
    </h2>
  );
}

export function DialogDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  const { descriptionId } = React.useContext(DialogContext);
  return <p id={descriptionId} className={cn('editlet-dialog__description', className)} {...props} />;
}
