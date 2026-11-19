import type { ComponentProps } from 'react';

import { cn } from '../cn';

/**
 * A colour as a tile (FigCraft `Swatch/color`): 56 px, radius 12, a 1 px edge. The colour is data (a field's value), so
 * it is the only inline style. Put a native `<input type="color">` inside (the `SwatchInput` below) to make it the
 * picker.
 */
export function Swatch({ color, className, style, children, ...props }: ComponentProps<'span'> & { color: string }) {
  return (
    <span
      data-slot="swatch"
      data-focus-ring=""
      className={cn(
        'relative inline-flex size-14 shrink-0 rounded-xl inset-ring-1 inset-ring-border has-focus-visible:inset-ring-2 has-focus-visible:inset-ring-foreground',
        className,
      )}
      style={{ backgroundColor: color, ...style }}
      {...props}
    >
      {children}
    </span>
  );
}

/** The invisible native colour input laid over a `Swatch`: a click opens the system picker. */
export function SwatchInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input type="color" className={cn('absolute inset-0 size-full cursor-pointer opacity-0', className)} {...props} />
  );
}
