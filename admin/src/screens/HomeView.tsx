import type { ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Header } from '../ui/parts/header';

// Home as the design draws it (FigCraft *Home*, *Home · with changes*, *Home · branch gone*, *Home · 600*): the header
// (*This page* with the page under it, or *Home*; the account, the theme and the window's actions), the notices, the
// entries on this page, *Your changes* and *All content* as rows, and the bottom bar with the status line and the one
// CTA when there is something to review. Props only: the container (Home.tsx) has the data, and /design renders it
// from fixtures (src/design/fixtures/home.tsx).

export interface HomeViewProps {
  /** The header's title: *This page* when the page has entries, else *Home*. The page's `h1`. */
  title: string;
  /** The line under the title: `rigid.bike › Tires for a rigid bike`. */
  sub?: ReactNode;
  /** The header's actions: the account, the theme, then the window's Move and Minimize. */
  actions?: ReactNode;
  /** Notices under the header (the shell's connection, branch and refresh notices). */
  banners?: ReactNode;
  /** The rows of the entries on this page (`RouteRow`s); the section is left out when there are none. */
  onPage?: ReactNode;
  /** *Your changes* and *All content*: the rows (`RouteRow`, `StaticRow`). */
  rows: ReactNode;
  /** The bottom bar's status line (`StatusChips`). */
  status?: ReactNode;
  /** The bottom bar's one CTA: *Review changes*; nothing when there is nothing to do. */
  cta?: ReactNode;
  /** The screen's modals (the account). */
  children?: ReactNode;
}

export function HomeView({ title, sub, actions, banners, onPage, rows, status, cta, children }: HomeViewProps) {
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header title={title} sub={sub} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        {/* pb-8: the card's shadow reaches 28 px below it; never cut it (ui4.content). */}
        <div className="flex flex-col gap-4 px-4 pb-8">
          {onPage ? (
            <section aria-labelledby="home-on-page" className="flex flex-col gap-2">
              <h2 id="home-on-page" className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">
                On this page
              </h2>
              <Card as="ul">{onPage}</Card>
            </section>
          ) : null}
          <Card as="ul" aria-label="Changes and content">
            {rows}
          </Card>
        </div>
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      {children}
    </section>
  );
}
