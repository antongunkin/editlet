import type { EntryFile } from '../../../core/entryFile';

/**
 * Initial frontmatter values for new, unsaved entries, keyed by `<collection>/<slug>`. `NewEntryDialog` sets them
 * before navigating; the entry screen takes them when it opens a path that does not exist yet. In memory only.
 */
export const pendingNewEntries = new Map<string, Record<string, unknown>>();

/**
 * Copies (⋯ → Duplicate): the whole file of a new, unsaved entry, keyed by `<collection>/<slug>`. The entry screen opens
 * it as it is (no schema defaults on top). In memory only.
 */
export const pendingCopies = new Map<string, EntryFile>();

/** Returns and removes the pending values for `key` (`<collection>/<slug>`). */
export function takePendingNewEntry(key: string): Record<string, unknown> | undefined {
  const values = pendingNewEntries.get(key);
  pendingNewEntries.delete(key);
  return values;
}
