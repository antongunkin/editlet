import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { ActivityStatus } from './ActivityStatus';
import { useEdgeHover, usePageSheet, useWindowGesture, useWindowPill } from './channel';
import { DraftBadge, EntryStatusProvider, UnsavedLink, useEntryStatus } from './entryStatus';
import { LocalBranchBadge } from './LocalBranchBadge';
import { useTheme } from './settings';

import { EDGES, type Edge } from '../../../loader/window/geometry';
import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { BranchChip } from '../github/BranchChip';
import { routeFromBranch } from '../github/branchName';
import { UserMenu } from '../github/UserMenu';
import { useWorkspace } from '../github/workspace';
import { parentRoute, type Route } from '../route';
import { RouteLink } from '../RouteLink';
import { useSelectRequest } from '../select/SelectProvider';
import { Button, buttonVariants } from '../ui/Button';
import { cn } from '../ui/cn';
import { DialogEdges } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { useBridge } from '../useRoute';

/** Closes the popover after a link inside it was followed. */
function closeOnLink(e: MouseEvent<HTMLElement>) {
  if ((e.target as HTMLElement).closest('a')) e.currentTarget.hidePopover?.();
}

/** The nav trigger's icon and text: the section the editor is in (Home, Post, Content model), never the entry. */
function routeSection(route: Route, schema: SchemaData | undefined): { icon: ReactNode; label: string } {
  switch (route.kind) {
    case 'home':
      return { icon: <Icon.Home size={16} />, label: 'Home' };
    case 'collection':
    case 'entry': {
      const collection = schema?.schema.collections[route.collection];
      return {
        icon: collection?.singleton ? <Icon.File size={16} /> : <Icon.Folder size={16} />,
        label: collection?.label ?? route.collection,
      };
    }
    case 'schema':
      return { icon: <Icon.Eye size={16} />, label: 'Content model' };
    case 'media':
      return { icon: <Icon.Image size={16} />, label: 'Media' };
    case 'branch':
      return { icon: <Icon.Eye size={16} />, label: 'Review changes' };
    case 'unknown':
      return { icon: <Icon.Home size={16} />, label: 'Editlet' };
  }
}

function NavMenu({ id, schema, route }: { id: string; schema: SchemaData | undefined; route: Route }) {
  const files = useFiles();
  const workspace = useWorkspace();
  const active = route.kind === 'collection' || route.kind === 'entry' ? route.collection : null;
  return (
    <nav className="editlet-menu editlet-menu--nav" id={id} popover="auto" aria-label="Editlet" onClick={closeOnLink}>
      <RouteLink
        to={{ kind: 'home' }}
        className="editlet-menu__item"
        aria-current={route.kind === 'home' ? 'page' : undefined}
      >
        <Icon.Home size={16} />
        Home
      </RouteLink>
      <div className="editlet-menu__separator" />
      <div className="editlet-menu__label">Collections</div>
      {schema
        ? Object.entries(schema.schema.collections).map(([key, c]) => (
            <RouteLink
              key={key}
              to={{ kind: 'collection', collection: key }}
              className="editlet-menu__item"
              aria-current={active === key ? 'page' : undefined}
            >
              {c.singleton ? <Icon.File size={16} /> : <Icon.Folder size={16} />}
              {c.label}
              {!c.singleton && files.data ? (
                <span className="editlet-menu__count">{entryRefs(schema.schema, files.data, key).length}</span>
              ) : null}
            </RouteLink>
          ))
        : null}
      <div className="editlet-menu__separator" />
      <RouteLink
        to={{ kind: 'media' }}
        className="editlet-menu__item"
        aria-current={route.kind === 'media' ? 'page' : undefined}
      >
        <Icon.Image size={16} />
        Media
      </RouteLink>
      <RouteLink
        to={{ kind: 'schema' }}
        className="editlet-menu__item"
        aria-current={route.kind === 'schema' ? 'page' : undefined}
      >
        <Icon.Eye size={16} />
        Content model
      </RouteLink>
      {workspace ? (
        <>
          <div className="editlet-menu__separator" />
          <div className="editlet-menu__account">
            <UserMenu />
          </div>
        </>
      ) : null}
    </nav>
  );
}

/** One button that flips Light and Dark; its icon shows the theme it switches to. */
function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${next} theme`;
  return (
    <Button variant="ghost" size="sm" iconOnly aria-label={label} title={label} onClick={() => setTheme(next)}>
      {next === 'dark' ? <Icon.Moon size={20} /> : <Icon.Sun size={20} />}
    </Button>
  );
}

/** The files the active branch changes against the base: one compare call, refetched after every save. */
function useBranchChanges(): number | null {
  const workspace = useWorkspace();
  const files = useFiles();
  const enabled = workspace !== null && !workspace.onBase;
  const changes = useQuery({
    queryKey: ['branch-changes', workspace?.active, files.dataUpdatedAt],
    queryFn: async () => (await workspace!.source.compare()).files.length,
    enabled,
  });
  return enabled ? (changes.data ?? null) : null;
}

/** "Status: live" on the base branch, "Status: draft (n changes)" on a `<prefix>*` branch. */
function statusText(workspace: NonNullable<ReturnType<typeof useWorkspace>>, changes: number | null): string {
  if (workspace.onBase) return 'Status: live';
  if (changes === null) return 'Status: draft';
  return `Status: draft (${changes} ${changes === 1 ? 'change' : 'changes'})`;
}

/** GitHub mode: the open entry's draft flag and unsaved edits (local mode shows them inside the branch badge). */
function EntryState() {
  const entry = useEntryStatus();
  if (!entry) return null;
  return (
    <>
      <UnsavedLink entry={entry} />
      <DraftBadge entry={entry} />
    </>
  );
}

/**
 * One small line of text. Local mode: the dev server's files. GitHub mode: the status, the branch, and Review changes
 * off the base branch. At the right end, what the admin is doing with its data (Loading…, Saving…, Syncing…).
 */
function StatusBar() {
  const workspace = useWorkspace();
  const changes = useBranchChanges();
  return (
    <footer className="editlet-window__status">
      {workspace ? (
        <span className="editlet-window__status-text">{statusText(workspace, changes)}</span>
      ) : (
        <LocalBranchBadge />
      )}
      {workspace ? (
        <>
          <BranchChip />
          {workspace.onBase ? null : (
            <RouteLink
              to={{ kind: 'branch', name: routeFromBranch(workspace.active, workspace.prefix) }}
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              <span className="editlet-button__icon">
                <Icon.Eye />
              </span>
              Review changes
            </RouteLink>
          )}
        </>
      ) : null}
      {workspace ? <EntryState /> : null}
      <ActivityStatus syncing={workspace !== null} />
    </footer>
  );
}

/**
 * One invisible resize zone: only its cursor shows it. Hovering any zone lights them all up, and window.js lights the
 * window's outline in the page.
 */
function ResizeEdge({ edge }: { edge: Edge }) {
  const resize = useWindowGesture(edge);
  const hover = useEdgeHover();
  return (
    <div className={`editlet-window__edge editlet-window__edge--${edge}`} aria-hidden="true" {...resize} {...hover} />
  );
}

/**
 * The collapsed window: Pencil + Editlet (expands it again) | × (closes the editor for real, after the unsaved-changes
 * guard, with a short fade). Always mounted, so it can fade in and out (and be measured); window.js sizes the dialog
 * to it while `collapsed`.
 */
function Pill({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const { close } = useBridge();
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  useWindowPill(ref, collapsed);
  // Keyboard users keep their place: the × they pressed is gone now, so focus the pill's Editlet button.
  useEffect(() => {
    if (collapsed) ref.current?.querySelector('button')?.focus();
  }, [collapsed]);
  // The exit animation runs once the guard allowed the close; `close` is sent when it ends.
  const exit = () => {
    flushSync(() => setClosing(true));
    const animations = ref.current?.getAnimations?.() ?? [];
    return animations.length ? Promise.all(animations.map((a) => a.finished)).then(() => {}) : null;
  };
  return (
    <div
      className={cn('editlet-pill', collapsed && 'editlet-pill--open', closing && 'editlet-pill--closing')}
      ref={ref}
      inert={!collapsed}
    >
      <Button variant="ghost" size="sm" icon={<Icon.Pencil size={16} />} onClick={onExpand}>
        Editlet
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Close Editlet"
        title="Close"
        onClick={() => close({ exit })}
      >
        <Icon.X size={16} />
      </Button>
    </div>
  );
}

/** An open popover menu (navigation, More actions): Escape closes it, so it must not also collapse the window. */
function popoverOpen(): boolean {
  return [...document.querySelectorAll('[popover]')].some((el) => {
    try {
      return el.matches(':popover-open');
    } catch {
      return false; // a DOM without the Popover API (jsdom) has no open popovers
    }
  });
}

/**
 * Escape outside an open dialog or menu (and not already handled) collapses the window, like its minimize button. With
 * a menu open, Escape only closes the menu, as on any page.
 */
function useEscapeToCollapse(collapse: () => void, collapsed: boolean) {
  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('dialog[open]') || popoverOpen()) return;
      collapse();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [collapse, collapsed]);
}

/**
 * The floating window's chrome, drawn by the admin inside the loader's iframe: navigation, drag area, theme, minimize,
 * status. window.js (in the site page) owns the geometry and obeys the gestures sent from here.
 */
export function WindowFrame({
  schema,
  route,
  children,
}: {
  schema: SchemaData | undefined;
  route: Route;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const collapse = useCallback(() => setCollapsed(true), []);
  // Edit on a page selection opens the window from the pill.
  const { request } = useSelectRequest();
  useEffect(() => {
    if (request) setCollapsed(false);
  }, [request]);
  useEscapeToCollapse(collapse, collapsed);
  const move = useWindowGesture('move');
  const sheet = usePageSheet();
  const nav = useId();
  const section = routeSection(route, schema);
  const parent = parentRoute(route);
  // Pull any edge or corner to resize. A bottom sheet has none: window.js's handle on its top edge resizes it, outside
  // this iframe. Alt+arrows on the move button resize too. An open dialog draws the same edges on its sheet: a modal
  // dialog makes these ones inert.
  const edges = sheet ? null : EDGES.map((edge) => <ResizeEdge key={edge} edge={edge} />);
  return (
    <EntryStatusProvider>
      <DialogEdges.Provider value={edges}>
        {/* Collapsed, the window stays mounted (faded out, inert), so the open form keeps its unsaved edits. */}
        <div
          className={cn('editlet-window', sheet && 'editlet-window--sheet', collapsed && 'editlet-window--collapsed')}
          inert={collapsed}
        >
          <header className="editlet-window__bar">
            <div className="editlet-window__group">
              {parent ? (
                <RouteLink
                  to={parent}
                  className={buttonVariants({ variant: 'ghost', size: 'sm', iconOnly: true })}
                  aria-label="Back"
                  title={`Back to ${routeSection(parent, schema).label}`}
                >
                  <Icon.ArrowLeft size={20} />
                </RouteLink>
              ) : null}
              <Button
                variant="ghost"
                size="sm"
                className="editlet-window__nav"
                icon={section.icon}
                iconRight={<Icon.ChevronDown size={16} />}
                popoverTarget={nav}
                aria-label="Navigation"
              >
                <span className="editlet-window__nav-label">{section.label}</span>
              </Button>
            </div>
            {/* The empty middle of the bar moves the window: drag it anywhere, or press the arrow keys on the move button at
              its right end (the keys bubble up to the handlers here). A bottom sheet stays put; there it is only a spacer. */}
            {sheet ? (
              <div className="editlet-window__drag" />
            ) : (
              <div className="editlet-window__drag editlet-window__drag--live" {...move}>
                <Button
                  variant="ghost"
                  size="sm"
                  iconOnly
                  className="editlet-window__move"
                  aria-label="Move window"
                  title="Drag to move; arrow keys move it, Alt+arrows resize it"
                >
                  <Icon.Move size={20} />
                </Button>
              </div>
            )}
            <div className="editlet-window__group editlet-window__group--end">
              <ThemeToggle />
              {/* Not a real close: the window collapses into the pill, whose × closes the editor. */}
              <Button variant="ghost" size="sm" iconOnly aria-label="Minimize" title="Minimize" onClick={collapse}>
                <Icon.Minimize size={20} />
              </Button>
            </div>
            <NavMenu id={nav} schema={schema} route={route} />
          </header>
          {/* The body and, over it, the layer that dialogs open in (`DialogContent`): the bar and the status bar stay
              outside both, so Minimize and the rest of the bar work while a dialog is open. */}
          <div className="editlet-window__main">
            <div className="editlet-window__body">{children}</div>
            <div className="editlet-window__dialogs" data-editlet-dialogs="" />
          </div>
          <StatusBar />
          {edges}
        </div>
      </DialogEdges.Provider>
      <Pill collapsed={collapsed} onExpand={() => setCollapsed(false)} />
    </EntryStatusProvider>
  );
}
