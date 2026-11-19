import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';

import { cn } from '../cn';

/**
 * The field groups of an entry (FigCraft `FieldGroups`, proposal §14.9): a sunken 44 px track holding one 36 px pill per
 * group, the chosen group raised and semibold. A dot after a group's name marks changed (amber) or invalid (red) fields;
 * it is also said in words for assistive technology. shadcn's tabs on Base UI. A group's tab is a 44 px target: the pill
 * is drawn inside it.
 */
export function Tabs({ className, ...props }: Omit<TabsPrimitive.Root.Props, 'className'> & { className?: string }) {
  return <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col gap-4', className)} {...props} />;
}

export function TabsList({
  className,
  ...props
}: Omit<TabsPrimitive.List.Props, 'className'> & { className?: string }) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn('box-border flex h-11 items-center gap-1 rounded-full bg-track p-1 shadow-sunken', className)}
      {...props}
    />
  );
}

export type TabMark = 'changed' | 'invalid';

export interface TabsTriggerProps extends Omit<TabsPrimitive.Tab.Props, 'className' | 'children'> {
  className?: string;
  children?: ReactNode;
  /** Fields in this group that are changed or invalid. */
  mark?: TabMark;
}

export function TabsTrigger({ className, mark, children, ...props }: TabsTriggerProps) {
  const words = mark === 'changed' ? ', changed' : ', has errors';
  // The mark in words. On a string label it goes into the name itself: a visually hidden span is out of the flow, so
  // browsers join it with a space ("Settings , changed").
  const named = mark !== undefined && typeof children === 'string';
  return (
    <TabsPrimitive.Tab
      aria-label={named ? `${children}${words}` : undefined}
      data-slot="tabs-trigger"
      className={cn(
        'group -my-1 flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center border-0 bg-transparent p-0 font-sans text-sm font-medium text-tray-muted-foreground outline-none select-none',
        'data-active:font-semibold data-active:text-foreground data-disabled:cursor-default data-disabled:opacity-40',
        className,
      )}
      {...props}
    >
      <span
        data-focus-ring=""
        className={cn(
          'inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-full px-3 transition-colors duration-150 ease-release',
          'group-data-active:bg-card group-data-active:shadow-raised group-focused:inset-ring-2 group-focused:inset-ring-foreground',
        )}
      >
        <span className="truncate">
          {children}
          {mark && !named ? <span className="sr-only">{words}</span> : null}
        </span>
        {mark ? (
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', mark === 'changed' ? 'bg-chart-1' : 'bg-destructive')}
          />
        ) : null}
      </span>
    </TabsPrimitive.Tab>
  );
}

export function TabsPanel({
  className,
  ...props
}: Omit<TabsPrimitive.Panel.Props, 'className'> & { className?: string }) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn('outline-none', className)} {...props} />;
}
