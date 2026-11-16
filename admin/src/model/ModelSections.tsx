import type { ReactNode } from 'react';

import { CopyButton } from './CopyButton';
import {
  fieldRows,
  incoming,
  outgoing,
  type ChatPrompt,
  type FieldMark,
  type ModelChanges,
  type ReferenceEdge,
} from './model';

import type { Schema } from '../../../core/schema';
import { RouteLink } from '../RouteLink';
import { Icon } from '../ui/Icon';

export const sectionId = (key: string) => `editlet-model-c-${key}`;

/** Opens a collection's block, scrolls it into view and moves focus to its summary. */
function jumpTo(key: string) {
  const block = document.getElementById(sectionId(key));
  const details = block?.querySelector('details');
  if (details) details.open = true;
  block?.scrollIntoView({ block: 'start' });
  details?.querySelector('summary')?.focus({ preventScroll: true });
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

/** Copyable prompts: a title, the prompt itself (two lines at most; the whole text is copied) and Copy. */
export function PromptList({ prompts, idPrefix }: { prompts: ChatPrompt[]; idPrefix: string }) {
  return (
    <ul className="editlet-model__prompts">
      {prompts.map((p) => {
        const id = `${idPrefix}-${p.id}`;
        return (
          <li key={p.id} className="editlet-model__prompt">
            <div className="editlet-model__prompt-text-area">
              <strong id={id}>{p.title}</strong>
              <span className="editlet-model__prompt-text" title={p.text}>
                {p.text}
              </span>
            </div>
            <CopyButton text={p.text} describedBy={id} />
          </li>
        );
      })}
    </ul>
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
  if (out.length === 0 && inc.length === 0) return null;
  return (
    <div className="editlet-model__refs">
      {out.length > 0 ? (
        <div>
          <h4 className="editlet-model__subheading">References →</h4>
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
          <h4 className="editlet-model__subheading">Referenced by ←</h4>
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

/**
 * One collection as a collapsed block, like an FAQ entry. The summary: label, key, Singleton / New / Changed and the
 * counts. Open: where its files live, its fields, its references, and prompts to change it. A block whose collection
 * changed while the screen is open opens by itself.
 */
export function CollectionBlock({
  schema,
  collectionKey,
  edges,
  changes,
  count,
  prompts,
}: {
  schema: Schema;
  collectionKey: string;
  edges: ReferenceEdge[];
  changes: ModelChanges | null;
  /** Entry count; `undefined` while the file list loads. */
  count: number | undefined;
  prompts: ChatPrompt[];
}) {
  const collection = schema.collections[collectionKey]!;
  const mark = changes?.collections.get(collectionKey);
  const fieldMarks = changes?.fields.get(collectionKey);
  const id = sectionId(collectionKey);
  const titleId = `${id}-title`;
  const label = (key: string) => schema.collections[key]?.label ?? key;
  const rows = fieldRows(collection);
  const counts = [
    collection.singleton
      ? count === 0
        ? 'index.md missing'
        : null
      : count === undefined
        ? null
        : count === 1
          ? '1 entry'
          : `${count} entries`,
    rows.length === 1 ? '1 field' : `${rows.length} fields`,
  ].filter((c): c is string => c !== null);

  return (
    <section id={id} aria-labelledby={titleId} className="editlet-model__collection">
      <details className="editlet-model__block" open={mark ? true : undefined}>
        <summary className="editlet-model__summary">
          <Icon.ChevronRight size={16} className="editlet-model__chevron" />
          <span className="editlet-model__summary-title">
            <span id={titleId} className="editlet-model__name">
              {collection.label}
            </span>
            <span className="editlet-u-mono editlet-u-text-muted editlet-model__key">{collectionKey}</span>
            {collection.singleton ? <Badge>Singleton</Badge> : null}
            {mark ? <Badge mark={mark}>{mark === 'new' ? 'New' : 'Changed'}</Badge> : null}
          </span>
          <span className="editlet-model__counts">{counts.join(', ')}</span>
        </summary>
        <div className="editlet-model__block-body">
          <p className="editlet-model__meta">
            <span className="editlet-u-mono">
              {schema.contentDir}/{collectionKey}/
            </span>
            {collection.titleField ? <span>Title from {collection.titleField}</span> : null}
            {collection.slugFrom ? <span>Slug from {collection.slugFrom}</span> : null}
            <RouteLink
              to={{ kind: 'collection', collection: collectionKey }}
              className="editlet-link editlet-model__open"
            >
              Open entries
            </RouteLink>
          </p>
          <ul className="editlet-model__fields" aria-label={`${collection.label} fields`}>
            {rows.map((row) => {
              const fieldMark = fieldMarks?.get(row.key);
              return (
                <li key={row.key} className="editlet-model__field">
                  <div className="editlet-model__field-head">
                    <span className="editlet-model__field-name">
                      <span>{row.label}</span>
                      <span className="editlet-u-mono editlet-u-text-muted editlet-model__key">{row.key}</span>
                      {row.badges.map((b) => (
                        <Badge key={b}>{BADGE_TEXT[b]}</Badge>
                      ))}
                      {fieldMark ? <Badge mark={fieldMark}>{fieldMark === 'new' ? 'New' : 'Changed'}</Badge> : null}
                    </span>
                    <span className="editlet-model__type">
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
                    </span>
                  </div>
                  <div className="editlet-model__field-meta">
                    <span>{row.required ? 'Required' : 'Optional'}</span>
                    {row.details.map((d) => (
                      <span key={d}>{d}</span>
                    ))}
                    {row.hint ? <span className="editlet-model__hint">{row.hint}</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <ReferenceBlock out={outgoing(edges, collectionKey)} inc={incoming(edges, collectionKey)} label={label} />
          <div className="editlet-u-stack editlet-u-gap-2">
            <h4 className="editlet-model__subheading">Change {collection.label} with your agent</h4>
            <PromptList prompts={prompts} idPrefix={`${id}-prompt`} />
          </div>
        </div>
      </details>
    </section>
  );
}
