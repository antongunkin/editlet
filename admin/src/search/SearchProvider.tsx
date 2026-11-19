import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import { searchEntries } from './match';
import { SEARCH_LIMIT, SearchView } from './SearchView';
import { useSearchEntries } from './useSearchEntries';

import { formatRoute, type Route } from '../route';
import { RouteRow } from '../screens/RouteRow';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { useRoute } from '../useRoute';
import { OPEN_MODAL } from '../window/modal';

// Search (docs/admin/search.md): one sheet for the whole admin, opened by the header's Search button or by ⌘K / Ctrl+K.

const SearchContext = createContext<(() => void) | null>(null);

/** Opens the search; `null` outside a window (`/design`, a screen on its own): the button is then left out. */
export function useOpenSearch(): (() => void) | null {
  return useContext(SearchContext);
}

/** Is this the shortcut: ⌘K on macOS, Ctrl+K elsewhere (both are accepted anywhere)? */
export function isSearchShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
) {
  // `code` too: on a Cyrillic layout the K key reports `л`.
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === 'k' || e.code === 'KeyK');
}

/**
 * Owns the search sheet and its shortcut. `enabled` is false while the window is collapsed into the pill. The shortcut
 * never opens a second modal over a form (a field editor, a confirmation); with the search open it focuses the field.
 * `available` is false where there is no content to search (the sign-in and error screens have no source): the provider
 * then adds nothing, and the header button is left out.
 */
export function SearchProvider({
  enabled,
  available = true,
  children,
}: {
  enabled: boolean;
  available?: boolean;
  children: ReactNode;
}) {
  if (!available) return <>{children}</>;
  return <ActiveSearch enabled={enabled}>{children}</ActiveSearch>;
}

function ActiveSearch({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { raw } = useRoute();

  // A screen change (a result was chosen, or the site navigated) ends the search; so does collapsing the window.
  const [seen, setSeen] = useState(raw);
  if (seen !== raw) {
    setSeen(raw);
    setOpen(false);
  }
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      if (open) {
        e.preventDefault();
        input.current?.focus();
      } else if (!document.querySelector(OPEN_MODAL)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, open]);

  const openSearch = useMemo(() => () => setOpen(true), []);
  return (
    <SearchContext.Provider value={openSearch}>
      {children}
      <SearchSheet open={open} onOpenChange={setOpen} inputRef={input} />
    </SearchContext.Provider>
  );
}

function SearchSheet({
  open,
  onOpenChange,
  inputRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const { raw, navigate } = useRoute();
  // Nothing is read before the first opening; what was read stays while the sheet closes (no flash of an empty list).
  const [used, setUsed] = useState(open);
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !used) setUsed(true);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery(''); // a new opening starts empty
  }
  const entries = useSearchEntries(used);
  // The entry already open is no navigation (no route change closes the search): choosing it closes the search itself.
  const choose = (to: Route) => (formatRoute(to) === raw ? onOpenChange(false) : navigate(to));

  const found = useMemo(() => searchEntries(entries, query), [entries, query]);
  const top = found[0];
  const rows = found.slice(0, SEARCH_LIMIT).map((entry, i) => (
    <li key={`${entry.collection}/${entry.slug}`}>
      <RouteRow
        to={{ kind: 'entry', collection: entry.collection, slug: entry.slug }}
        lead="file"
        title={entry.title}
        sub={entry.draft ? `${entry.collectionLabel} · Draft` : entry.collectionLabel}
        data-selected={i === 0 ? '' : undefined}
        onClick={() =>
          formatRoute({ kind: 'entry', collection: entry.collection, slug: entry.slug }) === raw && onOpenChange(false)
        }
      />
    </li>
  ));
  return (
    <SearchView
      open={open}
      onOpenChange={onOpenChange}
      query={query}
      onQuery={setQuery}
      inputRef={inputRef}
      onSubmit={() => top && choose({ kind: 'entry', collection: top.collection, slug: top.slug })}
      entryCount={entries.length}
      matches={found.length}
      rows={rows}
    />
  );
}

/** The header's Search button (a magnifier); nothing where there is no search to open. */
export function SearchButton() {
  const openSearch = useOpenSearch();
  if (!openSearch) return null;
  return (
    <IconButton
      label="Search"
      aria-haspopup="dialog"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={openSearch}
      icon={<Icon name="search" size={20} />}
    />
  );
}
