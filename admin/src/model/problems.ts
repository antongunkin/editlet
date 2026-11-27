import type { EntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { isHiddenContentPath, isImagePath, isValidSlug, parseEntryPath, refKey } from '../../../core/paths';
import type { Field, Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import { resolveSummaryImages, type EntrySummary } from '../../../core/summary';
import { validateEntry, type ValidateContext } from '../../../core/validate';

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

/** What the tree answers for `validateEntry`: which entries are listed (hidden ones are not) and which files. */
export function projectContext(files: FileRef[], candidates: ProblemCandidate[]): Required<ValidateContext> {
  const entryRefs = new Set(candidates.flatMap((c) => (c.entry ? [refKey(c.entry.collection, c.entry.slug)] : [])));
  const paths = new Set(files.map((f) => f.path));
  return { entryExists: (ref) => entryRefs.has(ref), fileExists: (path) => paths.has(path) };
}

/**
 * Whether `validateEntry` checks files for what is at `at`: only an `image` field, at any depth, never the body or a
 * Markdown string (its `visitFields` callback tests `field.type === 'image'`). `at` has no block kind, so any kind
 * with an image field there counts.
 */
function mayBeImageField(fields: Record<string, Field>, at: (string | number)[]): boolean {
  const [key, ...rest] = at;
  if (key === undefined || !Object.hasOwn(fields, key)) return false;
  const field = fields[key]!;
  if (rest.length === 0) return field.type === 'image';
  // A list index names no field.
  const inner = typeof rest[0] === 'number' ? rest.slice(1) : rest;
  if (field.type === 'object') return mayBeImageField(field.fields, inner);
  if (field.type !== 'blocks') return false;
  return Object.values(field.blocks).some((block) => mayBeImageField(block.fields, inner));
}

/**
 * Whether the entry at `path` has problems, from its summary: only such a file is read in full and validated. It must
 * never miss one of `validateEntry`'s issues, and flags nothing else:
 * - `issues`: every issue that needs no tree. That includes an image field whose `src` is a URL, absolute or outside
 *   `contentDir` (`resolveAssetPath` gives `null`), is not an image path or is hidden;
 * - the slug rule, which a summary never checks (it is made once per content);
 * - `ctx.entryExists` for each reference;
 * - `ctx.fileExists` for the file of each `image` field. A `null` path never gets that far, and body and Markdown
 *   images are not validated.
 */
export function maybeProblem(
  schema: Schema,
  ctx: Required<ValidateContext>,
  path: string,
  entry: { collection: string; slug: string },
  summary: EntrySummary,
): boolean {
  const collection = schema.collections[entry.collection];
  return (
    summary.issues > 0 ||
    (!collection?.singleton && !isValidSlug(entry.slug)) ||
    summary.refs.some(({ ref }) => !ctx.entryExists(ref)) ||
    resolveSummaryImages(schema, path, summary).some(
      (image) =>
        image.path !== null &&
        !ctx.fileExists(image.path) &&
        mayBeImageField(collection?.fields ?? {}, image.at ?? [image.field]),
    )
  );
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
  const ctx = projectContext(files, candidates);
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
