import type { ElementType, ReactNode } from 'react';

import { cn } from '../ui/cn';
import { rowVariants } from '../ui/parts/rows';
import { Icon } from '../ui/primitives/icon';

export interface UseRowProps {
  /** The entry that uses the image. */
  title: ReactNode;
  /** *Post · Cover image* */
  sub: ReactNode;
  /** The link: `RouteLink` in the admin (with its `to`), a plain `a` on /design. */
  as?: ElementType;
  [prop: string]: unknown;
}

/**
 * One place an image is used (FigCraft `Row/72`): the entry's title and where in it, a link that opens the entry. A
 * real link (`?editlet=` address, opens in a new tab), so it is a row in look only (rows.tsx draws buttons).
 */
export function UseRow({ title, sub, as: Tag = 'a', className, ...props }: UseRowProps) {
  return (
    <Tag
      data-slot="row"
      className={cn(rowVariants({ size: 72, pressable: true }), 'no-underline', className as string | undefined)}
      {...props}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-base font-medium">{title}</span>
        <span className="truncate text-sm font-normal text-muted-foreground group-pressed:text-tray-muted-foreground">
          {sub}
        </span>
      </span>
      <Icon name="chevron-right" size={16} className="shrink-0 text-subtle" />
    </Tag>
  );
}
