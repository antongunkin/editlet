import type { ReactNode } from 'react';

import type { GroupTab } from '../entry/groups';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { BigTitle, Header } from '../ui/parts/header';
import { Tabs, TabsList, TabsPanel, TabsTrigger } from '../ui/primitives/tabs';

// The entry screen as the design draws it (FigCraft *Entry*, *Entry · changed*, *Entry · blocked*): the header (back
// to the collection, ⋯, the window's actions), the big title with the status badge and the last change, the notices,
// the field groups' tab track (FigCraft `FieldGroups`, two groups or more), the fields as rows in one card, and the bottom bar with the status line and the one CTA. Props only: the container
// (EntryScreen.tsx) has the data, and /design renders it from fixtures (src/design/fixtures/entry.tsx).

export interface EntryViewProps {
  /** The header's title: where Back goes (the collection, *Posts*). */
  section: string;
  /** The back link (a `RouteLink`). */
  back?: ReactNode;
  /** The header's actions: ⋯, then the window's Move and Minimize. */
  actions?: ReactNode;
  /** The entry's title: the page's `h1`. */
  title: string;
  /** The status badge (Published, Draft, Unsaved, New). */
  badge?: ReactNode;
  /** The line after the badge: *Updated 5d ago by Dana K*. */
  meta?: ReactNode;
  /** Banners under the title (select-to-edit, conflicts, changed on disk, the shell's notices). */
  banners?: ReactNode;
  /**
   * The field groups (`fieldGroups`): with two or more, a tab track above the card, which shows the chosen group's
   * rows (FigCraft *Entry · Media tab*). The caller passes only the chosen group's rows as `fields`.
   */
  groups?: { tabs: GroupTab[]; value: string; onValueChange(key: string): void };
  /** Names the card of fields for assistive technology (`post/tires fields`). */
  fieldsLabel: string;
  /** The field rows (`FieldRows`, or `FieldRow`s on /design). */
  fields: ReactNode;
  /** After the fields: *Used by*. */
  after?: ReactNode;
  /** The bottom bar's status line (`StatusChips`). */
  status?: ReactNode;
  /** The bottom bar's one CTA: *Save 2 changes*, *Fix 1 field*, *Review changes*. */
  cta?: ReactNode;
  /** The screen's modals (the ⋯ action sheet, the confirms, the review). */
  children?: ReactNode;
}

export function EntryView({
  section,
  back,
  actions,
  title,
  badge,
  meta,
  banners,
  groups,
  fieldsLabel,
  fields,
  after,
  status,
  cta,
  children,
}: EntryViewProps) {
  const card = (
    <Card as="fieldset" aria-label={fieldsLabel}>
      {fields}
    </Card>
  );
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title={section} back={back} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <BigTitle
          as="h1"
          title={title}
          meta={
            badge || meta ? (
              <>
                {badge}
                {meta}
              </>
            ) : undefined
          }
        />
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        {groups !== undefined && groups.tabs.length > 1 ? (
          <Tabs value={groups.value} onValueChange={(key) => groups.onValueChange(String(key))} className="gap-0">
            {/* The track's wrapper: [0, 16, 16, 16] (final.py `tabs`). */}
            <div className="px-4 pb-4">
              <TabsList aria-label="Field groups">
                {groups.tabs.map((tab) => (
                  <TabsTrigger key={tab.key} value={tab.key} mark={tab.mark}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <div className="flex flex-col gap-4 px-4 pb-8">
              {/* No tab stop of its own (Base UI gives the panel one): its rows are the next stops after the tabs. */}
              <TabsPanel value={groups.value} tabIndex={-1}>
                {card}
              </TabsPanel>
              {after}
            </div>
          </Tabs>
        ) : (
          // pb-8: the card's shadow reaches 28 px below it; never cut it (ui4.content).
          <div className="flex flex-col gap-4 px-4 pb-8">
            {card}
            {after}
          </div>
        )}
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      {children}
    </section>
  );
}
