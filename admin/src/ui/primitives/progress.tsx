import type { ComponentProps } from 'react';

import { cn } from '../cn';

export interface ProgressProps extends Omit<ComponentProps<'div'>, 'children'> {
  /** How far: `value` of `max` (clamped to 0…`max`). */
  value: number;
  max: number;
}

/**
 * A thin progress bar (FigCraft `Progress`): a 4 px track on `muted`, the fill on `primary`, both fully round. It is
 * decorative (`aria-hidden`): the words next to it say where the user is (the alt queue's *3 of 12*), so it has no
 * role, and a screen reader skips it.
 */
export function Progress({ value, max, className, ...props }: ProgressProps) {
  const done = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  return (
    <div
      data-slot="progress"
      aria-hidden="true"
      className={cn('h-1 w-full overflow-hidden rounded-full bg-muted', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-primary transition-all duration-220 motion-reduce:transition-none"
        style={{ width: `${Math.round(done * 100)}%` }}
      />
    </div>
  );
}
