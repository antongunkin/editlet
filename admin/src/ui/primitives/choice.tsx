import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import type { ReactNode } from 'react';

import { cn } from '../cn';

/**
 * One answer of a choice between two or more (FigCraft `Choice/…`, the conflict dialog's *Yours* and *On GitHub*): a
 * card with a 1 px edge; the chosen one has a 2 px ink edge and the raised shadow. A radio, so use it inside a
 * `RadioGroup`.
 */
export function Choice({
  className,
  children,
  ...props
}: Omit<RadioPrimitive.Root.Props, 'className' | 'children'> & { className?: string; children?: ReactNode }) {
  return (
    <RadioPrimitive.Root
      data-slot="choice"
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-2xl border-0 bg-card px-4 py-3 text-left font-sans text-foreground outline-none',
        'inset-ring-1 inset-ring-border transition-shadow duration-150 ease-release',
        'data-checked:inset-ring-2 data-checked:inset-ring-foreground data-checked:shadow-raised',
        'focused:outline-2 focused:outline-offset-2 focused:outline-ring data-disabled:cursor-default data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      {children}
    </RadioPrimitive.Root>
  );
}
