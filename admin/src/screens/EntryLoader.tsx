import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';

import type { EntryFile } from '../../../core/entryFile';
import { entryFilePath } from '../../../core/paths';
import type { Collection, Schema } from '../../../core/schema';
import { initialData } from '../../../core/validate';
import type { PendingChange } from '../../../github';
import { useChangesStore } from '../changes/store';
import { deriveEntries } from '../changes/useChanges';
import { invalidateFiles, useEntryFile, useSchema, type EntryFileData } from '../data/queries';
import { referencedAssets } from '../entry/changes';
import { pendingCopies, pendingNewEntries } from '../entry/pending';
import { entryToForm, type FormValues } from '../entry/values';
import { useWorkspace } from '../github/workspace';
import { Banner, Button } from '../ui';

type Base = { data: EntryFileData | null; generation: number };

/** What a buffered row of this entry (`changes/store.ts`) makes of the form that opens it. */
type Seed = {
  /** The file the edits were made on (`null` for a new entry), with the sha the row says. */
  base: EntryFileData | null;
  values: FormValues;
  staged: Map<string, Uint8Array>;
  row: PendingChange;
};

/**
 * The seed of the entry at `path` from the rows of the buffer; `null` for no row, a row of a newer Editlet (shown and
 * never touched: `locked`) or a row that does not parse.
 */
function seedOf(
  schema: Schema,
  def: Collection,
  path: string,
  rows: PendingChange[],
): { seed: Seed | null; locked: boolean } {
  const entry = deriveEntries(schema, rows, undefined).find((e) => e.path === path);
  if (!entry) return { seed: null, locked: false };
  if (entry.blocked === 'newer-admin') return { seed: null, locked: true };
  if (!entry.after || (!entry.isNew && !entry.before)) return { seed: null, locked: false };
  const used = referencedAssets(schema, def, path, entry.after.data, entry.after.body);
  const staged = new Map<string, Uint8Array>();
  for (const row of rows)
    if (used.has(row.path) && row.content instanceof Uint8Array) staged.set(row.path, row.content);
  return {
    seed: {
      base: entry.before ? { file: entry.before, sha: entry.row.sha!, keyOrder: Object.keys(entry.before.data) } : null,
      values: entryToForm(def, entry.after),
      staged,
      row: entry.row,
    },
    locked: false,
  };
}

const formKeyOf = (path: string, data: EntryFileData | null, generation: number) =>
  `${path}:${data?.sha ?? 'new'}:${generation}`;

export const shaOf = (d: EntryFileData | null | undefined) => d?.sha ?? null;

/**
 * What a form of one entry gets from `EntryLoader`, per generation (a remount on a rebase, Reload or a clean disk
 * change).
 */
export type LoadedEntry = {
  schema: Schema;
  def: Collection;
  collection: string;
  slug: string;
  path: string;
  /** The saved file, or `null` for a new entry. */
  loaded: EntryFileData | null;
  /** Values the form starts from (the saved file, or the new entry's initial data). */
  initial: EntryFile;
  /**
   * The file is newer than the one the form was opened on (another save), and the form has edits: the CTA compares
   * them field by field (Conflict · compare). `null` when it is not.
   */
  newer: EntryFileData | null;
  /** Values and staged uploads to start from (after a rebase); else the file's own. */
  start?: { values: FormValues; staged: Map<string, Uint8Array> };
  /** The notices around the form: changed on disk (with Reload or Compare), a file error, the schema changed. */
  notices: ReactNode;
  /** The buffered row this form was opened on (an unsaved edit kept across entries, or after a reload). */
  seedRow?: PendingChange;
  /** The buffered row is of a newer Editlet: the form never writes or removes it. */
  rowLocked: boolean;
  /** Discards the form and its buffered row: the latest file and schema, a fresh form. */
  reload(): void;
  /** Starts the form again from its buffered row (*Edited in another tab* › Reload); without a row, `reload()`. */
  reseed(): void;
  /** Set by `reload()` while the old form unmounts: it must not write its edits back into the buffer. */
  discarding: MutableRefObject<boolean>;
  onDirtyChange(dirty: boolean): void;
  /** Called right before a commit: the next disk change is ours and replaces the form. */
  onCommitStart(): void;
  onCommitEnd(ok: boolean): void;
  /** Apply the comparison: the form starts again on `file` from these values and staged uploads. */
  onRebase(file: EntryFileData, values: FormValues, staged: Map<string, Uint8Array>): void;
};

export type EntryLoaderProps = {
  collection: string;
  slug: string;
  /** The form of this generation: remounted (keyed by path, sha and generation) whenever the form starts again. */
  children(entry: LoadedEntry): ReactNode;
  /** Until the schema and the file have loaded, or when either failed before anything loaded. */
  renderFallback(state: { def: Collection | undefined; error: Error | null }): ReactNode;
};

/**
 * Loads one entry for a form: the schema and the file (a missing file is a new, unsaved entry), then renders the form
 * keyed by path + sha + generation. A disk change (of the file or the schema) replaces a clean form; a dirty one keeps
 * its file and schema and gets a "changed on disk" notice + Reload, or *Compare changes* when there is a newer saved
 * file. Its own commit (between `onCommitStart` and the file landing) is adopted, not reported as a change on disk.
 */
export function EntryLoader({ collection, slug, children, renderFallback }: EntryLoaderProps) {
  const schemaQ = useSchema();
  const liveSchema = schemaQ.data?.schema;
  // The schema the form was built with; a dirty form keeps it until Reload.
  const [schema, setSchema] = useState<Schema | undefined>(liveSchema);
  const path = schema ? entryFilePath(schema, collection, slug) : null;
  const fileQ = useEntryFile(path);
  const client = useQueryClient();
  const ref = `${collection}/${slug}`;

  // New-entry values from the New entry dialog: read once, dropped when the screen closes.
  const [pending] = useState(() => pendingNewEntries.get(ref));
  const [copy] = useState(() => pendingCopies.get(ref));
  useEffect(
    () => () => {
      pendingNewEntries.delete(ref);
      pendingCopies.delete(ref);
    },
    [ref],
  );

  // The buffered row of this entry (edits kept across entries): read once the schema is known, before the first form.
  const store = useChangesStore();
  const [seeded, setSeeded] = useState<{ seed: Seed | null; locked: boolean } | undefined>(undefined);
  useEffect(() => {
    if (!store || !schema || !path || seeded !== undefined) return;
    const def = schema.collections[collection];
    if (!def) return;
    let cancelled = false;
    store.read().then(
      (rows) => !cancelled && setSeeded(seedOf(schema, def, path, rows)),
      () => !cancelled && setSeeded({ seed: null, locked: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [store, schema, path, collection, seeded]);
  const discarding = useRef(false);

  const [base, setBase] = useState<Base | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [expectChange, setExpectChange] = useState(false);
  // After Conflict · compare: the form that mounts on the newer file starts from the picks (keyed by that form).
  const [carry, setCarry] = useState<{ key: string; values: FormValues; staged: Map<string, Uint8Array> } | null>(null);
  const workspace = useWorkspace();
  const latest = fileQ.data;

  if (liveSchema && (schema === undefined || (liveSchema !== schema && !dirty))) {
    setSchema(liveSchema);
    if (base !== undefined) setBase({ data: base.data, generation: base.generation + 1 });
  }
  const schemaStale = liveSchema !== undefined && schema !== undefined && liveSchema !== schema;

  // Adopt the loaded file: first load, a disk change while clean, or our own commit landing.
  if (latest !== undefined && seeded !== undefined && path !== null) {
    if (base === undefined) {
      const seed = seeded.seed;
      if (seed) {
        // The edits start on the file they were made on; a different listed file is then `newer` (or changed on disk).
        setBase({ data: seed.base, generation: 0 });
        setDirty(true);
        setCarry({ key: formKeyOf(path, seed.base, 0), values: seed.values, staged: seed.staged });
      } else setBase({ data: latest, generation: 0 });
    } else if (shaOf(latest) !== shaOf(base.data) && (!dirty || expectChange)) {
      setBase({ data: latest, generation: base.generation + 1 });
      setDirty(false);
      setExpectChange(false);
    }
  }
  const stale = base !== undefined && latest !== undefined && shaOf(latest) !== shaOf(base.data);

  const def = schema?.collections[collection];
  const initial = useMemo<EntryFile | undefined>(() => {
    if (!def || base === undefined) return undefined;
    if (base.data) return base.data.file;
    if (copy) return copy;
    return { data: { ...initialData(def), ...pending }, body: '' };
  }, [def, base, pending, copy]);

  const reload = () => {
    discarding.current = true;
    if (liveSchema) setSchema(liveSchema);
    setBase({ data: latest ?? base?.data ?? null, generation: (base?.generation ?? 0) + 1 });
    setDirty(false);
    void invalidateFiles(client);
    if (store && path && schema) {
      // The edits are dropped with the form: the row and the images only it referenced.
      void store
        .removeEntry(path)
        .then(() => store.pruneImages(schema))
        .catch(() => undefined);
    }
  };
  const reseed = () => {
    if (!store || !path || !schema || !def || !base) return reload();
    void store.read().then((rows) => {
      const next = seedOf(schema, def, path, rows).seed;
      if (!next) return reload();
      const generation = base.generation + 1;
      discarding.current = true;
      setCarry({ key: formKeyOf(path, next.base, generation), values: next.values, staged: next.staged });
      setBase({ data: next.base, generation });
      setSeeded({ seed: next, locked: false });
      setDirty(true);
    });
  };

  if (!schema || !def || !path || !base || !initial)
    return renderFallback({ def, error: schemaQ.error ?? fileQ.error });

  // A newer version of a saved file while the form has edits: compare field by field (a deleted file, or a new entry
  // whose path was taken meanwhile, keeps Reload: there is nothing to compare).
  const newer = stale && !expectChange && dirty && base.data && latest ? latest : null;
  const formKey = (data: EntryFileData | null, generation: number) => formKeyOf(path, data, generation);
  const key = formKey(base.data, base.generation);
  const notices = (
    <>
      {fileQ.error ? (
        <Banner tone="danger" role="alert">
          {fileQ.error.message}
        </Banner>
      ) : null}
      {newer ? (
        // FigCraft *Entry · conflict* (GitHub) and *Entry · changed on disk* (dev, which keeps Reload).
        <Banner
          tone="unsaved"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prop of the Banner part (a div), which takes its live role from the caller
          role="status"
          action={
            workspace ? undefined : (
              <Button size="md" onClick={reload}>
                Reload
              </Button>
            )
          }
        >
          {workspace
            ? 'Someone saved this entry on GitHub after you opened it. Your edits are kept.'
            : 'This file changed on disk. Your edits are kept.'}
        </Banner>
      ) : (stale && !expectChange) || schemaStale ? (
        <Banner
          tone="unsaved"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prop of the Banner part (a div), which takes its live role from the caller
          role="status"
          action={
            <Button size="md" onClick={reload}>
              Reload
            </Button>
          }
        >
          {stale && !expectChange ? 'This file changed on disk' : 'The schema changed on disk'}
        </Banner>
      ) : null}
    </>
  );
  const entry: LoadedEntry = {
    schema,
    def,
    collection,
    slug,
    path,
    loaded: base.data,
    initial,
    newer,
    start: carry?.key === key ? carry : undefined,
    seedRow: seeded?.seed?.row,
    rowLocked: seeded?.locked ?? false,
    notices,
    reload,
    reseed,
    discarding,
    onDirtyChange: setDirty,
    onCommitStart: () => setExpectChange(true),
    onCommitEnd: (ok) => {
      if (!ok) setExpectChange(false);
    },
    onRebase: (file, values, staged) => {
      const generation = base.generation + 1;
      setCarry({ key: formKey(file, generation), values, staged });
      setBase({ data: file, generation });
    },
  };
  return <Fragment key={key}>{children(entry)}</Fragment>;
}
