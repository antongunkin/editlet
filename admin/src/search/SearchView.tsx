import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { Card } from '../ui/parts/card';
import { SearchHeader } from '../ui/parts/header';
import { Sheet } from '../ui/parts/sheet';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

// Search as the design draws it (FigCraft *Search (⌘K)*): a window-height sheet with the `SearchHeader` (Back and the
// field), then the entries that match as rows, the first one the top result. Props only: `SearchSheet` has the data, and
// /design renders it from a fixture (src/design/fixtures/search.tsx).

export const SEARCH_LIMIT = 20;

export interface SearchViewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQuery: (query: string) => void;
  /** The field, so the container can focus it (the shortcut with the search already open). */
  inputRef: RefObject<HTMLInputElement | null>;
  /** Enter in the field: open the top result. */
  onSubmit: () => void;
  /** How many entries there are (the line under an empty field). */
  entryCount: number;
  /** How many entries match the query. */
  matches: number;
  /** The rows of the best `SEARCH_LIMIT` matches (`RouteRow`s in `li`s). */
  rows: ReactNode;
}

export function SearchView({
  open,
  onOpenChange,
  query,
  onQuery,
  inputRef,
  onSubmit,
  entryCount,
  matches,
  rows,
}: SearchViewProps) {
  const list = useRef<HTMLDivElement>(null);
  const typed = query.trim() !== '';
  const links = () => [...(list.current?.querySelectorAll<HTMLElement>('a') ?? [])];

  // ↓ goes from the field into the rows, ↑ and ↓ move between them, ↑ from the first returns to the field.
  const fieldKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    // An IME's Enter commits the composition, it does not open anything.
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'ArrowDown' && links().length > 0) {
      e.preventDefault();
      links()[0]!.focus();
    }
  };
  const rowKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') all[Math.min(at + 1, all.length - 1)]?.focus();
    else if (at <= 0) inputRef.current?.focus();
    else all[at - 1]?.focus();
  };

  return (
    <Sheet
      full
      open={open}
      onOpenChange={onOpenChange}
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
              aria-label="Search entries"
              placeholder="Search entries"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              onKeyDown={fieldKeys}
            />
          </InputGroup>
        </SearchHeader>
      }
    >
      <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
        {/* What a screen reader hears while the focus stays in the field. */}
        <output className="sr-only">
          {typed ? (matches === 0 ? 'No entry matches' : `${matches} ${matches === 1 ? 'entry' : 'entries'}`) : ''}
        </output>
        {!typed ? (
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">
            Type a title or an address. {entryCount} {entryCount === 1 ? 'entry' : 'entries'}.
          </p>
        ) : matches === 0 ? (
          <p className="m-0 px-1 text-sm text-tray-muted-foreground">No entry matches “{query.trim()}”.</p>
        ) : (
          <>
            <h2 className="m-0 px-1 text-sm font-medium text-tray-muted-foreground">Entries</h2>
            <div ref={list}>
              <Card as="ul" aria-label="Entries" onKeyDown={rowKeys}>
                {rows}
              </Card>
            </div>
            {matches > SEARCH_LIMIT ? (
              <p className="m-0 px-1 text-sm text-tray-muted-foreground">
                Showing {SEARCH_LIMIT} of {matches}: keep typing to narrow them.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
