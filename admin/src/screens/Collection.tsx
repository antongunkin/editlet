import { useQueries } from '@tanstack/react-query';
import { useState } from 'react';

import { Avatar, fileHistoryQuery, shortName, When } from './EntryMeta';
import { NewEntryDialog } from './NewEntryDialog';
import { PageTop } from './PageTop';

import type { FileEvent } from '../../../core/source';
import { useEntries, type EntryListItem, type SchemaData } from '../data/queries';
import { useWorkspace } from '../github/workspace';
import { RouteLink } from '../RouteLink';
import { useSource } from '../source/context';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { useRoute } from '../useRoute';

/** Rows per page. */
export const PAGE_SIZE = 20;

type SortKey = 'title' | 'updated' | 'by' | 'status';
type Sort = { key: SortKey; dir: 'asc' | 'desc' };
type Row = EntryListItem & { updated: FileEvent | null };

/** Newest change first: the order of Contentful, Storyblok and Payload. */
const DEFAULT_SORT: Sort = { key: 'updated', dir: 'desc' };

/** A row's value for `key`; `null` (no history yet, or none) sorts last in both directions. */
function sortValue(row: Row, key: SortKey): string | null {
  switch (key) {
    case 'title':
      return row.title;
    case 'updated':
      return row.updated?.date ?? null;
    case 'by':
      return row.updated ? shortName(row.updated.actor) : null;
    case 'status':
      return row.draft ? 'Draft' : 'Published';
  }
}

function sortRows(rows: Row[], { key, dir }: Sort): Row[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows.toSorted((a, b) => {
    const x = sortValue(a, key);
    const y = sortValue(b, key);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return sign * x.localeCompare(y) || a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug);
  });
}

/**
 * Entries of a (non-singleton) collection as a sortable table: Title (with the slug under it), Updated and By (the
 * file's last commit) and Status. 20 rows per page; the pager and New entry float at the bottom of the panel like the
 * entry screen's Save.
 */
export function Collection({ collection, schema }: { collection: string; schema: SchemaData }) {
  const { navigate } = useRoute();
  const source = useSource();
  const workspace = useWorkspace();
  const entries = useEntries(collection);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT);
  const [page, setPage] = useState(0);
  const label = schema.schema.collections[collection]?.label ?? collection;

  // The last commit of every entry file: Updated and By, and the default order. Same queries as the entry's Meta.
  const list = entries.data ?? [];
  const histories = useQueries({
    queries: list.map((e) => fileHistoryQuery(source, workspace, e.path, e.sha)),
  });
  const rows = sortRows(
    list.map((e, i) => ({ ...e, updated: histories[i]?.data?.updated ?? null })),
    sort,
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const historyPending = histories.some((h) => h.isPending);

  const sortBy = (key: SortKey) => {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'updated' ? 'desc' : 'asc' },
    );
    setPage(0);
  };
  const head = (key: SortKey, text: string, className?: string) => (
    <TableHead
      className={className}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button type="button" className="editlet-table__sort" onClick={() => sortBy(key)}>
        {text}
        {sort.key === key ? sort.dir === 'asc' ? <Icon.ChevronUp size={14} /> : <Icon.ChevronDown size={14} /> : null}
      </button>
    </TableHead>
  );

  return (
    <section className="editlet-screen editlet-collection">
      <PageTop title={label}>
        {list.length > 0 ? (
          <span className="editlet-collection__count">
            {list.length} {list.length === 1 ? 'entry' : 'entries'}
          </span>
        ) : null}
      </PageTop>
      {entries.error ? (
        <p className="editlet-u-text-danger" role="alert">
          {entries.error.message}
        </p>
      ) : entries.data === undefined ? (
        <p className="editlet-u-text-muted" role="status">
          Loading entries…
        </p>
      ) : entries.data.length === 0 ? (
        <div className="editlet-card editlet-card--empty">
          <p className="editlet-u-text-muted">No entries yet. Create the first one with New entry.</p>
        </div>
      ) : (
        <Table className="editlet-collection__table" aria-label={`${label} entries`} aria-busy={historyPending}>
          <TableHeader>
            <TableRow>
              {head('title', 'Title')}
              {head('updated', 'Updated', 'editlet-collection__col-updated')}
              {head('by', 'By', 'editlet-collection__col-by')}
              {head('status', 'Status', 'editlet-collection__col-status')}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((row) => {
              const to = { kind: 'entry', collection, slug: row.slug } as const;
              return (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the title link is the keyboard target
                <TableRow
                  key={row.path}
                  className="editlet-table__row--link"
                  onClick={(e) => {
                    if (!e.defaultPrevented) navigate(to);
                  }}
                >
                  <TableCell className="editlet-collection__title-cell">
                    <RouteLink to={to} className="editlet-link editlet-collection__title">
                      {row.title}
                    </RouteLink>
                    <span className="editlet-collection__slug">{row.slug}</span>
                  </TableCell>
                  <TableCell className="editlet-collection__col-updated">
                    {row.updated ? <When date={row.updated.date} /> : <Empty />}
                  </TableCell>
                  <TableCell className="editlet-collection__col-by">
                    {row.updated ? (
                      <span
                        className="editlet-collection__by"
                        role="img"
                        aria-label={row.updated.actor.name}
                        title={row.updated.actor.name}
                      >
                        <Avatar actor={row.updated.actor} />
                      </span>
                    ) : (
                      <Empty />
                    )}
                  </TableCell>
                  <TableCell className="editlet-collection__col-status">
                    <StatusIcon draft={row.draft} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <div className="editlet-collection__actions">
        {pages > 1 ? (
          <nav className="editlet-pager" aria-label="Pages">
            <Button
              variant="outline"
              size="sm"
              iconOnly
              aria-label="Previous page"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <Icon.ChevronLeft size={16} />
            </Button>
            <span className="editlet-pager__text" aria-live="polite">
              {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + shown.length} of {rows.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              iconOnly
              aria-label="Next page"
              disabled={current === pages - 1}
              onClick={() => setPage(current + 1)}
            >
              <Icon.ChevronRight size={16} />
            </Button>
          </nav>
        ) : null}
        <div className="editlet-split">
          <Button variant="default" icon={<Icon.Plus size={16} />} onClick={() => setCreating(true)}>
            New entry
          </Button>
        </div>
      </div>
      <NewEntryDialog collection={collection} schema={schema} open={creating} onOpenChange={setCreating} />
    </section>
  );
}

/** A dash for an unknown value (no git history, or still loading). */
function Empty() {
  return (
    <span className="editlet-u-text-muted" aria-label="Unknown">
      –
    </span>
  );
}

/** The status as a dot: green for Published, hollow for Draft; named for screen readers and on hover. */
function StatusIcon({ draft }: { draft: boolean }) {
  const label = draft ? 'Draft' : 'Published';
  return (
    <span
      className={`editlet-status-dot editlet-status-dot--${draft ? 'draft' : 'published'}`}
      role="img"
      aria-label={label}
      title={draft ? 'Draft: not live on the site' : 'Published: live on the site'}
    />
  );
}
