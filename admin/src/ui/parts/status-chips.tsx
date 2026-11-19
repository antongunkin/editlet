import { cva } from 'class-variance-authority';
import { useId, type ComponentProps, type ReactNode } from 'react';

import { cn } from '../cn';
import { Icon } from '../primitives/icon';

// The status line of the bottom bar (FigCraft `StatusChips`, design/figcraft/ui4.py `status_line`): the branch, then
// the unsaved edits or one status. Each chip is a 32 px pill, padding 0 12 0 10, gap 6, 14 px medium text.

const pill =
  'inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-sm font-medium whitespace-nowrap';

/**
 * A chip that is a button: a 44 px hit area over the 32 px pill (§14.9). It takes only the pill's 32 px of layout, so
 * the status line keeps the design's height, and it grows upward only (`-mt-3`, into the bar's 12 px top padding):
 * nothing of it lies below the pill, where a window's bottom resize edge is. Its states reach the pill through the
 * `group-*` variants.
 */
const hit =
  'group relative -mt-3 inline-flex h-11 min-w-0 shrink-0 cursor-pointer items-end border-0 bg-transparent p-0 font-sans outline-none select-none disabled:cursor-default';
const motion = [
  'transition duration-220 ease-release',
  'group-pressed:scale-96 group-pressed:duration-100 group-pressed:ease-press',
  'motion-reduce:transition-opacity motion-reduce:group-pressed:scale-100',
  'group-focused:inset-ring-2 group-focused:inset-ring-ring forced-colors:border',
];

/** The state's dot (8 px) before a chip's words: the colour never stands alone. */
function Dot({ className }: { className: string }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', className)} />;
}

export type StatusTone = 'success' | 'danger' | 'unsaved';

export const statusChipVariants = cva(pill, {
  variants: {
    tone: {
      success: 'bg-tint-success text-tint-success-foreground',
      danger: 'bg-tint-danger text-tint-danger-foreground',
      unsaved: 'bg-tint-unsaved text-tint-unsaved-foreground',
    },
  },
});

const MARK: Record<StatusTone, ReactNode> = {
  success: <Icon name="check" size={16} className="shrink-0 text-chart-2" />,
  danger: <Dot className="bg-destructive" />,
  unsaved: <Dot className="bg-chart-1" />,
};

export interface StatusChipProps extends ComponentProps<'span'> {
  tone: StatusTone;
  /** A 16 px icon in place of the tone's mark (an upload waiting for the save: `upload` in `text-chart-1`). */
  icon?: ReactNode;
}

/**
 * One status on a tint (FigCraft `StatusChip/<tone>`): `success` with a check (*Saved · 1 commit*), `danger` and
 * `unsaved` with a dot (*Offline*, *1 uncommitted*). Not a control.
 */
export function StatusChip({ tone, icon, className, children, ...props }: StatusChipProps) {
  return (
    <span data-slot="status-chip" className={cn(statusChipVariants({ tone }), className)} {...props}>
      {icon ?? MARK[tone]}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export interface BranchChipProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** The branch's name; it is cut with an ellipsis when the line is short. */
  name: string;
  /** Muted words after the name: `live` on the base branch, the pull request's `#12`. */
  suffix?: ReactNode;
  /** Off the base branch the branch icon takes the branch colour (`chart-5`). */
  offBase?: boolean;
  /**
   * The whole branch line in words, for a chip with an `aria-label` (*Branch main live*): its `aria-describedby`
   * (`main · live`, `editlet/spring #1`). The name by default.
   */
  description?: string;
  /** Props of the pill (`data-path` on /design). */
  pillProps?: ComponentProps<'span'> & Record<`data-${string}`, string>;
}

/**
 * The branch (FigCraft `BranchChip`): a raised white chip with the branch icon, the name and a chevron, a button that
 * opens the branch picker. It is the part of a status line that gives way: it shrinks and cuts the name with an
 * ellipsis. With an `aria-label` (*Branch main live*), the `description` describes the button. Hover is the sunken fill (the
 * filter chip's), on which the muted suffix keeps 4.5 : 1. A call site in an intrinsically sized box (a grid's `auto`
 * column) caps the width with a length (`max-w-64`): `max-w-full` does not limit a min-content size, and a long name
 * would widen the box.
 */
export function BranchChip({
  name,
  suffix,
  offBase = false,
  description,
  pillProps,
  className,
  ...props
}: BranchChipProps) {
  const descriptionId = useId();
  const described = Boolean(props['aria-label']);
  return (
    <>
      <button
        type="button"
        data-slot="branch-chip"
        aria-describedby={described ? descriptionId : undefined}
        className={cn(hit, 'max-w-full shrink', className)}
        {...props}
      >
        <span
          data-focus-ring=""
          {...pillProps}
          className={cn(
            pill,
            'max-w-full bg-card text-foreground shadow-raised',
            'group-hovered:bg-sunken group-pressed:bg-background group-pressed:shadow-raised-pressed',
            motion,
            pillProps?.className,
          )}
        >
          <Icon
            name="branch"
            size={16}
            className={cn('shrink-0', offBase ? 'text-chart-5' : 'text-muted-foreground')}
          />
          <span className="min-w-0 truncate">{name}</span>
          {suffix ? (
            <>
              {' '}
              <span className="shrink-0 font-normal text-muted-foreground tabular-nums">{suffix}</span>
            </>
          ) : null}
          <Icon name="chevron-down" size={16} className="shrink-0 text-muted-foreground" />
        </span>
      </button>
      {described ? (
        <span id={descriptionId} hidden>
          {description ?? name}
        </span>
      ) : null}
    </>
  );
}

export interface ChangesChipProps extends ComponentProps<'button'> {
  /** Props of the pill (`data-path` on /design). */
  pillProps?: ComponentProps<'span'> & Record<`data-${string}`, string>;
}

/** The unsaved edits (FigCraft `ChangesChip`): an amber dot and *2 unsaved* on the unsaved tint, a button that opens them. */
export function ChangesChip({ pillProps, className, children, ...props }: ChangesChipProps) {
  return (
    <button type="button" data-slot="changes-chip" className={cn(hit, className)} {...props}>
      <span
        data-focus-ring=""
        {...pillProps}
        className={cn(pill, 'bg-tint-unsaved text-tint-unsaved-foreground', motion, pillProps?.className)}
      >
        <Dot className="bg-chart-1" />
        {children}
      </span>
    </button>
  );
}

/** The status line (FigCraft `StatusChips`): the chips in a row, 8 px apart; on a narrow screen they wrap. */
export function StatusChips({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="status-chips"
      className={cn('flex w-full min-w-0 flex-wrap items-center gap-2', className)}
      {...props}
    />
  );
}
