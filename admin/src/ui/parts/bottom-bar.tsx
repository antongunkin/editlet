import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../cn';

export interface BottomBarProps extends ComponentProps<'div'> {
  /** The status line above the action: `StatusChips` with the branch and the state. */
  status?: ReactNode;
}

/**
 * The bar at the bottom of a screen or sheet (FigCraft `BottomBar`, design/figcraft/ui4.py `bottom`): the tray with a
 * hairline and a soft upward shadow (`shadow-bottom-bar`), padding 12 16, the status line and, 12 px below it, the
 * action row (`children`, 8 px apart): at most one primary button, `size="lg" full`, whose label follows the state.
 *
 * It clears the home indicator (bottom padding `max(12px, var(--safe-bottom))`, `pb-safe`) and rides on the on-screen
 * keyboard (`mb-keyboard`: a bottom margin of `var(--keyboard)`). As the last item of a flex column of fixed height (a
 * sheet, a screen), the margin takes the space from the content above it, which gets shorter and keeps the focused
 * field in view; a moved bar would cover it. The site page measures both and the admin sets them on its root
 * (`usePageViewport`, docs/admin/ui.md#bottom-bar-and-status-chips).
 */
export function BottomBar({ status, className, children, ...props }: BottomBarProps) {
  return (
    <div
      data-slot="bottom-bar"
      className={cn('flex flex-col gap-3 bg-background px-4 pt-3 pb-safe shadow-bottom-bar mb-keyboard', className)}
      {...props}
    >
      {status}
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </div>
  );
}
