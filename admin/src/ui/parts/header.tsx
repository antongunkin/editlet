import type { ComponentProps, ReactNode } from 'react';

import { cn } from '../cn';

/**
 * The title bar of a screen or a sheet (FigCraft `Header`, proposal §14.9): 56 px, with the back button (or 8 px of
 * space), the title (18 px semibold, cut with an ellipsis) over an optional 12 px line, then the actions, each a 44 px icon
 * button. It is the page title (`h1`) on a list or a collection; on a screen that also has a `BigTitle` (an entry) pass
 * `as="span"`, so the page has one `h1`.
 */
export function Header({
  as: Title = 'h1',
  title,
  sub,
  back,
  actions,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  as?: 'h1' | 'h2' | 'span';
  title: ReactNode;
  sub?: ReactNode;
  back?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div data-slot="header" className={cn('flex h-14 items-center gap-1 px-2', className)} {...props}>
      {back ?? <span aria-hidden="true" className="size-2 shrink-0" />}
      <div className="flex min-w-0 flex-1 flex-col">
        <Title className="m-0 truncate text-lg font-semibold text-foreground">{title}</Title>
        {sub ? <span className="truncate text-xs text-tray-muted-foreground">{sub}</span> : null}
      </div>
      {actions}
    </div>
  );
}

/** The header of the search sheet (FigCraft `SearchHeader`): the back button and a search field that takes the rest. */
export function SearchHeader({ back, className, children, ...props }: ComponentProps<'div'> & { back?: ReactNode }) {
  return (
    <div data-slot="search-header" className={cn('flex items-center gap-1 py-2 pr-3 pl-2', className)} {...props}>
      {back}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * The big title of an entry (FigCraft `BigTitle`): 24 px semibold, with a line under it for the status badge and the
 * time of the last change. It is the page title on an entry (`as="h1"`, with the `Header` above it as a `span`); an `h2`
 * otherwise.
 */
export function BigTitle({
  as: Title = 'h2',
  title,
  meta,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & { as?: 'h1' | 'h2'; title: ReactNode; meta?: ReactNode }) {
  return (
    <div
      data-slot="big-title"
      className={cn('flex flex-col gap-2 px-4 pt-2 pb-4 text-2xl font-semibold text-foreground', className)}
      {...props}
    >
      <Title className="m-0 text-2xl font-semibold">{title}</Title>
      {meta ? (
        <div className="flex items-center gap-2 text-sm font-normal text-tray-muted-foreground">{meta}</div>
      ) : null}
    </div>
  );
}
