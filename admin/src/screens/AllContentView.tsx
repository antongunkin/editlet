import type { ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Header } from '../ui/parts/header';

// *All content* as the design draws it (FigCraft *All content*): the header with Back to Home, the collections as
// rows, then Media and the Content model; the bottom bar has the status line only. It replaces the navigation menu of
// the old title bar. Props only: the container (AllContent.tsx) has the data; /design renders it from
// src/design/fixtures/home.tsx.

export interface AllContentViewProps {
  /** The back link (a `RouteLink`). */
  back?: ReactNode;
  /** The header's actions: the window's Move and Minimize. */
  actions?: ReactNode;
  banners?: ReactNode;
  /** The collections: `RouteRow`s. */
  collections: ReactNode;
  /** Media and the Content model: `RouteRow`s. */
  more: ReactNode;
  status?: ReactNode;
}

export function AllContentView({ back, actions, banners, collections, more, status }: AllContentViewProps) {
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header title="All content" back={back} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        <div className="flex flex-col gap-4 px-4 pb-8">
          <Card as="ul" aria-label="Collections">
            {collections}
          </Card>
          <Card as="ul" aria-label="More">
            {more}
          </Card>
        </div>
      </div>
      <BottomBar status={status} className="shrink-0" />
    </section>
  );
}
