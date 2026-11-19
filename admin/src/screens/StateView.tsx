import type { ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Header } from '../ui/parts/header';
import { IconTile } from '../ui/primitives/icon-tile';
import type { IconName } from '../ui/primitives/icons';

// A screen that only says why there is nothing to do (FigCraft `state_tile`): *Editing is not set up*, *No write access*,
// *Can't open <repo>*, *Not found*, a branch preview that dev mode does not have. The header (the window's actions), a
// tile with an icon, the title, one paragraph, and the bottom bar when there is a way on. Props only; the containers
// (Unavailable.tsx, NotFound.tsx) pass the nodes in.

export interface StateViewProps {
  /** The header's title: *Editlet* on a gate screen, the screen's name on *Not found*. */
  title: string;
  /** The back link (a `RouteLink`). */
  back?: ReactNode;
  /** The window's Move and Minimize. */
  actions?: ReactNode;
  /** Which text is the page's `h1`: the state's title (a gate screen) or the header's (*Not found*). */
  page?: 'state' | 'header';
  icon: IconName;
  /** `danger` is the red tile of an error; the rest of the stops are plain. */
  tone?: 'neutral' | 'danger';
  heading: string;
  text: ReactNode;
  /** Notices under the header. */
  banners?: ReactNode;
  /** The bottom bar's status line. */
  status?: ReactNode;
  /** The bar's actions: one primary button, or a secondary one (*Sign out*). Without them there is no bar. */
  children?: ReactNode;
}

export function StateView({
  title,
  back,
  actions,
  page = 'state',
  icon,
  tone = 'neutral',
  heading,
  text,
  banners,
  status,
  children,
}: StateViewProps) {
  const Heading = page === 'state' ? 'h1' : 'h2';
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as={page === 'header' ? 'h1' : 'span'} title={title} back={back} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        <div className="flex flex-col items-center gap-3 px-4 pt-12 pb-4 text-center">
          <IconTile name={icon} size={56} tone={tone} />
          <Heading className="m-0 text-2xl font-semibold">{heading}</Heading>
          <p className="m-0 max-w-sm text-base text-tray-muted-foreground">{text}</p>
        </div>
      </div>
      {children ? (
        <BottomBar status={status} className="shrink-0">
          {children}
        </BottomBar>
      ) : null}
    </section>
  );
}
