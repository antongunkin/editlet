/**
 * State shared between the Astro integration (`astro/index.ts`) and the content loader (`astro/content.ts`). Both
 * run in one Node process but may be loaded as separate module instances (Vite bundles `content.config.ts`), so the
 * state lives in a `globalThis` slot rather than a module variable.
 */
export interface EditletAstroState {
  /** Absolute path of the Astro project root. */
  root: string;
  /** Schema file relative to `root`. */
  schemaPath: string;
  command: 'dev' | 'build' | 'preview' | 'sync';
}

export const DEFAULT_SCHEMA_PATH = 'cms/schema.json';

const SLOT = Symbol.for('editlet.astro');

type Slot = { [SLOT]?: EditletAstroState };

export function setAstroState(s: EditletAstroState): void {
  (globalThis as Slot)[SLOT] = s;
}

export function getAstroState(): EditletAstroState | undefined {
  return (globalThis as Slot)[SLOT];
}
