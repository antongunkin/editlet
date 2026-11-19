import { useId, type ReactNode, type RefObject } from 'react';

import { cn } from '../ui/cn';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Row } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

// The branch picker as the design draws it (FigCraft *Branches*, *Branches · new*): a sheet with the find field and
// the branches as rows (a tap switches), and one level down the *New branch* sheet that creates one from the base.
// Props only: BranchDialog.tsx has the data, /design renders it from fixtures (src/design/fixtures/branch.tsx).

export interface BranchItem {
  name: string;
  /** *Live site · edits here start a new branch*, *Pull request #2 · 5d ago*. */
  sub: string;
  active: boolean;
  /** The pull request's state as a badge. */
  badge?: ReactNode;
  /** *Review*: a link to the branch screen. */
  review?: ReactNode;
  onChoose(): void;
}

export interface NewBranchSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  prefix: string;
  /** The name after the prefix, as typed. */
  value: string;
  onChange(value: string): void;
  /** *Creates editlet/summer-sale from main.*, or why the name cannot be used. */
  hint: string;
  invalid: boolean;
  /** GitHub's answer: the name is taken, or the request failed. */
  error?: string | null;
  creating?: boolean;
  onCreate(): void;
}

/** *New branch*: the name after the fixed prefix; the CTA (and Enter) creates it from the base branch. */
export function NewBranchSheet({
  open,
  onOpenChange,
  prefix,
  value,
  onChange,
  hint,
  invalid,
  error,
  creating = false,
  onCreate,
}: NewBranchSheetProps) {
  const id = useId();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="New branch"
      sub="Branches"
      bar={
        <BottomBar>
          <Button
            type="submit"
            form={`${id}-form`}
            variant="primary"
            size="lg"
            full
            loading={creating}
            busyLabel="Creating…"
            disabled={invalid}
          >
            Create branch
          </Button>
        </BottomBar>
      }
    >
      <form
        id={`${id}-form`}
        className="flex flex-col gap-2 px-4 pt-1 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid && !creating) onCreate();
        }}
      >
        <InputGroup prefix={prefix}>
          <InputGroupInput
            aria-label="Branch name"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid || Boolean(error) || undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          />
        </InputGroup>
        {error ? (
          <p
            id={`${id}-error`}
            role="alert"
            className="m-0 flex items-center gap-1.5 px-1 text-sm font-medium text-tint-danger-foreground"
          >
            <Icon name="alert" size={16} className="shrink-0 text-destructive" />
            {error}
          </p>
        ) : null}
        <p id={`${id}-hint`} className="m-0 px-1 text-sm text-tray-muted-foreground">
          {hint}
        </p>
      </form>
    </Sheet>
  );
}

export interface BranchesSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  query: string;
  onQuery(query: string): void;
  /** The base branch first, then the `<prefix>*` branches that match. */
  branches: BranchItem[];
  /** A typed name no branch has: the row that opens *New branch*. */
  create?: { name: string; base: string; onOpen(): void };
  /** Loading or failed: a line under the list. */
  note?: ReactNode;
  /** The *New branch* sheet, one level down. */
  children?: ReactNode;
  /** Where the focus returns on close (`Sheet`'s `finalFocus`). */
  finalFocus?: RefObject<HTMLElement | null>;
}

/**
 * *Branches*: why branches exist, the find-or-create field, then the branches as rows: a tap switches to one (the
 * active one has the check), *Review* opens its screen, and a new name offers *Create*.
 */
export function BranchesSheet({
  open,
  onOpenChange,
  query,
  onQuery,
  branches,
  create,
  note,
  children,
  finalFocus,
}: BranchesSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Branches" sub="Switch or create" finalFocus={finalFocus}>
      <form
        className="flex flex-col gap-2 px-4 pt-1 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          create?.onOpen();
        }}
      >
        <p className="m-0 px-1 text-sm text-tray-muted-foreground">
          Edits are saved on a branch; its pull request takes them to the live site.
        </p>
        <InputGroup lead={<Icon name="search" size={20} />}>
          <InputGroupInput
            type="search"
            aria-label="Find or create a branch"
            placeholder="Find or create a branch"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </InputGroup>
        <Card as="ul" aria-label="Branches" className="mt-2">
          {branches.map((b) => (
            // The active row's fill reaches under its Review link too.
            <li key={b.name} className={cn('flex items-center', b.active && 'bg-sunken')}>
              <Row
                className="min-w-0 flex-1"
                lead="branch"
                title={b.name}
                sub={b.sub}
                selected={b.active}
                chevron={false}
                trail={
                  b.active ? <Icon name="check" size={20} strokeWidth={2.25} className="shrink-0" /> : (b.badge ?? null)
                }
                onClick={b.onChoose}
              />
              {b.review}
            </li>
          ))}
          {create ? (
            <li>
              <Row
                lead="plus"
                title={`Create ${create.name}`}
                sub={`From ${create.base}`}
                aria-haspopup="dialog"
                onClick={create.onOpen}
              />
            </li>
          ) : null}
        </Card>
        {note}
      </form>
      {children}
    </Sheet>
  );
}
