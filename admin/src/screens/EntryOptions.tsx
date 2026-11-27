import { useEffect, useRef, useState } from 'react';

import { LoadingBar } from './CollectionView';
import { moveAmongRadios, PAGE_SIZE, radioTab, slugOf } from './listControls';

import { Card } from '../ui/parts/card';
import { Option, Row } from '../ui/parts/rows';

// The options of a reference picker (docs/admin/entry-form.md), for both of its sheets: radios for a reference to one
// entry, checkboxes for *Add*. It draws 20 matches at a time, with *Show 20 more*, so a large collection does not draw
// every row. Props only: the caller reads, filters and orders the options.

export interface EntryOption {
  ref: string;
  /** `null` while it loads: the option shows its slug and the loading bar. */
  title: string | null;
}

export type EntryOptionsProps = {
  /** The group's accessible name. */
  label: string;
  /** The options that match the query, in the order they show. */
  options: EntryOption[];
  /** What was typed to filter them: a new query shows the first page again. */
  query: string;
  /** What stands in place of an empty list. */
  emptyText: string;
  /** Titles still load, so an option may yet match: a loading row in place of `emptyText`. */
  pending?: boolean;
  /**
   * Every title of a large target was asked for: how many are there. While some are not, the loading line shows, and an
   * empty list is a loading row as with `pending`.
   */
  progress?: { loaded: number; total: number };
  /** The refs the page shows, each time they change: the caller reads their titles. Keep it the same function. */
  onShown?(refs: string[]): void;
} & (
  | {
      multi?: false;
      /** The radio group's id. */
      id?: string;
      /** The chosen entry's ref, `''` for none. */
      chosen: string;
      onChoose(ref: string): void;
    }
  | {
      multi: true;
      picked: string[];
      /** How many may be picked: at that many, the other options are off. */
      max?: number;
      onToggle(ref: string): void;
    }
);

/** A list of entries with no rows: while titles load one may yet match, so a loading row; then `text`. */
function NoEntries({ pending, text }: { pending?: boolean; text: string }) {
  return pending ? (
    <Row title="" size={72} loading />
  ) : (
    <p className="m-0 p-4 text-base text-muted-foreground">{text}</p>
  );
}

/** A count as English writes it: *2,000*. */
const count = (n: number) => n.toLocaleString('en');

const isOn = (row: HTMLButtonElement) => !row.disabled;

/** An option's two lines: the title over the ref; the slug over the loading bar until the title is there. */
const lines = ({ ref, title }: EntryOption) =>
  title === null ? { title: slugOf(ref), sub: <LoadingBar />, 'aria-busy': true } : { title, sub: ref };

export function EntryOptions(props: EntryOptionsProps) {
  const { label, options, query, emptyText, pending, progress, onShown } = props;
  const reading = progress !== undefined && progress.loaded < progress.total;
  const [page, setPage] = useState({ query, limit: PAGE_SIZE });
  // Set while rendering, so no frame shows a new query with the old one's page.
  if (page.query !== query) setPage({ query, limit: PAGE_SIZE });
  const limit = page.query === query ? page.limit : PAGE_SIZE;
  const shown = options.slice(0, limit);
  const rest = options.length - shown.length;
  const showing = shown.map((o) => o.ref).join('\n');
  useEffect(() => {
    if (showing !== '') onShown?.(showing.split('\n'));
  }, [showing, onShown]);
  // *Show 20 more*: the focus goes to the first option it adds, as the button goes away with the last page. An option
  // that is off (`max`) takes no focus: then the next one that does, else the last one before it.
  const group = useRef<HTMLDivElement>(null);
  const before = useRef(limit);
  useEffect(() => {
    if (limit > before.current) {
      const rows = [...(group.current?.querySelectorAll('button') ?? [])];
      (rows.slice(before.current).find(isOn) ?? rows.findLast(isOn))?.focus();
    }
    before.current = limit;
  }, [limit]);
  const empty = shown.length === 0 ? <NoEntries pending={pending || reading} text={emptyText} /> : null;
  const chosenShown = !props.multi && shown.some((o) => o.ref === props.chosen);
  const full = props.multi && props.max !== undefined && props.picked.length >= props.max;
  return (
    <>
      {/* The collection list's loading states (CollectionView.tsx): a screen reader hears it once, not at every count. */}
      <p aria-live="polite" className="sr-only">
        {reading ? 'Loading titles…' : ''}
      </p>
      {reading ? (
        <p className="m-0 px-1 text-sm text-tray-muted-foreground">
          Loading titles: {count(progress.loaded)} of {count(progress.total)}.
        </p>
      ) : null}
      <div ref={group}>
        {props.multi ? (
          <Card as="fieldset" aria-label={label}>
            {shown.map((o) => {
              const picked = props.picked.includes(o.ref);
              return (
                <Option
                  key={o.ref}
                  multi
                  {...lines(o)}
                  selected={picked}
                  disabled={!picked && full}
                  onClick={() => props.onToggle(o.ref)}
                />
              );
            })}
            {empty}
          </Card>
        ) : (
          <Card role="radiogroup" aria-label={label} id={props.id} onKeyDown={moveAmongRadios}>
            {shown.map((o, i) => (
              <Option
                key={o.ref}
                {...lines(o)}
                selected={o.ref === props.chosen}
                tabIndex={radioTab(o.ref === props.chosen, i === 0, chosenShown)}
                onClick={() => props.onChoose(o.ref)}
              />
            ))}
            {empty}
          </Card>
        )}
      </div>
      {rest > 0 ? (
        <>
          {/* Its own card: a button inside the radio group or the fieldset would read as one of the options. */}
          <Card>
            <Row
              title={`Show ${Math.min(PAGE_SIZE, rest)} more`}
              lead="plus"
              chevron={false}
              onClick={() => setPage({ query, limit: limit + PAGE_SIZE })}
            />
          </Card>
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">
            Showing {count(shown.length)} of {count(options.length)}: search to narrow them.
          </p>
        </>
      ) : null}
    </>
  );
}
