import type { ReactNode } from 'react';

import { SectionTitle } from './ModelSections';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { BigTitle, Header } from '../ui/parts/header';

// The content model screen (FigCraft *Content model*, *· problems*): the header (back, refresh, ⋯, the window's
// actions), the big title with the verdict (*No problems* / *2 problems*) and the schema file, what is wrong, the
// collections as rows, and the bottom bar with the one CTA, *Ask Claude Code*. Props only: the container
// (ContentModel.tsx) has the data, and /design renders it from fixtures (src/design/fixtures/model.tsx).

export interface ContentModelViewProps {
  back?: ReactNode;
  /** Refresh, ⋯, then the window's Move and Minimize. */
  actions?: ReactNode;
  /** The verdict: a `Badge`. */
  badge?: ReactNode;
  /** After the badge: the schema file, when it was updated. */
  meta?: ReactNode;
  /** Notices under the title: what was removed, the shell's connection and branch notices. */
  banners?: ReactNode;
  /** The problems card. */
  problems?: ReactNode;
  /** *Collections · 7*. */
  collectionsLabel: string;
  /** The rows (`CollectionRow` in `li`s); the screen draws them in one card. */
  rows: ReactNode;
  /** Shown instead of the card when there are no collections. */
  empty?: ReactNode;
  status?: ReactNode;
  /** The bar's one CTA. */
  cta?: ReactNode;
  /** The screen's modals. */
  children?: ReactNode;
}

export function ContentModelView({
  back,
  actions,
  badge,
  meta,
  banners,
  problems,
  collectionsLabel,
  rows,
  empty,
  status,
  cta,
  children,
}: ContentModelViewProps) {
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title="Content model" back={back} actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <BigTitle
          as="h1"
          title="Content model"
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
        {problems ? <div className="px-4 pb-4">{problems}</div> : null}
        {/* pb-8: the card's shadow reaches 28 px below it; never cut it. */}
        <div className="px-4 pb-8">
          <SectionTitle>{collectionsLabel}</SectionTitle>
          {empty ?? (
            <Card as="ul" aria-label="Collections">
              {rows}
            </Card>
          )}
        </div>
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      {children}
    </section>
  );
}
