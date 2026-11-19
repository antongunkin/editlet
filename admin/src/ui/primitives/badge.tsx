import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';

import { cn } from '../cn';

/**
 * A status badge (FigCraft `Badge/<tone>/<label>`, proposal §14.9): a 20 px pill with 12 px medium text on a tint. The
 * tone is the state's colour (unsaved amber, success green, review violet, danger red, neutral grey); the colour never
 * stands alone: the word is the state. `dot` puts the state's dot before the word.
 */
export const badgeVariants = cva(
  'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'bg-muted text-foreground',
        danger: 'bg-tint-danger text-tint-danger-foreground',
        review: 'bg-tint-review text-tint-review-foreground',
        success: 'bg-tint-success text-tint-success-foreground',
        unsaved: 'bg-tint-unsaved text-tint-unsaved-foreground',
      },
      dot: { true: 'pl-1.75', false: '' },
    },
    defaultVariants: { tone: 'neutral', dot: false },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>['tone']>;

export interface BadgeProps extends Omit<ComponentProps<'span'>, 'color'> {
  tone?: BadgeTone;
  /** The state's dot before the label. */
  dot?: boolean;
}

export function Badge({ tone, dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, dot }), className)} {...props}>
      {dot ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}
