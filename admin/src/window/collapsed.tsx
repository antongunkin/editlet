import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

type Collapsed = [boolean, Dispatch<SetStateAction<boolean>>];

const CollapsedContext = createContext<Collapsed | null>(null);

/**
 * Whether the window is collapsed into the pill, kept above the screens: each screen before the shell (`GateFrame`) and
 * the shell have a `WindowFrame` of their own, and one replaces another (loading → shell). Without this, a window
 * minimized while it loads would open again.
 */
export function CollapsedProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  return <CollapsedContext value={[collapsed, setCollapsed]}>{children}</CollapsedContext>;
}

/** `[collapsed, setCollapsed]` of the provider; without one (a screen rendered on its own), the caller's own. */
export function useCollapsed(): Collapsed {
  const own = useState(false);
  return useContext(CollapsedContext) ?? own;
}
