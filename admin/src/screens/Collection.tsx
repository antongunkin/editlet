import { useState } from 'react';

import { NewEntryDialog } from './NewEntryDialog';
import { PageTop } from './PageTop';

import { useEntries, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { StatusBadge } from '../ui/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import { useRoute } from '../useRoute';

/** Entry table of a (non-singleton) collection, with a New entry dialog. */
export function Collection({ collection, schema }: { collection: string; schema: SchemaData }) {
  const { navigate } = useRoute();
  const entries = useEntries(collection);
  const [creating, setCreating] = useState(false);
  const label = schema.schema.collections[collection]?.label ?? collection;

  return (
    <section className="editlet-screen">
      <PageTop title={label}>
        <Button variant="action" icon={<Icon.Plus />} onClick={() => setCreating(true)}>
          New entry
        </Button>
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
          <p className="editlet-u-text-muted">No entries yet.</p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.data.map((entry) => {
              const to = { kind: 'entry', collection, slug: entry.slug } as const;
              return (
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the title link is the keyboard target
                <TableRow
                  key={entry.path}
                  className="editlet-table__row--link"
                  onClick={(e) => {
                    if (!e.defaultPrevented) navigate(to);
                  }}
                >
                  <TableCell>
                    <RouteLink to={to} className="editlet-link">
                      {entry.title}
                    </RouteLink>
                  </TableCell>
                  <TableCell className="editlet-u-mono editlet-u-text-muted">{entry.slug}</TableCell>
                  <TableCell>
                    <StatusBadge draft={entry.draft} showPublished size="sm" />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <NewEntryDialog collection={collection} schema={schema} open={creating} onOpenChange={setCreating} />
    </section>
  );
}
