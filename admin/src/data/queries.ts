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

import { decodeUtf8, parseEntryFile, type EntryFile } from '../../../core/entryFile';
import { EditletError, type Issue } from '../../../core/issues';
import { isHiddenContentPath, parseEntryPath } from '../../../core/paths';
import { canReference, findReferrers } from '../../../core/references';
import { parseSchemaText, type Schema } from '../../../core/schema';
import type { ContentSource, FileRef } from '../../../core/source';
import { useRefreshPullRequestBody } from '../github/style';
import { useWorkspace } from '../github/workspace';
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

/** One row of a collection list. `sha` is the listed file's sha: it keys the file's history, like the entry screen's Meta. */
export type EntryListItem = { slug: string; path: string; sha: string; title: string; draft: boolean };

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

/** Listed entry files of a collection (hidden paths skipped), without reading them. */
export function entryRefs(schema: Schema, files: FileRef[], collection: string): (FileRef & { slug: string })[] {
  const out: (FileRef & { slug: string })[] = [];
  for (const ref of files) {
    if (isHiddenContentPath(schema, ref.path)) continue;
    const parsed = parseEntryPath(schema, ref.path);
    if (parsed?.collection === collection) out.push({ ...ref, slug: parsed.slug });
  }
  return out;
}

/** Entries of `collection` with their title (`titleField` value, else the slug) and draft flag, sorted by title. */
export function useEntries(collection: string): Loadable<EntryListItem[]> {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema();
  const refs = useMemo(
    () => (schema.data && files.data ? entryRefs(schema.data.schema, files.data, collection) : []),
    [schema.data, files.data, collection],
  );
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)) });

  const error = (files.data ? null : files.error) ?? schema.error;
  if (error) return { data: undefined, error, isPending: false };
  if (!schema.data || !files.data || results.some((r) => r.isPending)) {
    return { data: undefined, error: null, isPending: true };
  }
  const titleField = schema.data.schema.collections[collection]?.titleField;
  const items = refs.map((ref, i): EntryListItem => {
    const data = results[i]?.data?.file.data;
    const raw = titleField === undefined ? undefined : data?.[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : ref.slug;
    return { slug: ref.slug, path: ref.path, sha: ref.sha, title, draft: data?.draft === true };
  });
  items.sort((a, b) => a.title.localeCompare(b.title) || a.slug.localeCompare(b.slug));
  return { data: items, error: null, isPending: false };
}

export type EntryOption = { ref: string; title: string };

/**
 * Entries of `collections` as `{ ref: '<collection>/<slug>', title }` for reference pickers, in collection order and
 * sorted by title within one. Titles fall back to the slug (also while the entry files are still loading).
 */
export function useEntryOptions(collections: string[]): EntryOption[] {
  const source = useSource();
  const files = useFiles();
  const schema = useSchema();
  const key = collections.join('\0');
  const refs = useMemo(() => {
    if (!schema.data || !files.data) return [];
    const s = schema.data.schema;
    return key
      .split('\0')
      .filter((c) => c !== '' && Object.hasOwn(s.collections, c))
      .flatMap((c) => entryRefs(s, files.data, c).map((ref) => ({ ...ref, collection: c })));
  }, [schema.data, files.data, key]);
  const results = useQueries({ queries: refs.map((ref) => entryFileQuery(source, ref)) });
  const collectionsDef = schema.data?.schema.collections;
  const options = refs.map((ref, i) => {
    const titleField = collectionsDef?.[ref.collection]?.titleField;
    const raw = titleField === undefined ? undefined : results[i]?.data?.file.data[titleField];
    const title = typeof raw === 'string' && raw.trim() !== '' ? raw : ref.slug;
    return { collection: ref.collection, ref: `${ref.collection}/${ref.slug}`, title };
  });
  const order = new Map(refs.map((r, i) => [r.collection, i]));
  options.sort(
    (a, b) =>
      (order.get(a.collection) ?? 0) - (order.get(b.collection) ?? 0) ||
      a.title.localeCompare(b.title) ||
      a.ref.localeCompare(b.ref),
  );
  return options.map(({ ref, title }) => ({ ref, title }));
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
 * Saved entries with a reference field pointing at `ref` (the entry's "Used by"), sorted by title. Only collections
 * with a reference field that allows `ref`'s collection are read. `data` waits for every file of those collections.
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
  const results = useQueries({ queries: refs.map((r) => entryFileQuery(source, r)) });

  const error = (files.data ? null : files.error) ?? schema.error ?? results.find((r) => r.error)?.error ?? null;
  if (error) return { data: undefined, error, isPending: false };
  if (!schema.data || !files.data || results.some((r) => r.isPending)) {
    return { data: undefined, error: null, isPending: true };
  }
  const s = schema.data.schema;
  const entries = refs.map((r, i): PlanFile => {
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
