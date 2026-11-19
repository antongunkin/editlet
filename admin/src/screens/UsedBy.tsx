import { useId, useState } from 'react';

import { EntrySearch, matches } from './EntrySearch';

import type { Schema } from '../../../core/schema';
import type { ReferrerItem } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { Card } from '../ui/parts/card';
import { Row, RowChevron, rowVariants } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { useRoute } from '../useRoute';

/** Up to this many referrers are listed inline; over it, the first `USED_BY_SHOWN` and a row that opens them all. */
export const USED_BY_INLINE = 6;
/** The referrers listed inline (and in the delete confirm) when there are more than `USED_BY_INLINE`. */
export const USED_BY_SHOWN = 5;
/** Over this many, the *Used by* sheet has a search field. */
const USED_BY_SEARCH = 10;

const entries = (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'}`;
const collectionOf = (item: ReferrerItem) => item.ref.slice(0, item.ref.indexOf('/'));

/** Field labels of a referrer, for "via Sections". */
function viaText(schema: Schema, item: ReferrerItem): string {
  const collection = schema.collections[collectionOf(item)];
  return item.fields.map((f) => collection?.fields[f]?.label ?? f).join(', ');
}

/**
 * One referrer as a row (FigCraft `Row/72`): a link that opens the entry. Its name is its visible text, the title then
 * the ref and the fields that hold the reference (WCAG 2.5.3: the name contains what the row shows).
 */
function ReferrerRow({ schema, item }: { schema: Schema; item: ReferrerItem }) {
  return (
    <li>
      <RouteLink to={item.ref} className={rowVariants({ size: 72, pressable: true })}>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-medium">{item.title}</span>{' '}
          <span className="truncate text-sm font-normal text-muted-foreground group-pressed:text-tray-muted-foreground">
            {item.ref} · via {viaText(schema, item)}
          </span>
        </span>
        <RowChevron />
      </RouteLink>
    </li>
  );
}

/**
 * The rows of `items`: title (opens the entry), then the ref and the fields that hold the reference. With `max`, only
 * the first `max` rows and the text *and N more* under them (the delete confirm: the whole list is on the entry).
 */
export function ReferrerList({ schema, items, max }: { schema: Schema; items: ReferrerItem[]; max?: number }) {
  const shown = max === undefined ? items : items.slice(0, max);
  const rest = items.length - shown.length;
  const list = (
    <Card as="ul">
      {shown.map((item) => (
        <ReferrerRow key={item.ref} schema={schema} item={item} />
      ))}
    </Card>
  );
  if (rest === 0) return list;
  return (
    <div className="flex flex-col gap-2">
      {list}
      <p className="m-0 px-1 text-sm text-muted-foreground">and {rest} more</p>
    </div>
  );
}

/** `items` by collection (by the collection's label; the items keep their order, by title). */
function byCollection(schema: Schema, items: ReferrerItem[]): { name: string; label: string; items: ReferrerItem[] }[] {
  const groups = new Map<string, ReferrerItem[]>();
  for (const item of items) {
    const name = collectionOf(item);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }
  return [...groups]
    .map(([name, list]) => ({ name, label: schema.collections[name]?.label ?? name, items: list }))
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

/**
 * The *Used by* sheet (FigCraft *Used by*): every referrer, a search over 10, one card per collection when there are
 * several. It shows saved files, as the inline section.
 */
export function UsedBySheet({
  schema,
  title,
  items,
  open,
  onOpenChange,
}: {
  schema: Schema;
  title: string;
  items: ReferrerItem[];
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [query, setQuery] = useState('');
  const baseId = useId();
  const search = items.length > USED_BY_SEARCH;
  const shown = search ? items.filter(matches(query)) : items;
  const groups = byCollection(schema, shown);
  const several = byCollection(schema, items).length > 1;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Used by" sub={`${title} · ${entries(items.length)}`}>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        {search ? <EntrySearch label="Search entries" value={query} onChange={setQuery} /> : null}
        {groups.map((group) =>
          several ? (
            <section key={group.name} className="flex flex-col gap-2" aria-labelledby={`${baseId}-${group.name}`}>
              <h3 id={`${baseId}-${group.name}`} className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">
                {group.label}
              </h3>
              <ReferrerList schema={schema} items={group.items} />
            </section>
          ) : (
            <ReferrerList key={group.name} schema={schema} items={group.items} />
          ),
        )}
        {shown.length === 0 ? <p className="m-0 p-4 text-base text-muted-foreground">No entries match</p> : null}
      </div>
    </Sheet>
  );
}

/**
 * "Used by": saved entries that reference this one. Nothing while loading or when no entry references it. Up to
 * `USED_BY_INLINE` are listed; over it the first `USED_BY_SHOWN` and *All N entries*, which opens the *Used by* sheet.
 * A row there navigates through the entry's guard; the sheet closes when the route changed (a refused guard keeps it).
 */
export function UsedBy({
  schema,
  title,
  items,
}: {
  schema: Schema;
  /** The entry's title, for the sheet's sub (*Dana Kowalczyk · 23 entries*). */
  title: string;
  items: ReferrerItem[] | undefined;
}) {
  const titleId = useId();
  const { raw } = useRoute();
  // The route the sheet was opened on: open while it is still the route, so a navigation that went through closes it
  // (the shell remounts the entry on another route anyway; this also covers a route that keeps the screen).
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  if (openedAt !== null && openedAt !== raw) setOpenedAt(null);
  if (!items || items.length === 0) return null;
  const many = items.length > USED_BY_INLINE;
  const inline = many ? items.slice(0, USED_BY_SHOWN) : items;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={titleId}>
      <h2 id={titleId} className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">
        Used by {entries(items.length)}
      </h2>
      <Card as="ul">
        {inline.map((item) => (
          <ReferrerRow key={item.ref} schema={schema} item={item} />
        ))}
        {many ? (
          <li>
            <Row title={`All ${items.length} entries`} aria-haspopup="dialog" onClick={() => setOpenedAt(raw)} />
          </li>
        ) : null}
      </Card>
      {/* Kept while open even if a refresh drops the count to six or fewer: it closes as usual, the focus returns. */}
      {many || openedAt !== null ? (
        <UsedBySheet
          schema={schema}
          title={title}
          items={items}
          open={openedAt === raw}
          onOpenChange={(next) => setOpenedAt(next ? raw : null)}
        />
      ) : null}
    </section>
  );
}
