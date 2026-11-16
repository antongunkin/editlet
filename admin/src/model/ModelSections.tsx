import type { ReactNode } from 'react';

import { fieldRows, incoming, outgoing, type FieldMark, type ModelChanges, type ReferenceEdge } from './model';

import type { Collection, Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import { entryRefs } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Icon } from '../ui/Icon';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';

export const sectionId = (key: string) => `editlet-model-c-${key}`;

function jumpTo(key: string) {
  document.getElementById(sectionId(key))?.scrollIntoView({ block: 'start' });
  document.getElementById(`${sectionId(key)}-title`)?.focus({ preventScroll: true });
}

function JumpLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <button type="button" className="editlet-model__jump" onClick={() => jumpTo(to)}>
      {children}
    </button>
  );
}

function Badge({ children, mark }: { children: ReactNode; mark?: FieldMark }) {
  return (
    <span className={`editlet-chip editlet-model__badge${mark ? ` editlet-model__badge--${mark}` : ''}`}>
      {children}
    </span>
  );
}

const BADGE_TEXT = { title: 'Title', slugSource: 'Slug source', body: 'Body' } as const;

/** Collection, kind, entries and fields at a glance; the label jumps to the card below. */
export function CollectionsTable({
  schema,
  files,
  removed,
}: {
  schema: Schema;
  files: FileRef[] | undefined;
  removed: string[];
}) {
  const entries = Object.entries(schema.collections);
  if (entries.length === 0) {
    return (
      <div className="editlet-card editlet-card--empty">
        <p className="editlet-u-text-muted">No collections</p>
      </div>
    );
  }
  const entriesCell = (key: string, collection: Collection): string => {
    if (!files) return '…';
    const count = entryRefs(schema, files, key).length;
    if (collection.singleton) return count > 0 ? '—' : 'missing';
    return String(count);
  };
  return (
    <>
      {removed.length > 0 ? <p className="editlet-model__removed">Removed: {removed.join(', ')}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Collection</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Entries</TableHead>
            <TableHead>Fields</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([key, collection]) => (
            <TableRow key={key}>
              <TableCell>
                <JumpLink to={key}>{collection.label}</JumpLink>{' '}
                <span className="editlet-u-mono editlet-u-text-muted editlet-model__key">{key}</span>
              </TableCell>
              <TableCell>{collection.singleton ? 'Singleton' : 'Collection'}</TableCell>
              <TableCell>{entriesCell(key, collection)}</TableCell>
              <TableCell>{Object.keys(collection.fields).length}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}

function ReferenceBlock({
  out,
  inc,
  label,
}: {
  out: ReferenceEdge[];
  inc: ReferenceEdge[];
  label: (key: string) => string;
}) {
  if (out.length === 0 && inc.length === 0) return <p className="editlet-u-text-muted">No references</p>;
  return (
    <div className="editlet-model__refs">
      {out.length > 0 ? (
        <div>
          <h4 className="editlet-model__refs-title">References →</h4>
          <ul>
            {out.map((e) => (
              <li key={`${e.field}>${e.to}`}>
                <span className="editlet-u-mono">{e.field}</span> → <JumpLink to={e.to}>{label(e.to)}</JumpLink> (
                {e.many ? 'many' : 'one'})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {inc.length > 0 ? (
        <div>
          <h4 className="editlet-model__refs-title">Referenced by ←</h4>
          <ul>
            {inc.map((e) => (
              <li key={`${e.from}.${e.field}`}>
                <JumpLink to={e.from}>{label(e.from)}</JumpLink>
                <span className="editlet-u-mono">.{e.field}</span> ({e.many ? 'many' : 'one'})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** One collection: header, meta line, field table and references. */
export function CollectionCard({
  schema,
  collectionKey,
  edges,
  changes,
  count,
}: {
  schema: Schema;
  collectionKey: string;
  edges: ReferenceEdge[];
  changes: ModelChanges | null;
  /** Entry count; `undefined` while the file list loads. */
  count: number | undefined;
}) {
  const collection = schema.collections[collectionKey]!;
  const mark = changes?.collections.get(collectionKey);
  const fieldMarks = changes?.fields.get(collectionKey);
  const titleId = `${sectionId(collectionKey)}-title`;
  const label = (key: string) => schema.collections[key]?.label ?? key;
  return (
    <section id={sectionId(collectionKey)} aria-labelledby={titleId} className="editlet-model__collection">
      <Card>
        <CardHeader className="editlet-model__card-header">
          <CardTitle id={titleId} tabIndex={-1}>
            {collection.label}
          </CardTitle>
          <span className="editlet-u-mono editlet-u-text-muted editlet-model__key">{collectionKey}</span>
          {collection.singleton ? <Badge>Singleton</Badge> : null}
          {mark ? <Badge mark={mark}>{mark === 'new' ? 'New' : 'Changed'}</Badge> : null}
          {!collection.singleton && count !== undefined ? (
            <span className="editlet-u-text-muted editlet-u-text-sm">
              {count === 1 ? '1 entry' : `${count} entries`}
            </span>
          ) : null}
          <RouteLink
            to={{ kind: 'collection', collection: collectionKey }}
            className="editlet-link editlet-model__open"
          >
            Open entries
          </RouteLink>
        </CardHeader>
        <CardContent className="editlet-u-stack editlet-u-gap-3">
          <p className="editlet-u-text-muted editlet-u-text-sm editlet-model__meta">
            <span className="editlet-u-mono">
              {schema.contentDir}/{collectionKey}/
            </span>
            {collection.titleField ? <> · title field: {collection.titleField}</> : null}
            {collection.slugFrom ? <> · slug source: {collection.slugFrom}</> : null}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fieldRows(collection).map((row) => {
                const fieldMark = fieldMarks?.get(row.key);
                return (
                  <TableRow key={row.key}>
                    <TableCell>
                      <div className="editlet-model__field">
                        <span>{row.label}</span>
                        <span className="editlet-u-mono editlet-u-text-muted editlet-model__key">{row.key}</span>
                        {row.badges.map((b) => (
                          <Badge key={b}>{BADGE_TEXT[b]}</Badge>
                        ))}
                        {fieldMark ? <Badge mark={fieldMark}>{fieldMark === 'new' ? 'New' : 'Changed'}</Badge> : null}
                      </div>
                      {row.hint ? <div className="editlet-u-text-muted editlet-u-text-sm">{row.hint}</div> : null}
                    </TableCell>
                    <TableCell>
                      {row.type}
                      {row.targets.length > 0 ? (
                        <>
                          {' → '}
                          {row.targets.map((t, i) => (
                            <span key={t}>
                              {i > 0 ? ', ' : null}
                              <JumpLink to={t}>{label(t)}</JumpLink>
                            </span>
                          ))}
                          {row.many ? ', many' : null}
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.required ? (
                        <Icon.Check role="img" aria-label="Required" size={16} />
                      ) : (
                        <span className="editlet-sr-only">Optional</span>
                      )}
                    </TableCell>
                    <TableCell className="editlet-u-text-sm editlet-model__details">
                      {row.details.map((d) => (
                        <div key={d}>{d}</div>
                      ))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <ReferenceBlock out={outgoing(edges, collectionKey)} inc={incoming(edges, collectionKey)} label={label} />
        </CardContent>
      </Card>
    </section>
  );
}
