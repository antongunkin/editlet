import { createContext } from 'react';

/**
 * Where the rich text editor puts its formatting bar: the body's full-screen modal gives it a place at the bottom, above
 * the keyboard (FigCraft *Edit · Body*); `null` keeps it above the text. Its own module, so the provider does not load
 * the editor's chunk.
 */
export const ToolbarSlot = createContext<HTMLElement | null>(null);
