import { useEffect, useMemo, useState } from 'react';

import { DEFAULT_SORT, LAZY_THRESHOLD, needsAll, SORTS, sortRows, type Sortable, type SortKey } from './collectionSort';
import {
  CollectionView,
  PAGE_SIZE,
  type CollectionFilter,
  type CollectionFilterData,
  type CollectionRowData,
} from './CollectionView';
import { shortName, When } from './EntryMeta';
import { entryNoun, NewEntryDialog } from './NewEntryDialog';

import { collectionNames } from '../../../core/schema';
import type { FileEvent } from '../../../core/source';
import { useBuffer } from '../changes/trayContext';
import { useCollectionRefs, useEntries, type SchemaData } from '../data/queries';
import { useWorkspace } from '../github/workspace';
import { parentRoute } from '../route';
import { RouteLink } from '../RouteLink';
import { useLastCommits } from '../status/lastCommits';
import { fileStatusLabel, useFileStatuses } from '../status/useFileStatus';
import { Banner, Button, buttonVariants, cn, Icon } from '../ui';
import { StatusBadge } from '../ui/StatusBadge';
import { useRoute } from '../useRoute';
import { useScreenChrome } from '../window/chrome';

/** The admin is as wide as its window: from this width (a 600 px window, not a phone) a row is one line. */
const WIDE_PX = 480;

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= WIDE_PX);
  useEffect(() => {
    const onResize = () => setWide(window.innerWidth >= WIDE_PX);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return wide;
}

/** A row's last change as the list sorts and shows it. */
function changeOf(event: FileEvent | null | undefined): Sortable['updated'] {
  return event ? { date: event.date, by: shortName(event.actor) } : null;
}

/**
 * The chips after *All*. *In review* is GitHub mode's: the dev server has no pull requests. *Drafts* is not counted
 * until every entry's summary is read; *Changed* and *In review* need the file statuses only.
 */
function collectionFilters(github: boolean, pending: boolean, noDrafts: boolean): CollectionFilterData[] {
  const filters: CollectionFilterData[] = [
    { key: 'drafts', label: 'Drafts', empty: 'No drafts. Every entry is published.', pending: noDrafts },
    {
      key: 'changed',
      label: 'Changed',
      empty: 'Nothing changed. Edits and saved changes that are not live show here.',
      pending,
    },
  ];
  if (github) filters.push({ key: 'review', label: 'In review', empty: 'Nothing in review.', pending });
  return filters;
}

/**
 * Entries of a (non-singleton) collection as rows under filter chips (*All*, *Drafts*, *Changed*, *In review*): the
 * title, and under it the status (the file's status first: *Unsaved*, *In review*, *Changed*; else *Draft* or
 * *Published*), when the file was last changed and who changed it (the file's last commit). *Changed* holds the
 * entries edited in this browser and those saved but not live; *In review* those in an open pull request. Newest change first until *Sort*
 * says another order; 20 rows at a time. *New* in the bottom bar asks for the name first (NewEntryDialog). The view is
 * CollectionView.tsx.
 *
 * From `LAZY_THRESHOLD` entries only the rows on screen read their summaries (title, draft): the rows come from the file
 * list, their order from the last commits, and a row shows its slug until its summary is there. A title or status order,
 * or the *Drafts* chip (`needsAll`), reads every summary.
 */
export function Collection({ collection, schema }: { collection: string; schema: SchemaData }) {
  const { navigate } = useRoute();
  const workspace = useWorkspace();
  const refs = useCollectionRefs(collection);
  // The last commit of every entry file: when it changed, and who (one batch of 50 paths in GitHub mode).
  const { updated: lastCommits, pending: datesPending } = useLastCommits(refs);
  const statuses = useFileStatuses();
  const buffer = useBuffer();
  const chrome = useScreenChrome();
  const wide = useWide();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [sortOpen, setSortOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [askedAll, setAskedAll] = useState(false);
  const def = schema.schema.collections[collection];
  const label = def?.label ?? collection;
  const heading = def ? collectionNames(def).many : collection;

  const lazy = refs.length >= LAZY_THRESHOLD;
  const readsAll = lazy && needsAll(sort, filter);
  // Once every summary was asked for, the screen keeps asking: the *Drafts* count stays exact (they cost no new read).
  if (readsAll && !askedAll) setAskedAll(true);
  const wantsAll = !lazy || askedAll || readsAll;
  // A large list has no order before its dates. A failed or empty answer is one too: the rows then go by slug.
  const dated = !datesPending || lastCommits.size > 0;

  // Unsaved new entries (and copies) of this collection: first, with the *Unsaved* badge.
  const listed = new Set(refs.map((r) => r.path));
  const fresh = buffer.entries.filter((e) => e.collection === collection && e.isNew && !listed.has(e.path));
  const freshRows = fresh.map((e): CollectionRowData => ({
    key: e.path,
    title: e.title,
    statusText: fileStatusLabel('unsaved'),
    badge: <StatusBadge draft={e.after?.data.draft === true} status="unsaved" showPublished />,
    filters: [...(e.after?.data.draft === true ? ['drafts'] : []), 'changed'],
    onOpen: () => navigate({ kind: 'entry', collection, slug: e.slug }),
  }));
  const filtersOf = (path: string, draft: boolean | null) => {
    const { unsaved, changed, review } = statuses.refs;
    return [
      ...(draft ? ['drafts'] : []),
      ...(unsaved.has(path) || changed.has(path) ? ['changed'] : []),
      ...(review.has(path) ? ['review'] : []),
    ];
  };

  // Which rows are on screen: it takes their dates and file statuses only, never a summary, so that what is read does
  // not depend on what has been read.
  const byDate = useMemo(
    () =>
      wantsAll
        ? []
        : sortRows(
            refs.map((r) => ({
              path: r.path,
              slug: r.slug,
              title: null,
              draft: null,
              updated: changeOf(lastCommits.get(r.path)),
            })),
            sort,
            { bySlug: true },
          ),
    [wantsAll, refs, lastCommits, sort],
  );
  const shows = (filters: string[] | undefined) => filter === 'all' || filters?.includes(filter) === true;
  const room = Math.max(0, limit - freshRows.filter((row) => shows(row.filters)).length);
  const visible = (dated ? byDate : []).filter((r) => shows(filtersOf(r.path, null))).slice(0, room);
  const entries = useEntries(collection, wantsAll ? 'all' : new Set(visible.map((r) => r.path)));

  // What the editor would see on opening an entry with unsaved edits: its unsaved title.
  const bufferedTitle = new Map(buffer.entries.map((e) => [e.path, e.title]));
  // A small list waits for every summary; a large one for its dates.
  const list = entries.data && (lazy ? dated : entries.loaded >= entries.total) ? entries.data : undefined;
  const rows: CollectionRowData[] | undefined = list
    ? [
        ...freshRows,
        ...sortRows(
          list.map((e) => ({
            ...e,
            title: bufferedTitle.get(e.path) ?? e.title,
            updated: changeOf(lastCommits.get(e.path)),
          })),
          sort,
          { bySlug: lazy },
        ).map((row): CollectionRowData => {
          const status = statuses.of(row.path);
          return {
            key: row.path,
            title: row.title ?? row.slug,
            loading: row.draft === null,
            statusText: status ? fileStatusLabel(status) : row.draft ? 'Draft' : 'Published',
            badge: <StatusBadge draft={row.draft === true} status={status} showPublished />,
            filters: filtersOf(row.path, row.draft),
            updated: row.updated ? <When date={row.updated.date} /> : undefined,
            by: row.updated?.by,
            onOpen: () => navigate({ kind: 'entry', collection, slug: row.slug }),
          };
        }),
      ]
    : undefined;
  // Under the threshold the *Drafts* count is there with the rows.
  const noDrafts = lazy && (list?.some((e) => e.draft === null) ?? false);

  const home = parentRoute({ kind: 'collection', collection });
  return (
    <CollectionView
      title={heading}
      back={
        home ? (
          <RouteLink
            to={home}
            className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
            aria-label="Back"
            title={`Back to ${home.kind === 'content' ? 'All content' : 'Home'}`}
          >
            <Icon name="chevron-left" size={20} />
          </RouteLink>
        ) : undefined
      }
      actions={chrome.windowActions}
      banners={
        <>
          {chrome.banners}
          {entries.error ? (
            <Banner tone="danger" role="alert">
              {entries.error.message}
            </Banner>
          ) : null}
        </>
      }
      rows={entries.error ? [] : rows}
      progress={readsAll ? entries : undefined}
      filters={collectionFilters(workspace !== null, !statuses.ready, noDrafts)}
      filter={filter}
      onFilter={(f) => {
        setFilter(f);
        setLimit(PAGE_SIZE);
      }}
      sorts={SORTS}
      sort={sort}
      onSort={(key) => {
        setSort(key as SortKey);
        setLimit(PAGE_SIZE);
      }}
      sortOpen={sortOpen}
      onSortOpenChange={setSortOpen}
      limit={limit}
      onMore={() => setLimit((n) => n + PAGE_SIZE)}
      wide={wide}
      emptyTitle={entries.error ? 'No entries to show' : 'No entries yet'}
      emptyText={entries.error ? undefined : `Add the first ${entryNoun(label)} with the button below.`}
      status={chrome.status}
      cta={
        <Button
          variant="primary"
          size="lg"
          full
          icon={<Icon name="plus" size={20} />}
          onClick={() => setCreating(true)}
        >
          New {entryNoun(label)}
        </Button>
      }
    >
      <NewEntryDialog collection={collection} schema={schema} open={creating} onOpenChange={setCreating} />
    </CollectionView>
  );
}
