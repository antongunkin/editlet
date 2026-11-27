import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';

import {
  buildActions,
  contextActions,
  searchActions,
  topResult,
  type ScreenAction,
  type SearchAction,
} from './actions';
import { entrySub, searchEntries, type CollectionNoun, type SearchEntry } from './match';
import { ActionResult, SEARCH_LIMIT, SearchView } from './SearchView';
import { useSearchEntries } from './useSearchEntries';

import { useFiles, useSchema } from '../data/queries';
import { BranchDialog } from '../github/BranchDialog';
import { useWorkspace } from '../github/workspace';
import { formatRoute, type Route } from '../route';
import { entryNoun, NewEntryDialog } from '../screens/NewEntryDialog';
import { RouteRow } from '../screens/RouteRow';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { useRoute } from '../useRoute';
import { OPEN_MODAL } from '../window/modal';
import { useThemeChoice } from '../window/settings';

// Search (docs/admin/search.md): one sheet for the whole admin, opened by the header's Search button or by ⌘K / Ctrl+K.

const SearchContext = createContext<(() => void) | null>(null);

/** Opens the search; `null` outside a window (`/design`, a screen on its own): the button is then left out. */
export function useOpenSearch(): (() => void) | null {
  return useContext(SearchContext);
}

/** The open screen's actions (`useSearchActions`); `null` outside a search provider. */
const SearchActionsContext = createContext<((actions: readonly ScreenAction[]) => void) | null>(null);

/**
 * A screen offers these actions in the search while it is mounted (the entry's *Duplicate this entry*), as
 * `useReportEntryStatus` reports the entry's state: the callbacks are kept in a ref and only the rest (labels, `disabled`,
 * the note) re-registers, so a new `run` each render does not loop. Cleared on unmount; a no-op outside a window.
 */
export function useSearchActions(actions: readonly ScreenAction[]): void {
  const report = useContext(SearchActionsContext);
  const runs = useRef(new Map<string, () => void>());
  runs.current = new Map(actions.map((a) => [a.id, a.run]));
  const key = JSON.stringify(actions.map(({ run: _, ...rest }) => rest));
  useEffect(() => {
    if (!report) return;
    const listed = (JSON.parse(key) as Omit<ScreenAction, 'run'>[]).map((a) => ({
      ...a,
      run: () => runs.current.get(a.id)?.(),
    }));
    report(listed);
    return () => report([]);
  }, [report, key]);
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

/** A dialog an action opens once the search has closed. */
type ActionDialog = { kind: 'new'; collection: string } | { kind: 'branch' };

function ActiveSearch({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { raw } = useRoute();
  const [screenActions, setScreenActions] = useState<readonly ScreenAction[]>([]);
  // What had the focus before the search opened: an action's dialog gives it back on close.
  const returnTo = useRef<HTMLElement | null>(null);
  // The dialog an action asked for: opened once the sheet's close has finished (never two modals at once).
  const queued = useRef<ActionDialog | null>(null);
  const [dialog, setDialog] = useState<ActionDialog | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // A screen change (a result was chosen, or the site navigated) ends the search; so does collapsing the window.
  const [seen, setSeen] = useState(raw);
  // A dialog an action opened goes with the screen it was opened over, as the screen's own dialogs would.
  const closeAll = () => {
    queued.current = null;
    setDialogOpen(false);
    setOpen(false);
  };
  if (seen !== raw) {
    setSeen(raw);
    closeAll();
  }
  useEffect(() => {
    if (enabled) return;
    queued.current = null;
    setDialogOpen(false);
    setOpen(false);
  }, [enabled]);

  const openSearch = useMemo(
    () => () => {
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
      queued.current = null;
      setOpen(true);
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !isSearchShortcut(e)) return;
      if (open) {
        e.preventDefault();
        input.current?.focus();
      } else if (!document.querySelector(OPEN_MODAL)) {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled, open, openSearch]);

  const openDialog = (next: ActionDialog) => {
    queued.current = next;
    setOpen(false);
  };
  const onClosed = (isOpen: boolean) => {
    if (isOpen || !queued.current) return;
    setDialog(queued.current);
    setDialogOpen(true);
    queued.current = null;
  };

  return (
    <SearchContext.Provider value={openSearch}>
      <SearchActionsContext.Provider value={setScreenActions}>{children}</SearchActionsContext.Provider>
      <SearchSheet
        open={open}
        onOpenChange={setOpen}
        onClosed={onClosed}
        inputRef={input}
        screenActions={screenActions}
        onDialog={openDialog}
      />
      {dialog?.kind === 'new' ? (
        <NewActionDialog
          collection={dialog.collection}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          finalFocus={returnTo.current ? returnTo : undefined}
        />
      ) : dialog?.kind === 'branch' ? (
        <BranchDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          finalFocus={returnTo.current ? returnTo : undefined}
        />
      ) : null}
    </SearchContext.Provider>
  );
}

/** *New post* from the search: the collection's own dialog, while the schema is there. */
function NewActionDialog({
  collection,
  ...props
}: {
  collection: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const schema = useSchema().data;
  return schema ? <NewEntryDialog collection={collection} schema={schema} {...props} /> : null;
}

function SearchSheet({
  open,
  onOpenChange,
  onClosed,
  inputRef,
  screenActions,
  onDialog,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClosed: (open: boolean) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  screenActions: readonly ScreenAction[];
  onDialog: (dialog: ActionDialog) => void;
}) {
  const [query, setQuery] = useState('');
  const { route, raw, navigate } = useRoute();
  const schema = useSchema().data?.schema;
  const files = useFiles().data;
  const branch = useWorkspace()?.active ?? null;
  const [theme, chooseTheme] = useThemeChoice();
  // Nothing is listed before the first opening, and no file is read before the first character typed. Both then stay
  // for the session: no flash of an empty list on closing, and clearing the field does not stop the read.
  const [used, setUsed] = useState(open);
  const [searched, setSearched] = useState(false);
  const typed = query.trim() !== '';
  if (typed && !searched) setSearched(true);
  const [wasOpen, setWasOpen] = useState(open);
  if (open && !used) setUsed(true);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setQuery(''); // a new opening starts empty
  }
  const { entries, loaded, total, failed } = useSearchEntries(used, searched);
  // The screen already open is no navigation (no route change closes the search): choosing it closes the search itself.
  const choose = (to: Route) => (formatRoute(to) === raw ? onOpenChange(false) : navigate(to));

  const found = useMemo(() => searchEntries(entries, query), [entries, query]);
  const all = useMemo(
    () => (schema ? buildActions({ schema, files, branch, route, theme, screenActions }) : []),
    [schema, files, branch, route, theme, screenActions],
  );
  const ranked = useMemo(() => searchActions(all, query), [all, query]);
  const actions = typed ? ranked.map((r) => r.action) : contextActions(all);
  const top = topResult(found, ranked, query);

  const run = (action: SearchAction) => {
    if (action.disabled) return;
    const what = action.run;
    if (what.kind === 'navigate') choose(what.to);
    else if (what.kind === 'new') onDialog({ kind: 'new', collection: what.collection });
    else if (what.kind === 'switch-branch') onDialog({ kind: 'branch' });
    // The redraw is the confirmation; the search stays open and its rows follow the new choice.
    else if (what.kind === 'theme') chooseTheme(what.choice);
    else what.call();
  };
  const openEntry = (entry: SearchEntry) => choose({ kind: 'entry', collection: entry.collection, slug: entry.slug });

  // A count names the referring collection when its labels have a plural (*4 posts*); else *Used by 4 entries*.
  const noun: CollectionNoun = (collection) => {
    const def = schema?.collections[collection];
    if (!def || def.pluralLabel === undefined) return undefined;
    return { one: entryNoun(def.label), many: entryNoun(def.pluralLabel) };
  };
  const rows = found.slice(0, SEARCH_LIMIT).map((entry) => (
    <li key={`${entry.collection}/${entry.slug}`}>
      <RouteRow
        to={{ kind: 'entry', collection: entry.collection, slug: entry.slug }}
        lead="file"
        title={entry.title}
        sub={entrySub(entry, noun)}
        data-selected={top?.kind === 'entry' && top.entry === entry ? '' : undefined}
        onClick={() =>
          formatRoute({ kind: 'entry', collection: entry.collection, slug: entry.slug }) === raw && onOpenChange(false)
        }
      />
    </li>
  ));
  const actionRows = actions.map((action) => (
    <li key={action.id}>
      <ActionResult
        icon={action.icon}
        label={action.label}
        sub={action.sub}
        note={action.note}
        disabled={action.disabled}
        selected={top?.kind === 'action' && top.action === action}
        onRun={() => run(action)}
      />
    </li>
  ));
  return (
    <SearchView
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onClosed}
      query={query}
      onQuery={setQuery}
      inputRef={inputRef}
      onSubmit={() => {
        if (top?.kind === 'entry') openEntry(top.entry);
        else if (top?.kind === 'action') run(top.action);
      }}
      entryCount={entries.length}
      loading={{ loaded, total, failed }}
      matches={found.length}
      rows={rows}
      actionCount={actions.length}
      actions={actionRows}
      actionsFirst={top?.kind === 'action'}
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
