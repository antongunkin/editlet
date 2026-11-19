import { useEffect, useId, useRef, type RefObject } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { Input } from '../ui/primitives/input';

// *New post* as the design draws it (FigCraft *New post · name*, *New post · address taken*): a modal over the list that
// asks for the name first; the address follows it (shown under the field, *Edit* opens it as a field of its own), and
// the one CTA creates the blank entry. Props only: NewEntryDialog.tsx has the schema and the route, and /design renders
// it from fixtures (src/design/fixtures/collection.tsx).

export interface NewEntryViewProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The modal's title: *New post*. */
  title: string;
  /** The line under it: the collection. */
  sub?: string;
  /** The name field's label (the collection's title field); none when the collection has no title to ask for. */
  nameLabel?: string;
  name: string;
  onName(name: string): void;
  /** The address (the file's slug): what the name makes of it, or what was typed. */
  address: string;
  onAddress(address: string): void;
  /** The address is a field (the user pressed *Edit*, or there is no name to derive it from). */
  editing: boolean;
  onEdit(): void;
  /** Why the entry cannot be created: the address is taken or not valid. */
  problem?: string;
  /** The CTA: *Create post*. */
  ctaLabel: string;
  canCreate: boolean;
  onCreate(): void;
  /** Takes the focus when the modal opens (the name, or the address when there is no name). */
  focusRef?: RefObject<HTMLInputElement | null>;
}

export function NewEntryView({
  open,
  onOpenChange,
  title,
  sub,
  nameLabel,
  name,
  onName,
  address,
  onAddress,
  editing,
  onEdit,
  problem,
  ctaLabel,
  canCreate,
  onCreate,
  focusRef,
}: NewEntryViewProps) {
  const formId = useId();
  const showAddressField = editing || nameLabel === undefined;
  const ownRef = useRef<HTMLInputElement>(null);
  // The name has the cursor when the modal opens; with no name to ask for, the address has it.
  const addressRef = nameLabel === undefined ? (focusRef ?? ownRef) : ownRef;
  // Edit unmounts itself: the cursor goes to the address it opened.
  useEffect(() => {
    if (editing && nameLabel !== undefined) ownRef.current?.focus();
  }, [editing, nameLabel]);
  const edit = (
    <Button variant="link" size="md" className="-mx-2 px-3" onClick={onEdit} aria-label="Edit the address">
      Edit
    </Button>
  );
  const problemId = `${formId}-problem`;
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      sub={sub}
      initialFocus={focusRef}
      bar={
        <BottomBar>
          <Button variant="primary" size="lg" full type="submit" form={formId} disabled={!canCreate}>
            {ctaLabel}
          </Button>
        </BottomBar>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-2 px-4 pt-1 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canCreate) onCreate();
        }}
      >
        {nameLabel === undefined ? null : (
          <Input
            ref={focusRef}
            aria-label={nameLabel}
            value={name}
            onChange={(e) => onName(e.target.value)}
            aria-invalid={problem && !showAddressField ? true : undefined}
            aria-describedby={problem && !showAddressField ? problemId : undefined}
            autoComplete="off"
          />
        )}
        {showAddressField ? (
          <Input
            ref={addressRef}
            aria-label="Address"
            className="font-mono"
            value={address}
            onChange={(e) => onAddress(e.target.value)}
            spellCheck={false}
            autoCapitalize="none"
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? problemId : undefined}
          />
        ) : problem ? null : (
          <p className="m-0 flex min-h-11 items-center gap-2 px-1 text-sm text-tray-muted-foreground">
            <span>Address</span>
            {address === '' ? (
              <span>follows the name</span>
            ) : (
              <>
                <code className="font-mono font-medium text-foreground">{address}</code>
                {edit}
              </>
            )}
          </p>
        )}
        {problem ? (
          <div className="flex items-center gap-2 px-1">
            <p
              id={problemId}
              role="alert"
              className="m-0 flex min-h-8 min-w-0 flex-1 items-center gap-2 text-sm font-medium text-tint-danger-foreground"
            >
              <Icon name="alert" size={16} className="shrink-0 text-destructive" />
              {problem}
            </p>
            {showAddressField ? null : edit}
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
