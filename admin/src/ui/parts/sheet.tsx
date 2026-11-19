import { Drawer } from '@base-ui/react/drawer';
import {
  createContext,
  useContext,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';

import { Grabber } from './chrome';
import type { FinalFocus } from './focus';

import { cn } from '../cn';
import { Icon } from '../primitives/icon';
import { IconButton } from '../primitives/icon-button';

// The redesign's modal (FigCraft `final.modal`, `final.over`): a tray-coloured sheet that rises over the admin from
// 64 px below its top, each further level 20 px lower, and pushes the screen under it back. Built on Base UI Drawer
// (sheet spike, docs/superpowers/research/2026-11-18-sheet-spike.md) WITHOUT `Drawer.VirtualKeyboardProvider`: it
// breaks field focus inside the loader's iframe. The swipe and the push-back are the `sheet-*` utilities in app.css.

/**
 * Where the modals portal to: the admin's `<body>` by default. `/design` gives each frame's admin area, so a modal
 * covers the frame's admin as it covers the whole admin document in the loader's iframe.
 */
export const SheetPortal = createContext<HTMLElement | null>(null);

/** How deep the current sheet is: -1 outside any sheet, 0 in the first, 1 in a sheet opened from it… */
const SheetLevel = createContext(-1);

/**
 * The top offset of each level: 64 px, then 20 px lower per level (design: MODAL_TOP and `over`), four of them (64, 84,
 * 104, 124): a picker, the entry edited on top of it, its field, an object inside it. Deeper levels sit at 124 px.
 */
const LEVEL_TOP = ['pt-16', 'pt-21', 'pt-26', 'pt-31'] as const;

/** The modal title's type (`final.modal_header`: 18 px semibold), for a `Drawer.Title` or a plain heading. */
export const modalTitle = 'm-0 truncate text-lg font-semibold text-foreground';

/**
 * Wraps the admin once, around everything a sheet can push back. `SheetScreen` is the screen itself; the backdrop
 * behind it shows when it is pushed back.
 */
export function SheetProvider({ children }: { children: ReactNode }) {
  return (
    <Drawer.Provider>
      <Drawer.IndentBackground className="sheet-backdrop bg-backdrop" />
      {children}
    </Drawer.Provider>
  );
}

/** The screen a sheet pushes back: scale .915 (inset 16 px on a 375 px screen), 12 px down, radius 24. */
export function SheetScreen({ className, children }: { className?: string; children: ReactNode }) {
  return <Drawer.Indent className={cn('sheet-pushed relative', className)}>{children}</Drawer.Indent>;
}

export type ModalHeaderProps = Omit<ComponentProps<'div'>, 'title'> & {
  /** The title: a `Drawer.Title` in a sheet, a heading elsewhere; style it with `modalTitle`. */
  title: ReactNode;
  sub?: ReactNode;
  /** The close button, in the right-hand balance. */
  close?: ReactNode;
  /** A control in the left-hand balance (*Your changes* ⋯); an empty 44 px balance without it. */
  lead?: ReactNode;
};

/**
 * A modal's title row (`ModalHeader`): the title and a line under it, centred between two 44 px balances. A modal is the
 * tray, so the line is `tray-muted-foreground` (the design's `muted-foreground` is under 4.5 : 1 on the tray).
 */
export function ModalHeader({ title, sub, close, lead, className, ...props }: ModalHeaderProps) {
  return (
    <div data-slot="modal-header" className={cn('flex h-14 shrink-0 items-center gap-1 px-2', className)} {...props}>
      {lead ? (
        <span className="flex size-11 shrink-0 items-center justify-center">{lead}</span>
      ) : (
        <span aria-hidden="true" className="size-11 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col items-center">
        {title}
        {sub ? <p className="m-0 max-w-full truncate text-xs text-tray-muted-foreground">{sub}</p> : null}
      </div>
      <span className="flex size-11 shrink-0 items-center justify-center">{close}</span>
    </div>
  );
}

export type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The control that opens it (a `Button`); omitted when the caller controls `open`. */
  trigger?: ReactElement;
  /** The sheet's name for assistive technology; also its title row unless `header` replaces it. */
  title: string;
  sub?: ReactNode;
  /**
   * Replaces the title row (FigCraft *Search (⌘K)*: the `SearchHeader`). The `title` stays as the sheet's name, visually
   * hidden; the caller draws the way out (a back button), since the header has no ×.
   */
  header?: ReactNode;
  /** A control in the title row's left-hand balance (*Your changes* ⋯). */
  lead?: ReactNode;
  children?: ReactNode;
  /** The bottom bar's content (BottomBar, wave 3.2): stays under the scrolling content. */
  bar?: ReactNode;
  /** The whole admin, edge to edge, with no handle (FigCraft *Edit · Body*: the rich text editor). */
  full?: boolean;
  /**
   * `false`: no × and no handle to tap, and a tap on the scrim does nothing: the way out is in the sheet (*Sign in
   * again*). The caller keeps `open`, so a swipe or Escape cannot close it either.
   */
  closable?: boolean;
  /**
   * The content is only to read (a diff, a list of files): it takes a tab stop of its own, so a keyboard can scroll it
   * in every browser (Chrome and Firefox make such a scroller focusable by themselves, Safari does not).
   */
  readOnly?: boolean;
  /**
   * What takes the focus when it opens, instead of the sheet itself: a field the sheet is for (*New post*: the name). A
   * sheet that edits a field leaves it, so the keyboard does not rise uninvited.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * Where the focus goes when it closes (a sheet opened from a ⋯ row returns to ⋯: `ui/parts/focus.ts`; Search's *New
   * post* returns to where the focus was before the search opened).
   */
  finalFocus?: FinalFocus;
  /** Its open or close animation has finished (Search opens an action's dialog once the search is gone). */
  onOpenChangeComplete?: (open: boolean) => void;
  className?: string;
};

/**
 * A sheet over the admin. A swipe down (with the content scrolled to the top), a tap on the scrim or the handle, the ×
 * and Escape close it; Escape closes only the top level; focus returns to what opened it. It opens with the focus on
 * itself, not on its first field, so the keyboard does not rise uninvited. A `Sheet` inside a `Sheet` is the next
 * level: 20 px lower, over the first one's scrim.
 */
export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  trigger,
  title,
  sub,
  header,
  lead,
  children,
  bar,
  full,
  closable = true,
  readOnly,
  initialFocus,
  finalFocus,
  onOpenChangeComplete,
  className,
}: SheetProps) {
  const level = Math.min(useContext(SheetLevel) + 1, LEVEL_TOP.length - 1);
  const popup = useRef<HTMLDivElement>(null);
  const container = useContext(SheetPortal) ?? undefined;
  return (
    <Drawer.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange ? (next) => onOpenChange(next) : undefined}
      onOpenChangeComplete={onOpenChangeComplete}
      swipeDirection="down"
      disablePointerDismissal={!closable}
    >
      {trigger ? <Drawer.Trigger render={trigger} /> : null}
      <Drawer.Portal container={container}>
        {/* A nested level dims the level under it too (Base UI draws no nested backdrop by default). */}
        <Drawer.Backdrop forceRender className="sheet-scrim fixed inset-0 z-50 bg-overlay" />
        <Drawer.Viewport
          className={cn('fixed inset-0 z-50 flex flex-col justify-end', full ? 'pt-0' : LEVEL_TOP[level])}
        >
          <Drawer.Popup
            ref={popup}
            initialFocus={initialFocus ?? popup}
            finalFocus={finalFocus}
            className={cn(
              'sheet-motion flex h-full flex-col overflow-hidden bg-background text-foreground shadow-modal outline-none',
              full ? 'rounded-none' : 'rounded-t-3xl',
              className,
            )}
          >
            <SheetLevel.Provider value={level}>
              {full ? null : (
                <Grabber>
                  {/* A tap on the handle closes: a 44 px tall target over the bar. Pointer only: the × is the keyboard's and the
                    screen reader's way (on a coarse pointer it shows only while it has keyboard focus). */}
                  {closable ? (
                    <Drawer.Close
                      tabIndex={-1}
                      aria-hidden="true"
                      className="absolute top-0 left-1/2 h-11 w-22 -translate-x-1/2 cursor-pointer border-0 bg-transparent p-0"
                    />
                  ) : null}
                </Grabber>
              )}
              {header ? (
                <>
                  <Drawer.Title className="sr-only">{title}</Drawer.Title>
                  {header}
                </>
              ) : (
                <ModalHeader
                  title={<Drawer.Title className={modalTitle}>{title}</Drawer.Title>}
                  sub={sub}
                  lead={lead}
                  close={
                    closable ? (
                      <Drawer.Close
                        render={
                          <IconButton
                            label="Close"
                            icon={<Icon name="x" size={20} />}
                            // A full-screen sheet cannot be swiped away: its × stays on a phone too.
                            className={full ? undefined : 'pointer-coarse:not-focus-visible:sr-only'}
                          />
                        }
                      />
                    ) : undefined
                  }
                />
              )}
              <Drawer.Content
                tabIndex={readOnly ? 0 : undefined}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none focused:inset-ring-2 focused:inset-ring-ring"
              >
                {children}
              </Drawer.Content>
              {bar}
            </SheetLevel.Provider>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
