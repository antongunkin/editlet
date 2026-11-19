import { useQueries } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { DEFAULT_SORT, SORTS, sortRows, type SortKey } from './collectionSort';
import { CollectionView, PAGE_SIZE, type CollectionFilter, type CollectionRowData } from './CollectionView';
import { fileHistoryQuery, shortName, When } from './EntryMeta';
import { entryNoun, NewEntryDialog } from './NewEntryDialog';

import { useEntries, type SchemaData } from '../data/queries';
import { useWorkspace } from '../github/workspace';
import { parentRoute } from '../route';
import { RouteLink } from '../RouteLink';
import { useSource } from '../source/context';
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

/**
 * Entries of a (non-singleton) collection as rows under filter chips (*All*, *Drafts*): the title, and under it the
 * status, when the file was last changed and who changed it (the file's last commit). Newest change first until *Sort*
 * says another order; 20 rows at a time. *New* in the bottom bar asks for the name first (NewEntryDialog). The view is
 * CollectionView.tsx.
 */
export function Collection({ collection, schema }: { collection: string; schema: SchemaData }) {
  const { navigate } = useRoute();
  const source = useSource();
  const workspace = useWorkspace();
  const entries = useEntries(collection);
  const chrome = useScreenChrome();
  const wide = useWide();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<CollectionFilter>('all');
  const [sort, setSort] = useState<SortKey>(DEFAULT_SORT);
  const [sortOpen, setSortOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const label = schema.schema.collections[collection]?.label ?? collection;

  // The last commit of every entry file: when it changed, and the order. Same queries as the entry's Meta.
  const list = entries.data;
  const histories = useQueries({
    queries: (list ?? []).map((e) => fileHistoryQuery(source, workspace, e.path, e.sha)),
  });
  const rows: CollectionRowData[] | undefined = list
    ? sortRows(
        list.map((e, i) => {
          const updated = histories[i]?.data?.updated ?? null;
          return { ...e, updated: updated && { date: updated.date, by: shortName(updated.actor) } };
        }),
        sort,
      ).map((row) => ({
        key: row.path,
        title: row.title,
        statusText: row.draft ? 'Draft' : 'Published',
        badge: <StatusBadge draft={row.draft} showPublished />,
        filters: row.draft ? ['drafts'] : [],
        updated: row.updated ? <When date={row.updated.date} /> : undefined,
        by: row.updated?.by,
        onOpen: () => navigate({ kind: 'entry', collection, slug: row.slug }),
      }))
    : undefined;

  const home = parentRoute({ kind: 'collection', collection });
  return (
    <CollectionView
      title={label}
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
      filters={[{ key: 'drafts', label: 'Drafts', empty: 'No drafts. Every entry is published.' }]}
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
