import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';

import { onChanges, useChangesStore, type ChangesStore } from './store';

import { parseEntryFile, type EntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { isImagePath, parseEntryPath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';
import { validateEntry } from '../../../core/validate';
import type { PendingChange } from '../../../github';
import { useFiles, useSchema } from '../data/queries';
import { entryDiff, type FieldDiffRow } from '../entry/diff';
import { itemTitle } from '../entry/summary';

/** The row formats this admin reads and writes (`PendingChange.v`, absent = 1). */
export const CHANGES_FORMAT = 1;

/**
 * Why a buffered entry cannot be saved as it is: the file changed since (`conflict`), a new entry's address is taken
 * now (`taken`), the file was deleted (`deleted`), validation (`problems`), a row of a newer Editlet (`newer-admin`).
 */
export type ChangeBlock = 'conflict' | 'taken' | 'deleted' | 'problems' | 'newer-admin';

/** One buffered entry, derived from its row against its `base`, the listing and the schema. */
export interface ChangedEntry {
  ref: string;
  path: string;
  collection: string;
  slug: string;
  /** The title the editor would see on opening it (the unsaved one), else the slug. */
  title: string;
  /** The field diff of the row against its base (a new entry: its filled fields). */
  rows: FieldDiffRow[];
  isNew: boolean;
  revertable: boolean;
  blocked: ChangeBlock | null;
  issues: Issue[];
  /** The parsed row (`null` when it does not parse or is of a newer format) and its parsed base. */
  after: EntryFile | null;
  before: EntryFile | null;
  row: PendingChange;
}

export interface Changes {
  /** The store of the active scope; `null` while it is not known (dev mode before the dev server's git state). */
  store: ChangesStore | null;
  /** The rows are loaded (and the schema, for the entries). */
  ready: boolean;
  /** Every row of the scope, by path. */
  rows: PendingChange[];
  /** The entry rows, derived (sorted by path). */
  entries: ChangedEntry[];
  /** The image rows (staged uploads), whether referenced or not. */
  images: PendingChange[];
  /** The diff rows of every entry (*Unsaved changes (n)*, *Save n changes*). */
  count: number;
  /** The buffered entry of a path. */
  of(path: string): ChangedEntry | undefined;
}

export const changesKey = (scope: string | null) => ['changes', scope] as const;

const titleOf = (schema: Schema, collection: string, slug: string, data: Record<string, unknown>) => {
  const def = schema.collections[collection];
  const value = def?.titleField ? data[def.titleField] : def ? itemTitle(def.fields, data) : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : slug;
};

const parse = (text: string | null | undefined): EntryFile | null => {
  if (typeof text !== 'string') return null;
  try {
    return parseEntryFile(text);
  } catch {
    return null;
  }
};

/**
 * The buffered entries of a scope (pure): each row's diff from its `base`, and what blocks it against the listing
 * (`files`, `undefined` while it loads: then nothing is a conflict). Validation counts the buffered new entries and
 * image rows as existing, as core's batch validation does at save.
 */
export function deriveEntries(schema: Schema, rows: PendingChange[], files: FileRef[] | undefined): ChangedEntry[] {
  const listed = new Map((files ?? []).map((f) => [f.path, f.sha]));
  const refs = new Set<string>();
  for (const path of [...listed.keys(), ...rows.map((r) => r.path)]) {
    const at = parseEntryPath(schema, path);
    if (at) refs.add(`${at.collection}/${at.slug}`);
  }
  const buffered = new Set(rows.map((r) => r.path));
  const out: ChangedEntry[] = [];
  for (const row of rows) {
    const at = parseEntryPath(schema, row.path);
    if (!at) continue;
    const def = schema.collections[at.collection]!;
    const { collection, slug } = at;
    const ref = `${collection}/${slug}`;
    const newer = (row.v ?? 1) > CHANGES_FORMAT;
    const after = newer ? null : parse(typeof row.content === 'string' ? row.content : null);
    const before = parse(row.base);
    const isNew = row.sha === null;
    const issues: Issue[] =
      after === null
        ? newer
          ? []
          : [{ path: '', message: 'The unsaved file does not parse' }]
        : validateEntry(
            schema,
            { collection, slug, data: after.data, body: after.body },
            { entryExists: (r) => refs.has(r), fileExists: (p) => listed.has(p) || buffered.has(p) },
          );
    const sha = listed.get(row.path);
    const blocked: ChangeBlock | null = newer
      ? 'newer-admin'
      : files !== undefined && isNew && sha !== undefined
        ? 'taken'
        : files !== undefined && !isNew && sha === undefined
          ? 'deleted'
          : files !== undefined && !isNew && sha !== row.sha
            ? 'conflict'
            : issues.length > 0
              ? 'problems'
              : null;
    out.push({
      ref,
      path: row.path,
      collection,
      slug,
      title: titleOf(schema, collection, slug, (after ?? before)?.data ?? {}),
      rows: after ? entryDiff(def, before, after) : [],
      isNew,
      revertable: !isNew && !newer,
      blocked,
      issues,
      after,
      before,
      row,
    });
  }
  return out;
}

/**
 * Every unsaved change of the active scope (*Your changes* across entries, the status line's count, the collection's
 * *Unsaved* rows): the store's rows, re-read on every store write in this tab or another (`BroadcastChannel`) and on
 * focus.
 */
export function useChanges(): Changes {
  const store = useChangesStore();
  const scope = store?.scope ?? null;
  const client = useQueryClient();
  const rowsQ = useQuery({
    queryKey: changesKey(scope),
    queryFn: () => store!.queue.list(),
    enabled: store !== null,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (scope === null) return;
    return onChanges((message) => {
      if (message.scope === scope) void client.invalidateQueries({ queryKey: changesKey(scope) });
    });
  }, [scope, client]);
  const schema = useSchema().data?.schema;
  const files = useFiles().data;
  const rows = rowsQ.data;
  return useMemo(() => {
    const list = rows ?? [];
    const entries = schema ? deriveEntries(schema, list, files) : [];
    const byPath = new Map(entries.map((e) => [e.path, e]));
    return {
      store,
      // A failed read (blocked IndexedDB) is ready with no rows: the form's own write banner tells the editor.
      ready: (rows !== undefined || rowsQ.isError) && schema !== undefined,
      rows: list,
      entries,
      images: schema ? list.filter((r) => isImagePath(r.path) && !parseEntryPath(schema, r.path)) : [],
      count: entries.reduce((n, e) => n + e.rows.length, 0),
      of: (path: string) => byPath.get(path),
    };
  }, [store, rows, rowsQ.isError, schema, files]);
}
