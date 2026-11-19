import { entryDiff, formKeyOf, type FieldDiffRow } from './diff';
import { entryToForm, EXTRA_KEY, formToEntry, type DataBody, type FormValues } from './values';

import type { EntryFile } from '../../../core/entryFile';
import type { Collection } from '../../../core/schema';

// Conflict: compare and pick per field (spec 2026-11-19-admin-conflict-compare.md). Three versions: the file the form
// was opened on (base), the newer file (theirs) and the form (yours).

/** A field the other save changed and that ends different on the two sides: the editor picks one. */
export interface ConflictField {
  key: string;
  label: string;
  type: FieldDiffRow['type'];
  /** Display text of the newer file's value (`valueText`). */
  theirs: string;
  /** Display text of the form's value. */
  yours: string;
  /** You changed it too: *Yours* is the default pick, else the newer version is. */
  yoursChanged: boolean;
}

export type ConflictPick = 'theirs' | 'yours';

/**
 * The newer file as the form would write it (`formToEntry(entryToForm(...))`): `draft: false`, `''`, `[]` and the like
 * are dropped as the other two sides drop them, so they are no change.
 */
function normalised(def: Collection, file: DataBody): DataBody {
  const { data, body } = formToEntry(def, entryToForm(def, file));
  return { data, body };
}

/** The fields to pick: changed by the other save, and different from yours. */
export function conflictFields(def: Collection, base: DataBody, raw: DataBody, yours: DataBody): ConflictField[] {
  const theirs = normalised(def, raw);
  const differ = new Map(entryDiff(def, theirs, yours).map((r) => [r.key, r]));
  const mine = new Set(entryDiff(def, base, yours).map((r) => r.key));
  return entryDiff(def, base, theirs).flatMap((r) => {
    const other = differ.get(r.key);
    if (!other) return [];
    return [
      { key: r.key, label: r.label, type: r.type, theirs: r.after, yours: other.after, yoursChanged: mine.has(r.key) },
    ];
  });
}

/** The default picks: yours where you changed the field, the newer version where you did not. */
export function defaultPicks(fields: ConflictField[]): Record<string, ConflictPick> {
  return Object.fromEntries(fields.map((f) => [f.key, f.yoursChanged ? 'yours' : 'theirs']));
}

/**
 * The form values to start from on the newer file: its values, then each field you changed (unless you picked the
 * newer version) and each conflict field you picked as yours, from the form. Keys outside the schema come from the
 * newer file (the form does not edit them).
 */
export function mergeConflict(
  def: Collection,
  base: DataBody,
  theirs: EntryFile,
  yours: DataBody,
  yoursValues: FormValues,
  picks: Record<string, ConflictPick>,
): FormValues {
  const merged = entryToForm(def, theirs);
  const fields = conflictFields(def, base, theirs, yours);
  const conflicts = new Map(fields.map((f) => [f.key, picks[f.key] ?? defaultPicks([f])[f.key]!]));
  const keys = new Set([...entryDiff(def, base, yours).map((r) => r.key), ...conflicts.keys()]);
  const extra = { ...(merged[EXTRA_KEY] as Record<string, unknown>) };
  const yoursExtra = (yoursValues[EXTRA_KEY] ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    if ((conflicts.get(key) ?? 'yours') !== 'yours') continue;
    const formKey = formKeyOf(def, key);
    if (formKey !== null) merged[formKey] = yoursValues[formKey];
    // A frontmatter key outside the schema: the form carries it in `__extra`.
    else if (Object.hasOwn(yoursExtra, key)) extra[key] = yoursExtra[key];
    else delete extra[key];
  }
  merged[EXTRA_KEY] = extra;
  return merged;
}
