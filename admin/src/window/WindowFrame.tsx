import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useEdgeHover, usePageSheet, usePageViewport, useWindowGesture } from './channel';
import { ChromeProvider } from './chrome';
import { EntryStatusProvider } from './entryStatus';
import { OPEN_MODAL } from './modal';
import { Pill } from './Pill';

import { EDGES, type Edge } from '../../../loader/window/geometry';
import { SearchProvider } from '../search/SearchProvider';
import { useSelectRequest } from '../select/SelectProvider';
import { cn } from '../ui/cn';
import { SheetProvider, SheetScreen } from '../ui/parts/sheet';
import { Toaster } from '../ui/primitives/toast';

/**
 * One invisible resize zone: only its cursor shows it. Hovering any zone lights them all up, and window.js lights the
 * window's outline in the page.
 */
function ResizeEdge({ edge }: { edge: Edge }) {
  const resize = useWindowGesture(edge);
  const hover = useEdgeHover(edge);
  return (
    <div
      // Its place, size and cursor: app.css (`[data-editlet='window-edge']`, the clip path of a corner).
      data-editlet="window-edge"
      data-edge={edge}
      aria-hidden="true"
      className="pointer-events-auto"
      {...resize}
      {...hover}
    />
  );
}

/**
 * Escape outside an open modal (and not already handled) collapses the window, like its Minimize button. With a modal
 * open, Escape only closes the modal.
 */
function useEscapeToCollapse(collapse: () => void, collapsed: boolean) {
  useEffect(() => {
    if (collapsed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // An open modal takes Escape for itself (Confirm, Sheet, ActionSheet).
      if (document.querySelector(OPEN_MODAL)) return;
      collapse();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [collapse, collapsed]);
}

/**
 * The floating window's frame, inside the loader's iframe: the screen (which draws its own header and bottom bar, with
 * the window's Move and Minimize from `useScreenChrome`), the resize zones (over the sheets), the pill and the sheets. window.js (in the
 * site page) owns the geometry and obeys the gestures sent from here.
 */
export function WindowFrame({
  banners,
  search = true,
  children,
}: {
  /** The connection, branch and refresh notices: each screen puts them under its own header. */
  banners?: ReactNode;
  /** Search (⌘K) over the content: `false` before the shell exists (the sign-in and error screens have no source). */
  search?: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Expanding from the pill puts the focus back where it was when the window collapsed (the Minimize button, a field).
  const focusBeforeCollapse = useRef<HTMLElement | null>(null);
  const collapse = useCallback(() => {
    focusBeforeCollapse.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCollapsed(true);
  }, []);
  useEffect(() => {
    if (collapsed) return;
    const el = focusBeforeCollapse.current;
    focusBeforeCollapse.current = null;
    if (el?.isConnected && el !== document.body) el.focus();
  }, [collapsed]);
  // Edit on a page selection opens the window from the pill.
  const { request } = useSelectRequest();
  useEffect(() => {
    if (request) setCollapsed(false);
  }, [request]);
  useEscapeToCollapse(collapse, collapsed);
  usePageViewport(window.parent !== window);
  const sheet = usePageSheet();
  return (
    <SheetProvider>
      <Toaster>
        <SearchProvider enabled={!collapsed} available={search}>
          <EntryStatusProvider>
            <ChromeProvider sheet={sheet} onMinimize={collapse} banners={banners}>
              {/* A sheet (ui/parts/sheet.tsx) pushes the whole window back. Collapsed, the window stays mounted (faded
                out, inert), so the open form keeps its unsaved edits. */}
              <SheetScreen>
                <div
                  data-editlet="window"
                  data-collapsed={collapsed ? '' : undefined}
                  className={cn(
                    'relative grid h-screen grid-rows-1 bg-background font-sans text-foreground morph',
                    collapsed && 'morph-out',
                  )}
                  inert={collapsed}
                >
                  {/* The screen fills the window (`flex-1 min-h-0`) and scrolls inside itself. */}
                  <div
                    className="@container flex min-h-0 flex-col overflow-hidden overscroll-contain *:flex *:min-h-0 *:flex-1 *:flex-col"
                    data-editlet="window-body"
                  >
                    {children}
                  </div>
                </div>
              </SheetScreen>
              {/* Pull any edge or corner to resize. The layer is not in the screen a sheet pushes back, and is over
                the sheets' scrim (z-60 over their z-50), so the window resizes under an open modal. A bottom sheet has
                none: window.js's handle on its top edge resizes it, outside this iframe. Collapsed, the window is
                the pill and there is nothing to resize. Alt+arrows on the move button resize too. */}
              {sheet || collapsed ? null : (
                <div data-editlet="window-edges" aria-hidden="true" className="pointer-events-none fixed inset-0 z-60">
                  {EDGES.map((edge) => (
                    <ResizeEdge key={edge} edge={edge} />
                  ))}
                </div>
              )}
            </ChromeProvider>
            <Pill collapsed={collapsed} onExpand={() => setCollapsed(false)} />
          </EntryStatusProvider>
        </SearchProvider>
      </Toaster>
    </SheetProvider>
  );
}
