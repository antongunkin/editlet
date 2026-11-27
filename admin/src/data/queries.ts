import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';

import { batchedReader } from './batchRead';
import { useHeldSummaries, useSummaries, type SummaryRef } from './summaries';

import { decodeUtf8, parseEntryFile, type EntryFile } from '../../../core/entryFile';
import { EditletError, type Issue } from '../../../core/issues';
import { isHiddenContentPath, parseEntryPath } from '../../../core/paths';
import { canReference, findReferrers } from '../../../core/references';
import { parseSchemaText, type Schema } from '../../../core/schema';
import type { ContentSource, FileRef } from '../../../core/source';
import { findReferrersFromSummaries } from '../../../core/summary';
import { useRefreshPullRequestBody } from '../github/style';
import { useWorkspace } from '../github/workspace';
import { LAZY_THRESHOLD } from '../screens/collectionSort';
import { slugOf } from '../screens/listControls';
import { FILES_KEY, filesKey, useSource } from '../source/context';
import type { SourceChange } from '../source/local';
import { LOCAL_GIT_KEY } from '../status/localGit';

/**
 * The common shape of the derived hooks: `data` once loaded, else `isPending` or an `error`. `error` is set only when
 * there is no `data`: a failed refresh keeps the last good `data` (see `useSchema`'s `refreshError`).
 */
export type Loadable<T> = { data: T | undefined; error: Error | null; isPending: boolean };

/** `useSchema` also reports why a later schema read failed while it still serves the last good schema. */
export type SchemaLoadable = Loadable<SchemaData> & { refreshError: Error | null };

export type SchemaData = { schema: Schema; schemaPath: string };

export type EntryFileData = { file: EntryFile; sha: string; keyOrder: string[] };

/**
 * One row of a collection list. `sha` is the listed file's sha: it keys the file's history, like the entry screen's
 * Meta. `title` and `draft` come from the entry's summary: both are `null` until it is there.
 */
export type EntryListItem = { slug: string; path: string; sha: string; title: string | null; draft: boolean | null };

/** A collection's list. `loaded` of `total` counts the summaries asked for (`useEntries`' `want`), failed ones included. */
export type EntryList = Loadable<EntryListItem[]> & { loaded: number; total: number };

/** Thrown by `useCommit` when the source answered with issues (nothing was written). */
export class IssuesError extends Error {
  issues: Issue[];

  constructor(issues: Issue[]) {
    super(issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; '));
    this.name = 'IssuesError';
    this.issues = issues;
  }
}

export { FILES_KEY };

const POLL_MS = 2000;

/**
 * Every file the source lists, keyed `['files', <branch or source kind>]` so a branch switch never serves another
 * branch's list (`FILES_KEY` still invalidates them all). Polls every 2 s in local mode so edits made on disk show up.
 */
export function useFiles() {
  const source = useSource();
  return useQuery({
    queryKey: filesKey(source),
    queryFn: () => source.listFiles(),
    refetchInterval: source.kind === 'local' ? POLL_MS : false,
  });
}

/** Where the schema file is expected (the GitHub source's default too). */
export const DEFAULT_SCHEMA_PATH = 'cms/schema.json';

/** `cms/schema.json` when listed, else the first listed path ending in `schema.json`. */
export function findSchemaRef(files: FileRef[]): FileRef | undefined {
  return files.find((f) => f.path === DEFAULT_SCHEMA_PATH) ?? files.find((f) => f.path.endsWith('schema.json'));
}

/** A file as text. `batched`: through the source's batched reader (entry files: many asked at once, `batchRead.ts`). */
async function readText(source: ContentSource, path: string, batched = false): Promise<string> {
  const bytes = batched ? await batchedReader(source).read(path) : await source.readFile(path);
  const decoded = decodeUtf8(bytes, path);
  if ('issue' in decoded) throw new EditletError([decoded.issue]);
  return decoded.text;
}

export function entryFileQuery(source: ContentSource, ref: FileRef | undefined) {
  return {
    queryKey: ['file', ref?.path ?? null, ref?.sha ?? null] as const,
    enabled: ref !== undefined,
    staleTime: Infinity,
    queryFn: async (): Promise<EntryFileData> => {
      const { path, sha } = ref!;
      const text = await readText(source, path, true);
      let file: EntryFile;
      try {
        file = parseEntryFile(text);
      } catch (error) {
        if (error instanceof EditletError) throw new EditletError(error.issues.map((i) => ({ ...i, file: path })));
        throw error;
      }
      return { file, sha, keyOrder: Object.keys(file.data) };
    },
  };
}

/** The last schema that loaded, per query client: served while a later schema read fails. */
const lastGoodSchema = new WeakMap<QueryClient, SchemaData>();

/**
 * The parsed schema, keyed by the schema file's sha. While a new sha loads, the previous schema is kept. A missing or
 * broken schema file is an `error` before any schema loaded, and a `refreshError` (with the last good schema) after.
 */
export function useSchema(): SchemaLoadable {
  const source = useSource();
  const client = useQueryClient();
  const files = useFiles();
  const ref = files.data ? findSchemaRef(files.data) : undefined;
  const query = useQuery({
    queryKey: ['schema', ref?.sha ?? null],
    enabled: ref !== undefined,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SchemaData> => {
      const { path } = ref!;
      return { schema: parseSchemaText(await readText(source, path), path), schemaPath: path };
    },
  });
  if (!files.data) {
    return { data: undefined, error: files.error, isPending: !files.error, refreshError: null };
  }
  let failure: Error | null = query.error;
  if (!ref) failure = new EditletError([{ file: DEFAULT_SCHEMA_PATH, path: '', message: 'No schema.json found' }]);
  if (!failure && query.data) {
    if (!query.isPlaceholderData) lastGoodSchema.set(client, query.data);
    return { data: query.data, error: null, isPending: false, refreshError: null };
  }
  const last = lastGoodSchema.get(client);
  if (failure) {
    return last
      ? { data: last, error: null, isPending: false, refreshError: failure }
      : { data: undefined, error: failure, isPending: false, refreshError: null };
  }
  return { data: last, error: null, isPending: last === undefined, refreshError: null };
}

/** One entry file, keyed by sha. `data` is `null` when the path is not listed (a new, unsaved entry). */
export function useEntryFile(path: string | null): Loadable<EntryFileData | null> {
  const source = useSource();
  const files = useFiles();
  const ref = path === null ? undefined : files.data?.find((f) => f.path === path);
  const query = useQuery(entryFileQuery(source, ref));
  if (path === null) return { data: null, error: null, isPending: false };
  if (!files.data) return { data: undefined, error: files.error, isPending: !files.error };
  if (!ref) return { data: null, error: null, isPending: false };
  return { data: query.data, error: query.data ? null : query.error, isPending: query.isPending };
}

/** A listed entry file with its slug, as `entryRefs` gives it. */
export type EntryRef = FileRef & { slug: string };

/** Each file list grouped by collection, per schema: both are compared by identity, so neither may change in place. */
const grouped = new WeakMap<FileRef[], WeakMap<Schema, Map<string, EntryRef[]>>>();
const NO_REFS: readonly EntryRef[] = [];

function groupEntries(schema: Schema, files: FileRef[]): Map<string, EntryRef[]> {
  const byCollection = new Map<string, EntryRef[]>();
  for (const ref of files) {
    if (isHiddenContentPath(schema, ref.path)) continue;
    const parsed = parseEntryPath(schema, ref.path);
    if (!parsed) continue;
    let refs = byCollection.get(parsed.collection);
    if (!refs) byCollection.set(parsed.collection, (refs = []));
    refs.push({ ...ref, slug: parsed.slug });
  }
  return byCollection;
}

/**
 * Listed entry files of a collection (hidden paths skipped), in the order of `files`, without reading them. The first
 * call for a file list and a schema groups every collection in one pass; later calls return the same arrays.
 */
export function entryRefs(schema: Schema, files: FileRef[], collection: string): readonly EntryRef[] {
  let bySchema = grouped.get(files);
  if (!bySchema) grouped.set(files, (bySchema = new WeakMap()));
  let byCollection = bySchema.get(schema);
  if (!byCollection) bySchema.set(schema, (byCollection = groupEntries(schema, files)));
  return byCollection.get(collection) ?? NO_REFS;
}

/** The listed entry files of `collection`, from the tree alone: the same array until the files or the schema change. */
export function useCollectionRefs(collection: string): SummaryRef[] {
  const files = useFiles().data;
  const schema = useSchema().data?.schema;
  return useMemo(
    () => (schema && files ? entryRefs(schema, files, collection).map((ref) => ({ ...ref, collection })) : []),
    [schema, files, collection],
  );
}

/**
 * Every listed entry of `collection`, as soon as the files and the schema are there, with its title (`titleField` value,
 * else the slug) and draft flag, sorted by title (the slug until it is known). Both come from entry summaries
 * (`summaries.ts`: no parsed file is kept); `want` names the paths whose summaries to load. An entry that is not in it
 * has them only when the session already holds its summary.
 */
export function useEntries(collection: string, want: 'all' | ReadonlySet<string>): EntryList {
  const files = useFiles();
  const schema = useSchema();
  const refs = useCollectionRefs(collection);
  // By content: a caller makes a new set at every render.
  const wanted = want === 'all' ? null : [...want].toSorted().join('\n');
  const asked = useMemo(() => {
    if (wanted === null) return refs;
    const paths = new Set(wanted.split('\n'));
    return refs.filter((ref) => paths.has(ref.path));
  }, [refs, wanted]);
  const summaries = useSummaries(asked);
  const held = useHeldSummaries(refs);
  const items = useMemo(() => {
    const at = new Map(asked.map((ref, i) => [ref.path, i]));
    const list = refs.map((ref, i): EntryListItem => {
      const j = at.get(ref.path);
      const summary = held[i] ?? (j === undefined ? undefined : summaries.rows[j]);
      // A file that does not load or parse has none: it is listed under its slug, as no draft.
      const failed = j !== undefined && summaries.errors[j] !== null;
      const known = summary !== undefined || failed;
      return {
        slug: ref.slug,
        path: ref.path,
        sha: ref.sha,
        title: known ? (summary?.title ?? ref.slug) : null,
        draft: known ? summary?.draft === true : null,
      };
    });
    return list.toSorted(
      (a, b) => (a.title ?? a.slug).localeCompare(b.title ?? b.slug) || a.slug.localeCompare(b.slug),
    );
  }, [refs, asked, summaries, held]);

  const error = (files.data ? null : files.error) ?? schema.error;
  const pending = !error && (!schema.data || !files.data);
  const { loaded, total } = summaries;
  return { data: error || pending ? undefined : items, error, isPending: pending, loaded, total };
}

/**
 * An option of a reference picker. `title` is `null` until the entry's summary is there; a file that does not load or
 * parse has its slug.
 */
export type EntryOption = { ref: string; title: string | null };

export type EntryOptions = {
  options: EntryOption[];
  /** Of the summaries asked for, how many have settled, failed ones included. */
  loaded: number;
  total: number;
  /** `LAZY_THRESHOLD` entries or more: only `want`'s summaries are read, and the order is by slug. */
  lazy: boolean;
  /** Summaries asked for, or the file list or the schema, still load. */
  pending: boolean;
};

/** Options by collection, in `collections`' order, then by title (the slug until it is there). */
export function byTitle(collections: readonly string[]) {
  const rank = (ref: string) => collections.indexOf(ref.slice(0, ref.indexOf('/')));
  return (a: EntryOption, b: EntryOption) =>
    rank(a.ref) - rank(b.ref) ||
    (a.title ?? slugOf(a.ref)).localeCompare(b.title ?? slugOf(b.ref)) ||
    a.ref.localeCompare(b.ref);
}

/**
 * Every listed entry of `collections` as `{ ref: '<collection>/<slug>', title }` for reference pickers, as soon as the
 * files and the schema are there. Under `LAZY_THRESHOLD` entries every one is summarized and they sort by collection,
 * then title; `want` is not read. From it, only the refs in `want` are summarized (an entry not in it has a title only
 * when the session already holds its summary), and they sort by collection, then slug, so that a title that loads late
 * moves no row. `want` must keep its identity until it changes.
 */
export function useEntryOptions(collections: string[], want: 'all' | ReadonlySet<string>): EntryOptions {
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const key = collections.join('\0');
  const refs = useMemo(() => {
    if (!schema || !files.data) return [];
    const lists = key
      .split('\0')
      .filter((c) => c !== '' && Object.hasOwn(schema.collections, c))
      .map((c) => entryRefs(schema, files.data, c).map((ref) => ({ ...ref, collection: c })));
    const large = lists.reduce((n, list) => n + list.length, 0) >= LAZY_THRESHOLD;
    return lists.flatMap((list) => (large ? list.toSorted((a, b) => a.slug.localeCompare(b.slug)) : list));
  }, [schema, files.data, key]);
  const lazy = refs.length >= LAZY_THRESHOLD;
  const asked = useMemo(
    () => (!lazy || want === 'all' ? refs : refs.filter((r) => want.has(`${r.collection}/${r.slug}`))),
    [refs, lazy, want],
  );
  const summaries = useSummaries(asked);
  const held = useHeldSummaries(refs);
  const options = useMemo(() => {
    const at = new Map(asked.map((ref, i) => [ref.path, i]));
    const list = refs.map((ref, i): EntryOption => {
      const j = at.get(ref.path);
      const summary = held[i] ?? (j === undefined ? undefined : summaries.rows[j]);
      const failed = j !== undefined && summaries.errors[j] !== null;
      return {
        ref: `${ref.collection}/${ref.slug}`,
        title: summary || failed ? (summary?.title ?? ref.slug) : null,
      };
    });
    return lazy ? list : list.toSorted(byTitle(key.split('\0')));
  }, [refs, asked, summaries, held, lazy, key]);

  const { loaded, total } = summaries;
  const pending = loaded < total || (key !== '' && (!schema || !files.data));
  return { options, loaded, total, lazy, pending };
}

/**
 * The titles of the entries `values` (`<collection>/<slug>`) name, by ref, summarizing those only: what a form's chosen
 * references need before any picker opens. The slug until the summary is there; a ref no listed file has is not in the
 * map. The same map until a title changes.
 */
export function useEntryTitles(values: string[]): Map<string, string> {
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const key = [...new Set(values)].toSorted().join('\0');
  const refs = useMemo(() => {
    if (!schema || !files.data) return [];
    const named = new Set(key.split('\0'));
    return [...new Set([...named].map((r) => r.slice(0, r.indexOf('/'))))]
      .filter((c) => Object.hasOwn(schema.collections, c))
      .flatMap((c) => entryRefs(schema, files.data, c).map((ref) => ({ ...ref, collection: c })))
      .filter((r) => named.has(`${r.collection}/${r.slug}`));
  }, [schema, files.data, key]);
  const { rows } = useSummaries(refs);
  return useMemo(
    () => new Map(refs.map((ref, i) => [`${ref.collection}/${ref.slug}`, rows[i]?.title ?? ref.slug])),
    [refs, rows],
  );
}

/** A saved entry file with what a rename or delete plan needs (`core/rename.ts`) and what a commit needs back. */
export type PlanFile = {
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
  path: string;
  sha: string;
  keyOrder: string[];
};

export type ReferrerItem = { ref: string; title: string; fields: string[]; entry: PlanFile };

/**
 * Saved entries with a reference field pointing at `ref` (the entry's "Used by"), sorted by title. They are found in the
 * summaries of the collections with a reference field that allows `ref`'s collection; only the files of the entries that
 * do point are read in full, for the rename and delete plans (`entry`). `data` waits for both.
 */
export function useReferrers(ref: string): Loadable<ReferrerItem[]> {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema();
  const target = ref.slice(0, ref.indexOf('/'));
  const refs = useMemo(() => {
    if (!schema.data || !files.data) return [];
    const s = schema.data.schema;
    return Object.entries(s.collections)
      .filter(([, def]) => canReference(def, target))
      .flatMap(([c]) => entryRefs(s, files.data, c).map((r) => ({ ...r, collection: c })));
  }, [schema.data, files.data, target]);
  const summaries = useSummaries(refs);
  const settled = summaries.loaded === summaries.total;
  // The entries that point, once every candidate has settled: their files are then asked for in one batch.
  const matched = useMemo(() => {
    if (!schema.data || !settled) return [];
    const rows = refs.flatMap((r, i) => {
      const summary = summaries.rows[i];
      return summary ? [{ ...r, summary }] : [];
    });
    return findReferrersFromSummaries(schema.data.schema, rows, ref).map(({ entry }) => entry);
  }, [schema.data, settled, refs, summaries, ref]);
  const results = useQueries({ queries: matched.map((r) => entryFileQuery(source, r)) });

  const error =
    (files.data ? null : files.error) ??
    schema.error ??
    summaries.errors.find((e) => e !== null) ??
    results.find((r) => r.error)?.error ??
    null;
  if (error) return { data: undefined, error, isPending: false };
  if (!schema.data || !files.data || !settled || results.some((r) => r.isPending)) {
    return { data: undefined, error: null, isPending: true };
  }
  const s = schema.data.schema;
  const entries = matched.map((r, i): PlanFile => {
    const { file, sha, keyOrder } = results[i]!.data!;
    return { collection: r.collection, slug: r.slug, data: file.data, body: file.body, path: r.path, sha, keyOrder };
  });
  const items = findReferrers(s, entries, ref).map(({ entry, fields }): ReferrerItem => {
    const titleField = s.collections[entry.collection]?.titleField;
    const raw = titleField === undefined ? undefined : entry.data[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : entry.slug;
    return { ref: `${entry.collection}/${entry.slug}`, title, fields, entry };
  });
  items.sort((a, b) => a.title.localeCompare(b.title) || a.ref.localeCompare(b.ref));
  return { data: items, error: null, isPending: false };
}

export type CommitInput = {
  changes: SourceChange[];
  message: string;
  /**
   * Create this new branch (`<prefix><name>`) from the base branch, switch to it (keeping the open screen), and commit
   * there (GitHub workspace only).
   */
  newBranch?: string;
};

/**
 * After a write: the file lists, and in dev mode the dev server's git state (`['local-git']`, a no-op in GitHub mode),
 * so the *Changed* statuses follow a save at once instead of on the next 3 s poll.
 */
export function invalidateFiles(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: FILES_KEY }),
    client.invalidateQueries({ queryKey: LOCAL_GIT_KEY }),
  ]).then(() => undefined);
}

/**
 * Commits through the source (or a new branch, see `CommitInput.newBranch`); rejects with `IssuesError` when the
 * source returned issues. Refreshes `['files']`, and in GitHub mode the Editlet part of the branch's open pull request.
 */
export function useCommit() {
  const source = useSource();
  const workspace = useWorkspace();
  const client = useQueryClient();
  const schema = useSchema().data?.schema ?? null;
  const refreshPullRequest = useRefreshPullRequestBody();
  return useMutation({
    mutationFn: async ({ changes, message, newBranch }: CommitInput) => {
      if (newBranch && !workspace) throw new Error('A new branch needs the GitHub workspace');
      const target: ContentSource = newBranch ? await workspace!.createBranch(newBranch, { keepScreen: true }) : source;
      const { issues } = await target.commit(changes, message);
      if (issues.length > 0) throw new IssuesError(issues);
      return target;
    },
    onSuccess: (target) => {
      refreshPullRequest(target, schema);
      return invalidateFiles(client);
    },
  });
}
