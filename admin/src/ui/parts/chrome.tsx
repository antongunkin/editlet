import type { ComponentProps } from 'react';

import { cn } from '../cn';

/**
 * The handle at the top of a sheet (FigCraft `Grabber`): a 36 × 4 bar on the grabber colour. Decoration: dragging it is
 * a pointer gesture. `children` sit over the bar (a sheet passes its pointer-only close area).
 */
export function Grabber({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="grabber" className={cn('relative flex shrink-0 justify-center pt-2 pb-1', className)} {...props}>
      <div aria-hidden="true" className="h-1 w-9 rounded-full bg-grabber" />
      {children}
    </div>
  );
}

/**
 * The collapsed window (FigCraft `Pill/collapsed`): a 56 px card pill on the pill shadow holding the *Editlet* button
 * (which opens the editor) and the × (which closes it).
 */
export function Pill({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="pill"
      className={cn('box-border inline-flex h-14 items-center gap-1 rounded-full bg-card p-1.5 shadow-pill', className)}
      {...props}
    />
  );
}

/** The fade at the bottom edge of the page preview behind a sheet (FigCraft `SheetEdge`): clear to a 24 % ink over 60 px. */
export function SheetEdge({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-edge"
      aria-hidden="true"
      className={cn('h-15 w-full bg-gradient-sheet-edge', className)}
      {...props}
    />
  );
}
