import { useEffect, useRef, type ReactNode } from 'react';

import { moveAmongRadios, PAGE_SIZE, radioTab } from './listControls';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Card } from '../ui/parts/card';
import { Header } from '../ui/parts/header';
import { Option, Row } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Chip } from '../ui/primitives/chip';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { IconTile } from '../ui/primitives/icon-tile';

// The list of a collection as the design draws it (FigCraft *Posts*, *Posts · sort*, *Posts · more*, *Posts · loading*,
// *Tags · empty*, *Posts · 600*): the header (back, the collection's name, sort, the window's actions), the filter chips,
// the entries as rows in one card, 20 at a time, and the bottom bar with the status line and the one CTA, *New post*. Props only: the container (Collection.tsx) has the
// data, and /design renders it from fixtures (src/design/fixtures/collection.tsx).

/** The key of a filter chip: `all`, or one of `filters` (the admin's: `drafts`, `changed`, `review`). */
export type CollectionFilter = string;

/** One entry of the list. */
export interface CollectionRowData {
  key: string;
  title: string;
  /** The status in a word (*Published*), for the line under the title on a phone. */
  statusText: string;
  /** The status as a badge, for the 600 px window. */
  badge: ReactNode;
  /** The chips (keys of `filters`) it is counted under, besides *All*. */
  filters?: string[];
  /** When it was last changed (a `When`), or nothing without a history. */
  updated?: ReactNode;
  /** Who changed it last (*Dana K*). */
  by?: string;
  /** Its summary is not read yet: `title` is the slug, and a loading bar stands where its status goes. */
  loading?: boolean;
  onOpen(): void;
}

// Rows shown at a time; the last row of the card shows the next ones. Passed on for the list's container and /design.
export { PAGE_SIZE };

/** One order of *Sort*. */
export interface CollectionSortData {
  key: string;
  label: string;
}

/** A chip after *All*. */
export interface CollectionFilterData {
  key: string;
  label: string;
  /** What the chip says when nothing is in it: *No drafts. Every entry is published.* */
  empty: string;
  /** Its rows are not known yet (the file statuses load): the count shows *…*. */
  pending?: boolean;
}

export interface CollectionViewProps {
  /** The collection's name: the page's `h1`. */
  title: string;
  /** The back link (a `RouteLink`). */
  back?: ReactNode;
  /** The header's actions: the window's Move and Minimize. */
  actions?: ReactNode;
  /** Notices under the header (the shell's connection, branch and refresh notices, a load error). */
  banners?: ReactNode;
  /** The entries; `undefined` while they load (placeholder rows, the CTA already works). */
  rows?: CollectionRowData[];
  /** An order or chip that needs every entry's title is reading them: the line under the chips counts them. */
  progress?: { loaded: number; total: number };
  /** The chips after *All*: *Drafts*, *Changed*, *In review* (each counts the rows whose `filters` name it). */
  filters: CollectionFilterData[];
  /** Which chip is on. */
  filter: CollectionFilter;
  onFilter(filter: CollectionFilter): void;
  /** The orders *Sort* offers, which one is on, and the sheet. Rows come in that order. */
  sorts: CollectionSortData[];
  sort: string;
  onSort(sort: string): void;
  sortOpen: boolean;
  onSortOpenChange(open: boolean): void;
  /** How many rows show (a multiple of `PAGE_SIZE`); *Show 20 more* calls `onMore`. */
  limit: number;
  onMore(): void;
  /** The 600 px window: a status badge and the date after the title, one line a row, instead of a line under it. */
  wide?: boolean;
  /** Says what an empty collection is: *No tags yet*. */
  emptyTitle?: string;
  emptyText?: string;
  /** The bottom bar's status line (`StatusChips`). */
  status?: ReactNode;
  /** The bottom bar's one CTA: *New post*. */
  cta?: ReactNode;
  /** The screen's modals (*New post*). */
  children?: ReactNode;
}

const PLACEHOLDERS = [0, 1, 2, 3, 4, 5];

function Chips({
  filter,
  onFilter,
  all,
  filters,
}: {
  filter: CollectionFilter;
  onFilter(filter: CollectionFilter): void;
  all: ReactNode;
  filters: { key: string; label: string; count: ReactNode }[];
}) {
  return (
    // 4 px above, 12 below, 16 at the sides (final.chips); each chip's 44 px hit area is 4 px taller than its pill.
    <fieldset aria-label="Show" className="m-0 flex min-w-0 items-center gap-2 overflow-x-auto border-0 px-4 pt-1 pb-3">
      <Chip selected={filter === 'all'} count={all} onClick={() => onFilter('all')}>
        All
      </Chip>
      {filters.map((f) => (
        <Chip key={f.key} selected={filter === f.key} count={f.count} onClick={() => onFilter(f.key)}>
          {f.label}
        </Chip>
      ))}
    </fieldset>
  );
}

/** When and who: *5d ago · Dana K*. */
const Changed = ({ row }: { row: CollectionRowData }) =>
  row.updated ? (
    <>
      {row.updated}
      {row.by ? ` · ${row.by}` : null}
    </>
  ) : null;

/** The status, when and who, after the title in the 600 px window (`Posts · 600`). */
function Trail({ row }: { row: CollectionRowData }) {
  return (
    <span className="flex shrink-0 items-center gap-3">
      {row.badge}
      {row.updated ? (
        <span className="text-sm text-muted-foreground">
          <Changed row={row} />
        </span>
      ) : null}
    </span>
  );
}

/** `Row`'s loading bar, for a row that already has a title (its slug) and opens. Exported for /design. */
export const LoadingBar = () => (
  <span className="flex h-5 items-center">
    <span className="sr-only">Loading…</span>
    <span aria-hidden="true" className="h-2 w-28 rounded-full bg-muted" />
  </span>
);

function Entry({ row, wide }: { row: CollectionRowData; wide?: boolean }) {
  return (
    <li>
      <Row
        title={row.title}
        aria-busy={row.loading || undefined}
        // A phone: the line under the title says the status, when and who (*Published · 5d ago · Dana K*).
        sub={
          wide ? undefined : row.loading ? (
            <LoadingBar />
          ) : (
            <>
              {row.statusText}
              {row.updated ? (
                <>
                  {' · '}
                  <Changed row={row} />
                </>
              ) : null}
            </>
          )
        }
        trail={wide ? row.loading ? <LoadingBar /> : <Trail row={row} /> : undefined}
        size={wide ? 56 : 72}
        onClick={row.onOpen}
      />
    </li>
  );
}

function Placeholders({ wide }: { wide?: boolean }) {
  return (
    <>
      {PLACEHOLDERS.map((i) => (
        <li key={i}>
          <Row title="" loading size={wide ? 56 : 72} />
        </li>
      ))}
    </>
  );
}

export function CollectionView({
  title,
  back,
  actions,
  banners,
  rows,
  progress,
  filters,
  filter,
  onFilter,
  sorts,
  sort,
  onSort,
  sortOpen,
  onSortOpenChange,
  limit,
  onMore,
  wide,
  emptyTitle = 'No entries yet',
  emptyText,
  status,
  cta,
  children,
}: CollectionViewProps) {
  const loading = rows === undefined;
  const chips = filters.map((f) => ({
    ...f,
    count: f.pending ? '…' : (rows?.filter((r) => r.filters?.includes(f.key)).length ?? 0),
  }));
  const on = filters.find((f) => f.key === filter);
  // A chip whose rows are not known yet shows placeholder rows, never its empty text.
  const busy = loading || on?.pending === true;
  const reading = progress !== undefined && progress.loaded < progress.total;
  const matching = on ? (rows ?? []).filter((r) => r.filters?.includes(on.key)) : (rows ?? []);
  const shown = matching.slice(0, limit);
  const rest = matching.length - shown.length;
  // *Show 20 more*: the focus goes to the first row it adds, as the button it was on goes away with the last page.
  const list = useRef<HTMLDivElement>(null);
  const before = useRef(limit);
  useEffect(() => {
    if (limit > before.current)
      list.current?.querySelectorAll('ul > li')[before.current]?.querySelector('button')?.focus();
    before.current = limit;
  }, [limit]);
  const sortButton =
    rows !== undefined && rows.length === 0 ? null : (
      <IconButton
        label="Sort"
        aria-haspopup="dialog"
        onClick={() => onSortOpenChange(true)}
        icon={<Icon name="sort" size={20} />}
      />
    );
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header
        title={title}
        back={back}
        actions={
          <>
            {sortButton}
            {actions}
          </>
        }
        className="shrink-0"
      />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        {/* What a screen reader hears when an order or chip starts reading titles: once, not at every count. */}
        {/* No role: the list's one `status` is an empty chip's text. */}
        <p aria-live="polite" className="sr-only">
          {reading ? 'Loading titles…' : ''}
        </p>
        {rows !== undefined && rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 pt-16 pb-4 text-center">
            <IconTile name="file" size={56} />
            <p className="m-0 text-lg font-semibold">{emptyTitle}</p>
            {emptyText ? <p className="m-0 text-base text-tray-muted-foreground">{emptyText}</p> : null}
          </div>
        ) : (
          <>
            <Chips
              filter={filter}
              onFilter={onFilter}
              all={loading ? '…' : rows.length}
              filters={loading ? [] : chips}
            />
            {reading ? (
              // Search's line (SearchView.tsx), 20 px in like the text there.
              <p className="m-0 px-5 pb-2 text-sm text-tray-muted-foreground">
                Loading titles: {progress.loaded.toLocaleString('en')} of {progress.total.toLocaleString('en')}.
              </p>
            ) : null}
            {/* pb-8: the card's shadow reaches 28 px below it; never cut it (ui4.content). */}
            <div ref={list} className="px-4 pb-8">
              {!busy && shown.length === 0 ? (
                <output className="block px-1 py-6 text-center text-base text-tray-muted-foreground">
                  {on?.empty}
                </output>
              ) : (
                <Card as="ul" aria-label={`${title} entries`} aria-busy={busy || undefined}>
                  {busy ? (
                    <Placeholders wide={wide} />
                  ) : (
                    shown.map((row) => <Entry key={row.key} row={row} wide={wide} />)
                  )}
                  {!busy && rest > 0 ? (
                    <li>
                      <Row
                        title={`Show ${Math.min(PAGE_SIZE, rest)} more`}
                        sub={`${shown.length} of ${matching.length} shown`}
                        lead="plus"
                        chevron={false}
                        onClick={onMore}
                      />
                    </li>
                  ) : null}
                </Card>
              )}
            </div>
          </>
        )}
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      <Sheet open={sortOpen} onOpenChange={onSortOpenChange} title="Sort" sub={title}>
        <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
          <Card role="radiogroup" aria-label="Sort by" onKeyDown={moveAmongRadios}>
            {sorts.map((s, i) => (
              <Option
                key={s.key}
                title={s.label}
                selected={s.key === sort}
                tabIndex={radioTab(s.key === sort, i === 0, true)}
                onClick={() => {
                  onSort(s.key);
                  onSortOpenChange(false);
                }}
              />
            ))}
          </Card>
        </div>
      </Sheet>
      {children}
    </section>
  );
}
