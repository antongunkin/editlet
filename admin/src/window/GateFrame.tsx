import type { ReactNode } from 'react';

import { WindowFrame } from './WindowFrame';

/**
 * The window around a screen that shows before the shell exists: sign-in, the access stops, *Editing is not set up*, a
 * schema that does not load. It is the shell's own `WindowFrame` (Minimize, Move, the pill, the sheets), and the screen
 * inside draws the rest (`useScreenChrome`). No search: there is no source yet.
 */
export function GateFrame({ children }: { children: ReactNode }) {
  return <WindowFrame search={false}>{children}</WindowFrame>;
}
