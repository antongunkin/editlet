import type { HTMLAttributes } from 'react';

import { cn } from '../cn';

/**
 * A group of rows (FigCraft `Card`, proposal §14.9): a raised white card with a 16 px radius on the tray, its rows divided
 * by a 1 px line inset 16 px from the left (`ui4.divided`), drawn on each row after the first. The rows are `Row`,
 * `FieldRow`, `Option`, `Action`… (rows.tsx).
 */
export function Card({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  /** `fieldset` for a named group of rows (with `aria-label`), `ul` for a list (its rows in `li`s). */
  as?: 'div' | 'fieldset' | 'ul';
}) {
  return (
    <Tag
      data-slot="card"
      className={cn(
        'm-0 flex min-w-0 list-none flex-col overflow-hidden rounded-2xl border-0 bg-card p-0 shadow-card',
        '*:relative *:not-first:before:absolute *:not-first:before:top-0 *:not-first:before:right-0 *:not-first:before:left-4 *:not-first:before:h-px *:not-first:before:bg-border',
        className,
      )}
      {...props}
    />
  );
}
