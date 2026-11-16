import { useId } from 'react';

import type { Schema } from '../../../core/schema';
import type { ReferrerItem } from '../data/queries';
import { RouteLink } from '../RouteLink';

/** Field labels of a referrer, for "via Sections". */
function viaText(schema: Schema, item: ReferrerItem): string {
  const collection = schema.collections[item.ref.slice(0, item.ref.indexOf('/'))];
  return item.fields.map((f) => collection?.fields[f]?.label ?? f).join(', ');
}

/** The links of `items`: title (opens the entry), then the ref and the fields that hold the reference. */
export function ReferrerList({ schema, items }: { schema: Schema; items: ReferrerItem[] }) {
  return (
    <ul className="editlet-used-by__list">
      {items.map((item) => (
        <li key={item.ref} className="editlet-used-by__item">
          <RouteLink to={item.ref} className="editlet-used-by__link">
            {item.title}
          </RouteLink>
          <span className="editlet-u-text-muted editlet-u-text-xs">
            {item.ref} · via {viaText(schema, item)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** "Used by": saved entries that reference this one. Nothing while loading or when no entry references it. */
export function UsedBy({ schema, items }: { schema: Schema; items: ReferrerItem[] | undefined }) {
  const titleId = useId();
  if (!items || items.length === 0) return null;
  return (
    <section className="editlet-used-by" aria-labelledby={titleId}>
      <h2 id={titleId} className="editlet-used-by__title">
        Used by {items.length} {items.length === 1 ? 'entry' : 'entries'}
      </h2>
      <ReferrerList schema={schema} items={items} />
    </section>
  );
}
