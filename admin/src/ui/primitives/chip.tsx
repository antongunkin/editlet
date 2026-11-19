import { Toggle } from '@base-ui/react/toggle';
import { cva } from 'class-variance-authority';
import type { ReactNode } from 'react';

import { cn } from '../cn';

/**
 * The 44 px hit area around a chip's pill (§14.9: every control sits in a 44 × 44 target even when it draws smaller). It
 * is the control; its states reach the pill through the `group-*` variants of app.css.
 */
export const chipHit =
  'group relative inline-flex h-11 shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 font-sans outline-none select-none data-disabled:cursor-default';

/**
 * The pill of a filter chip (FigCraft `Chip/<label>`, `Chip/All` is the selected one): 36 px, radius full, 14 px medium
 * text. Unselected it is a raised white pill; selected the ink gradient.
 */
export const chipVariants = cva(
  [
    'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium whitespace-nowrap',
    'transition duration-220 ease-release',
    'group-pressed:scale-96 group-pressed:duration-100 group-pressed:ease-press',
    'group-data-disabled:opacity-40 motion-reduce:transition-opacity motion-reduce:group-pressed:scale-100',
    'group-focused:inset-ring-2 forced-colors:border',
  ],
  {
    variants: {
      selected: {
        true: 'bg-gradient-ink text-on-ink shadow-ink-small group-hovered:bg-gradient-ink-hover group-pressed:shadow-ink-pressed group-focused:inset-ring-on-ink',
        false:
          'bg-card text-foreground shadow-raised group-hovered:bg-sunken group-pressed:bg-background group-pressed:shadow-raised-pressed group-focused:inset-ring-ring',
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface ChipProps extends Omit<Toggle.Props, 'className' | 'pressed' | 'defaultPressed' | 'children'> {
  className?: string;
  /** The chosen filter. A chip is a toggle button: `aria-pressed`. */
  selected?: boolean;
  /** A number after the label (`Drafts 2`), muted. */
  count?: ReactNode;
  children?: ReactNode;
}

/** A filter chip (shadcn's toggle on Base UI, restyled). */
export function Chip({ className, selected = false, count, children, ...props }: ChipProps) {
  return (
    <Toggle data-slot="chip" pressed={selected} className={cn(chipHit, className)} {...props}>
      <span data-slot="chip-pill" data-focus-ring="" className={chipVariants({ selected })}>
        {children}
        {count !== undefined ? (
          <span className={selected ? 'text-on-ink-muted' : 'text-muted-foreground'}>{count}</span>
        ) : null}
      </span>
    </Toggle>
  );
}
