import type { ReactNode } from 'react';

import { RouteLink, type RouteLinkProps } from '../RouteLink';
import { cn } from '../ui/cn';
import { RowChevron, RowText, rowVariants } from '../ui/parts/rows';
import { IconTile } from '../ui/primitives/icon-tile';
import type { IconName } from '../ui/primitives/icons';

export interface RouteRowProps extends Omit<RouteLinkProps, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  /** An icon on a 40 px tile before the text. */
  lead: IconName;
  /** Something after the text: a badge, a count. */
  trail?: ReactNode;
}

/**
 * A `Row` (ui/parts/rows.tsx) that is a real `?editlet=` link: it opens a screen, and open-in-new-tab works. Drawn as the
 * button row is (the same `rowVariants`, text and chevron), so the lists of Home and All content are one family.
 */
export function RouteRow({ title, sub, lead, trail, className, ...props }: RouteRowProps) {
  return (
    <RouteLink
      data-slot="row"
      className={cn(rowVariants({ size: 72, pressable: true }), 'no-underline', className)}
      {...props}
    >
      <IconTile name={lead} />
      <RowText title={title} sub={sub} />
      {trail}
      <RowChevron />
    </RouteLink>
  );
}

/** A row that opens nothing (*Your changes · Nothing waiting*): the same look, no chevron, not a control. */
export function StaticRow({
  title,
  sub,
  lead,
  trail,
}: {
  title: ReactNode;
  sub?: ReactNode;
  lead: IconName;
  trail?: ReactNode;
}) {
  return (
    <div data-slot="row" className={rowVariants({ size: 72 })}>
      <IconTile name={lead} />
      <RowText title={title} sub={sub} />
      {trail}
    </div>
  );
}
