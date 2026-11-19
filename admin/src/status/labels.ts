// The per-file statuses' words, without the hooks: the UI kit's StatusBadge and /design read them.

/**
 * A file's status beyond *Draft* / *Published* (spec: changes across entries § Part 2): `unsaved` = a row in this
 * browser's buffer, `review` = changed by a branch with an open, non-draft pull request, `changed` = GitHub: differs on
 * the active branch from the merge base; dev: saved to disk and not committed.
 */
export type FileStatus = 'unsaved' | 'review' | 'changed';

/** The order the badge picks from: the first status a file has. */
export const FILE_STATUS_ORDER: readonly FileStatus[] = ['unsaved', 'review', 'changed'];

/** *Changed*, *In review*, *Unsaved*: the word the rows and search show (`Post · Changed`). */
export function fileStatusLabel(status: FileStatus): string {
  return status === 'unsaved' ? 'Unsaved' : status === 'review' ? 'In review' : 'Changed';
}
