import { serializeEntry } from './values';

import type { Issue } from '../../../core/issues';
import type { RemovePlan, RenamePlan } from '../../../core/rename';
import type { Schema } from '../../../core/schema';
import { validateEntry } from '../../../core/validate';
import type { PlanFile } from '../data/queries';
import type { SourceChange } from '../source/local';

/** The rewritten entries of a plan as file changes: the old sha when the file stays, `null` for a new path. */
function writes(schema: Schema, plan: RenamePlan<PlanFile> | RemovePlan<PlanFile>): SourceChange[] {
  return plan.write.map((w) => ({
    path: w.path,
    content: serializeEntry(schema.collections[w.entry.collection]!, w.data, w.body, w.entry.keyOrder),
    sha: w.path === w.entry.path ? w.entry.sha : null,
  }));
}

/**
 * One commit for a rename: the entry at its new path, every rewritten entry, the old entry file deleted, and each file
 * of the entry's folder written at its new path (bytes from `readFile`) and deleted at the old one. `shaOf` gives
 * the listed sha of an existing path (the moved files, the old entry).
 */
export async function renameChanges(
  schema: Schema,
  plan: RenamePlan<PlanFile>,
  readFile: (path: string) => Promise<Uint8Array>,
  shaOf: (path: string) => string | null,
): Promise<SourceChange[]> {
  const moved: SourceChange[] = [];
  for (const { from, to } of plan.move) {
    moved.push({ path: to, content: await readFile(from), sha: null }, { path: from, content: null, sha: shaOf(from) });
  }
  return [...writes(schema, plan), ...plan.remove.map((path) => ({ path, content: null, sha: shaOf(path) })), ...moved];
}

/** One commit for a delete with references removed: the entry file deleted and every rewritten entry. */
export function removeChanges(
  schema: Schema,
  plan: RemovePlan<PlanFile>,
  shaOf: (path: string) => string | null,
): SourceChange[] {
  return [...plan.remove.map((path) => ({ path, content: null, sha: shaOf(path) })), ...writes(schema, plan)];
}

/**
 * Schema issues of the entries a delete would rewrite (a required reference, a list below `min`): the delete waits
 * until a human fixes those entries. Each issue names the entry (`page/landing: content.3.survey — Required`).
 */
export function removeIssues(schema: Schema, plan: RemovePlan<PlanFile>): string[] {
  return plan.write.flatMap(({ entry, data, body }) =>
    validateEntry(schema, { collection: entry.collection, slug: entry.slug, data, body }).map(
      (i: Issue) => `${entry.collection}/${entry.slug}: ${i.path ? `${i.path} — ` : ''}${i.message}`,
    ),
  );
}
