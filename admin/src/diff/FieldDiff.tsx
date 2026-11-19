import type { HTMLAttributes, ReactNode } from 'react';

import { DiffHunk } from './DiffHunk';

import type { FieldDiffRow } from '../entry/diff';
import { cn } from '../ui/cn';
import { rowVariants } from '../ui/parts/rows';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { IconTile } from '../ui/primitives/icon-tile';
import type { IconName } from '../ui/primitives/icons';

/** A value short enough for the design's two boxes (one line, no more than a sentence or two). */
const short = (s: string) => !s.includes('\n') && s.length <= 160;

/**
 * One changed field (FigCraft `diff_box`): its label with its type and key, then the old value struck through on the danger tint and the new
 * one on the success tint. A long or multi-line value (Markdown, JSON, YAML of a list) is a line diff instead.
 */
export function FieldDiff({
  row,
  onRevert,
  revertDisabled,
}: {
  row: FieldDiffRow;
  onRevert?: () => void;
  /** While the save runs: the button stays, locked (FigCraft *Saving*). */
  revertDisabled?: boolean;
}) {
  const boxes = short(row.before) && short(row.after);
  return (
    <section aria-label={row.label} className="flex flex-col gap-2">
      {/* The label, then the field's type and key (as the old review showed them): what changed, for a developer too. */}
      <div className="flex min-w-0 items-baseline gap-2 px-1">
        <span className="text-sm font-medium text-tray-muted-foreground">{row.label}</span>
        <span className="min-w-0 truncate text-xs text-tray-muted-foreground">
          {row.type} · <code className="font-mono">{row.key}</code>
        </span>
      </div>
      {boxes ? (
        <>
          {row.before === '' ? null : (
            <p className="m-0 rounded-2xl bg-tint-danger p-4 text-base break-words text-tint-danger-foreground line-through">
              <span className="sr-only">Before: </span>
              {row.before}
            </p>
          )}
          {row.after === '' ? null : (
            <p className="m-0 rounded-2xl bg-tint-success p-4 text-base font-medium break-words text-tint-success-foreground">
              <span className="sr-only">After: </span>
              {row.after}
            </p>
          )}
          {row.before === '' && row.after === '' ? (
            <p className="m-0 rounded-2xl bg-card p-4 text-base text-muted-foreground">Empty</p>
          ) : null}
        </>
      ) : (
        <DiffHunk before={row.before} after={row.after} showLineNumbers={row.type === 'markdown'} />
      )}
      {/* FigCraft *Change · diff*'s *Revert this change*, one per field: it puts this field back to the saved value. */}
      {onRevert ? (
        <Button
          variant="secondary"
          full
          icon={<Icon name="undo" size={20} />}
          disabled={revertDisabled}
          onClick={onRevert}
          // Which field, in the name itself (a visually hidden span would be joined with a space: "change : Title").
          aria-label={`Revert this change: ${row.label}`}
        >
          Revert this change
        </Button>
      ) : null}
    </section>
  );
}

/**
 * Every changed field of an entry, 16 px apart. With `onRevert` each field the form edits gets *Revert this change*
 * (a key outside the schema has none: the form does not edit it).
 */
export function FieldDiffList({
  rows,
  onRevert,
  revertDisabled,
}: {
  rows: FieldDiffRow[];
  onRevert?: (row: FieldDiffRow) => void;
  revertDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => (
        <FieldDiff
          key={row.key}
          row={row}
          onRevert={onRevert && row.type !== 'unknown' ? () => onRevert(row) : undefined}
          revertDisabled={revertDisabled}
        />
      ))}
    </div>
  );
}

/**
 * A row that only shows something (a file, where a save goes): the `Row` look without its states, for a list item
 * (`li`) or a line of a card. The rows that open something are `Row`s.
 */
export function InfoRow({
  as: Tag = 'div',
  title,
  sub,
  lead,
  trail,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  as?: 'div' | 'li';
  title: ReactNode;
  sub?: ReactNode;
  lead?: IconName;
  trail?: ReactNode;
}) {
  return (
    <Tag className={cn(rowVariants({ size: sub || lead ? 72 : 56 }), className)} {...props}>
      {lead ? <IconTile name={lead} /> : null}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-base font-medium">{title}</span>
        {sub ? <span className="truncate text-sm text-muted-foreground">{sub}</span> : null}
      </span>
      {trail}
    </Tag>
  );
}
