import { useId } from 'react';

import type { Schema } from '../../../core/schema';
import type { ReferrerItem } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { Card } from '../ui/parts/card';
import { RowChevron, rowVariants } from '../ui/parts/rows';

/** Field labels of a referrer, for "via Sections". */
function viaText(schema: Schema, item: ReferrerItem): string {
  const collection = schema.collections[item.ref.slice(0, item.ref.indexOf('/'))];
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

/** The rows of `items`: title (opens the entry), then the ref and the fields that hold the reference. */
export function ReferrerList({ schema, items }: { schema: Schema; items: ReferrerItem[] }) {
  return (
    <Card as="ul">
      {items.map((item) => (
        <ReferrerRow key={item.ref} schema={schema} item={item} />
      ))}
    </Card>
  );
}

/** "Used by": saved entries that reference this one. Nothing while loading or when no entry references it. */
export function UsedBy({ schema, items }: { schema: Schema; items: ReferrerItem[] | undefined }) {
  const titleId = useId();
  if (!items || items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={titleId}>
      <h2 id={titleId} className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">
        Used by {items.length} {items.length === 1 ? 'entry' : 'entries'}
      </h2>
      <ReferrerList schema={schema} items={items} />
    </section>
  );
}
