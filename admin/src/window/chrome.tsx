import { createContext, useContext, type ReactNode } from 'react';

import { ActivityStatus } from './ActivityStatus';
import { useWindowGesture } from './channel';
import { UnsavedLink, useEntryStatus } from './entryStatus';
import { LocalBranchBadge } from './LocalBranchBadge';

import { BranchChip } from '../github/BranchChip';
import { useWorkspace } from '../github/workspace';
import { StatusChips } from '../ui/parts/status-chips';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';

// Every screen draws its own chrome (FigCraft `Header` with the window's actions, `BottomBar` with the status line):
// it calls `useScreenChrome()` for what the window hands it (docs/admin/ui.md#screens). The window has no title bar or
// status bar of its own.

export interface ScreenChrome {
  /** The window's own header actions, after the screen's: Move (a floating window only) and Minimize. */
  windowActions: ReactNode;
  /** The status line for the screen's `BottomBar`: the branch, the unsaved edits or a state, the activity. */
  status: ReactNode;
  /** The shell's connection, branch and refresh notices: the screen puts them under its header. */
  banners: ReactNode;
}

const ChromeContext = createContext<Omit<ScreenChrome, 'status'> | null>(null);

/** The window's side: provides the header actions and the banners to the screen inside. */
export function ChromeProvider({
  sheet,
  onMinimize,
  banners,
  children,
}: {
  /** The window is a bottom sheet: it has no Move button. */
  sheet: boolean;
  onMinimize: () => void;
  banners: ReactNode;
  children: ReactNode;
}) {
  const windowActions = <WindowActions sheet={sheet} onMinimize={onMinimize} />;
  return <ChromeContext.Provider value={{ windowActions, banners }}>{children}</ChromeContext.Provider>;
}

/**
 * A screen's chrome: the window's header actions, the status line and the banners. Outside a window (`/design`,
 * tests) the actions and banners are empty and the status line shows what the workspace knows.
 */
export function useScreenChrome(): ScreenChrome {
  const chrome = useContext(ChromeContext);
  return { windowActions: chrome?.windowActions ?? null, banners: chrome?.banners ?? null, status: <WindowStatus /> };
}

/** Move (pointer drag, or the arrow keys; Alt+arrows resize) and Minimize: the header's last two actions. */
function WindowActions({ sheet, onMinimize }: { sheet: boolean; onMinimize: () => void }) {
  const move = useWindowGesture('move');
  return (
    <>
      {sheet ? null : (
        <IconButton
          className="cursor-grab touch-none"
          label="Move window"
          title="Drag to move; arrow keys move it, Alt+arrows resize it"
          icon={<Icon name="move" size={20} />}
          {...move}
        />
      )}
      {/* Not a real close: the window collapses into the pill, whose × closes the editor. */}
      <IconButton label="Minimize" onClick={onMinimize} icon={<Icon name="minimize" size={20} />} />
    </>
  );
}

/**
 * The status line (FigCraft `StatusChips`): GitHub mode the branch chip and the open entry's unsaved edits; dev mode
 * the checked-out branch and its uncommitted files. At its end, what the admin is doing (Loading…, Saving…).
 */
export function WindowStatus() {
  const workspace = useWorkspace();
  const entry = useEntryStatus();
  return (
    <StatusChips>
      {workspace ? (
        <>
          <BranchChip />
          <UnsavedLink entry={entry} />
        </>
      ) : (
        <LocalBranchBadge />
      )}
      <span className="ml-auto text-sm text-tray-muted-foreground">
        <ActivityStatus syncing={workspace !== null} />
      </span>
    </StatusChips>
  );
}
