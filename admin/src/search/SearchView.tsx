import { Fragment, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { Card } from '../ui/parts/card';
import { SearchHeader } from '../ui/parts/header';
import { Row } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import type { IconName } from '../ui/primitives/icons';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

// Search as the design draws it (FigCraft *Search (⌘K)*): a window-height sheet with the `SearchHeader` (Back and the
// field), then two groups: the entries that match as rows, and the actions (docs/admin/search.md#actions); the group
// holding the top result comes first. Props only: `SearchSheet` has the data, and /design renders it from a fixture
// (src/design/fixtures/search.tsx).

export const SEARCH_LIMIT = 20;

export interface SearchViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The open or close animation has finished (an action's dialog opens after the close). */
  onOpenChangeComplete?: (open: boolean) => void;
  query: string;
  onQuery: (query: string) => void;
  /** The field, so the container can focus it (the shortcut with the search already open). */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Enter in the field: run the top result. */
  onSubmit: () => void;
  /** How many entries there are (the line under an empty field). */
  entryCount: number;
  /**
   * The titles' reads: while `loaded < total` the line under an empty field is *Loading titles: 340 of 2,000.*; with a
   * failed one, *Some titles did not load.* (both also in the status line).
   */
  loading?: { loaded: number; total: number; failed: number };
  /** How many entries match the query. */
  matches: number;
  /** The rows of the best `SEARCH_LIMIT` matches (`RouteRow`s in `li`s). */
  rows: ReactNode;
  /** How many action rows there are: the matches of a typed query, the context actions of an empty one. */
  actionCount?: number;
  /** The action rows (`ActionResult`s in `li`s). */
  actions?: ReactNode;
  /** The top result is an action: the Actions group comes first. */
  actionsFirst?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** A count as English writes it: *2,000*. */
const count = (n: number) => n.toLocaleString('en');

/** A search row that runs an action: `RouteRow`'s 72 px look as a button, no chevron; off is `aria-disabled`. */
export function ActionResult({
  icon,
  label,
  sub,
  note,
  disabled,
  selected,
  onRun,
}: {
  icon: IconName;
  label: string;
  sub?: string;
  /** Why it is off (*Save first*), in place of `sub`. */
  note?: string;
  disabled?: boolean;
  /** The top result. */
  selected?: boolean;
  onRun: () => void;
}) {
  return (
    <Row
      lead={icon}
      title={label}
      sub={disabled && note ? note : sub}
      chevron={false}
      size={72}
      // Not native `disabled`: an off action stays in the keyboard walk, so its note is heard.
      aria-disabled={disabled || undefined}
      data-disabled={disabled ? '' : undefined}
      data-selected={selected ? '' : undefined}
      onClick={disabled ? undefined : onRun}
    />
  );
}

export function SearchView({
  open,
  onOpenChange,
  onOpenChangeComplete,
  query,
  onQuery,
  inputRef,
  onSubmit,
  entryCount,
  loading,
  matches,
  rows,
  actionCount = 0,
  actions,
  actionsFirst = false,
}: SearchViewProps) {
  const lists = useRef<HTMLDivElement>(null);
  const typed = query.trim() !== '';
  // Every row of both groups, in visual order: entry links and action buttons.
  const items = () => [...(lists.current?.querySelectorAll<HTMLElement>('ul a, ul button') ?? [])];

  // ↓ goes from the field into the rows, ↑ and ↓ walk both groups as one sequence, ↑ from the first returns to the
  // field; Home and End jump to the first and the last row.
  const fieldKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME's Enter commits the composition, it does not open anything.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'ArrowDown' && items().length > 0) {
      e.preventDefault();
      items()[0]!.focus();
    }
  };
  const rowKeys = (e: KeyboardEvent<HTMLElement>) => {
    const all = items();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    if (e.key === 'ArrowDown') all[Math.min(at + 1, all.length - 1)]?.focus();
    else if (e.key === 'ArrowUp') (at === 0 ? inputRef.current : all[at - 1])?.focus();
    else if (e.key === 'Home') all[0]?.focus();
    else if (e.key === 'End') all.at(-1)?.focus();
    else return;
    e.preventDefault();
  };

  const entriesGroup =
    typed && matches > 0 ? (
      <Fragment key="entries">
        <h2 className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">Entries</h2>
        <Card as="ul" aria-label="Entries">
          {rows}
        </Card>
        {matches > SEARCH_LIMIT ? (
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">
            Showing {SEARCH_LIMIT} of {matches}: keep typing to narrow them.
          </p>
        ) : null}
      </Fragment>
    ) : null;
  const actionsGroup =
    actionCount > 0 ? (
      <Fragment key="actions">
        <h2 className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">Actions</h2>
        <Card as="ul" aria-label="Actions">
          {actions}
        </Card>
      </Fragment>
    ) : null;
  const progress =
    loading && loading.loaded < loading.total
      ? `Loading titles: ${count(loading.loaded)} of ${count(loading.total)}.`
      : loading && loading.failed > 0
        ? 'Some titles did not load.'
        : null;
  const found = [
    matches > 0 ? plural(matches, 'entry', 'entries') : null,
    actionCount > 0 ? plural(actionCount, 'action', 'actions') : null,
  ].filter(Boolean);

  return (
    <Sheet
      full
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
      title="Search"
      initialFocus={inputRef}
      header={
        <SearchHeader
          back={
            <IconButton
              label="Back"
              icon={<Icon name="chevron-left" size={20} />}
              onClick={() => onOpenChange(false)}
            />
          }
        >
          <InputGroup
            lead={<Icon name="search" size={20} />}
            trail={
              typed ? (
                <IconButton
                  label="Clear search"
                  icon={<Icon name="x" size={20} />}
                  onClick={() => {
                    onQuery('');
                    inputRef.current?.focus();
                  }}
                />
              ) : undefined
            }
          >
            <InputGroupInput
              ref={inputRef}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              // iOS would capitalise the first letter and correct words: a query is lowercase, as typed.
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Search entries and actions"
              placeholder="Search entries and actions"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={fieldKeys}
            />
          </InputGroup>
        </SearchHeader>
      }
    >
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- the arrows move between the rows inside */}
      <div ref={lists} className="flex flex-col gap-2 px-4 pt-1 pb-8" onKeyDown={rowKeys}>
        {/* What a screen reader hears while the focus stays in the field. */}
        <output className="sr-only">
          {/* Typed, only a failure joins the counts: the climbing progress would be said again at every step. */}
          {typed
            ? [
                found.length === 0 ? 'Nothing matches' : found.join(', '),
                loading?.failed ? 'Some titles did not load.' : '',
              ]
                .filter(Boolean)
                .join('. ')
            : progress}
        </output>
        {!typed ? (
          <>
            {actionsGroup}
            <p className="m-0 px-1 text-sm text-tray-muted-foreground">
              {progress ?? `Type a title, an address or an action. ${plural(entryCount, 'entry', 'entries')}.`}
            </p>
          </>
        ) : matches === 0 && actionCount === 0 ? (
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">Nothing matches “{query.trim()}”.</p>
        ) : actionsFirst ? (
          [actionsGroup, entriesGroup]
        ) : (
          [entriesGroup, actionsGroup]
        )}
      </div>
    </Sheet>
  );
}
