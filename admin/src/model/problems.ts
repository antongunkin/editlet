import type { EntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { isHiddenContentPath, isImagePath, parseEntryPath, refKey } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import { validateEntry } from '../../../core/validate';

export type ProblemCandidate = FileRef & { entry: { collection: string; slug: string } | null };

/** Files under `contentDir` to check: no schema file, hidden paths or images. `entry` is null for a non-entry path. */
export function problemCandidates(schema: Schema, schemaPath: string, files: FileRef[]): ProblemCandidate[] {
  const prefix = `${schema.contentDir}/`;
  return files
    .filter(
      (f) =>
        f.path.startsWith(prefix) &&
        f.path !== schemaPath &&
        !isHiddenContentPath(schema, f.path) &&
        !isImagePath(f.path),
    )
    .map((f) => ({ ...f, entry: f.path.endsWith('.md') ? parseEntryPath(schema, f.path) : null }));
}

/** `undefined` means the file is still loading. */
export type ReadResult = { file: EntryFile } | { issues: Issue[] } | undefined;

export type ProblemFile = { file: string; entry: { collection: string; slug: string } | null; issues: Issue[] };

/**
 * Validates the read candidates against the schema, like `validateProject`. `results[i]` belongs to `candidates[i]`.
 * Files still loading set `pending`; the other files' problems are still returned, sorted by file.
 */
export function entryProblems(
  schema: Schema,
  files: FileRef[],
  candidates: ProblemCandidate[],
  results: ReadResult[],
): { problems: ProblemFile[]; pending: boolean } {
  const entryRefs = new Set(candidates.flatMap((c) => (c.entry ? [refKey(c.entry.collection, c.entry.slug)] : [])));
  const paths = new Set(files.map((f) => f.path));
  const ctx = { entryExists: (ref: string) => entryRefs.has(ref), fileExists: (path: string) => paths.has(path) };
  const problems: ProblemFile[] = [];
  let pending = false;

  candidates.forEach((candidate, i) => {
    const { path, entry } = candidate;
    if (!entry) {
      problems.push({ file: path, entry, issues: [{ file: path, path: '', message: 'Not an entry file' }] });
      return;
    }
    const result = results[i];
    if (!result) {
      pending = true;
      return;
    }
    const issues =
      'issues' in result
        ? result.issues
        : validateEntry(schema, { ...entry, data: result.file.data, body: result.file.body }, ctx);
    if (issues.length > 0) problems.push({ file: path, entry, issues });
  });

  return { problems: problems.toSorted((a, b) => a.file.localeCompare(b.file)), pending };
}
