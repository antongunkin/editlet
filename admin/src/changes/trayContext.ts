import { createContext, useCallback, useContext } from 'react';

import type { Changes } from './useChanges';

import type { FieldDiffRow } from '../entry/diff';
import type { DataBody } from '../entry/values';

/**
 * What the open entry's form gives *Your changes*, so the tray can save the live entry, not its 300 ms old row, and tell
 * the form how the save went (`EntryEditor`).
 */
export interface FormHandle {
  /** The entry file this form holds. */
  path: string;
  /** Writes the form's row into the buffer now; the entry as it is at this moment. */
  flush(): Promise<DataBody | null>;
  /** Right before a commit: the next disk change is ours and replaces the form. */
  commitStart(): void;
  commitEnd(ok: boolean): void;
  /** The commit landed with this entry: the form is clean, its preview follows the saved file. */
  saved(submitted: DataBody): void;
  /** The save failed: show it on the form (its fields and its banner, with GitHub errors in the editor's words). */
  showError(error: unknown): void;
  /** *Revert this change* of the open entry. */
  revert(row: FieldDiffRow): void;
  /** *Discard changes to this entry* of the open entry. */
  discard(): void;
}

export type Tray = {
  /** The buffer, read once by the provider (the tray reads it as it is when it opens). */
  changes: Changes | null;
  open: boolean;
  setOpen(open: boolean): void;
  register(handle: FormHandle): () => void;
  handle(): FormHandle | null;
};

export const TrayContext = createContext<Tray | null>(null);

/** The tray's state; outside the window (`/design`, a bare test) opening it does nothing. */
export function useChangesTray(): Tray {
  return (
    useContext(TrayContext) ?? {
      changes: null,
      open: false,
      setOpen: () => undefined,
      register: () => () => undefined,
      handle: () => null,
    }
  );
}

const NO_CHANGES: Changes = {
  store: null,
  ready: false,
  rows: [],
  entries: [],
  images: [],
  count: 0,
  of: () => undefined,
};

/**
 * The changes buffer as the shell reads it once (`ChangesProvider`): the screens, the status line and the statuses
 * share it instead of each reading the schema, the file list and the store again. Empty outside the shell.
 */
export function useBuffer(): Changes {
  return useContext(TrayContext)?.changes ?? NO_CHANGES;
}

/** Opens *Your changes*. */
export function useOpenChanges(): () => void {
  const { setOpen } = useChangesTray();
  return useCallback(() => setOpen(true), [setOpen]);
}
