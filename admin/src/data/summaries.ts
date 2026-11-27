// Entry summaries for the admin's lists (docs/core/summary.md): what a list knows about an entry, kept by blob sha and
// schema fingerprint, so a list does not parse and keep full files. The one place that loads them.

import {
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
  type Query,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { BATCH_LIMIT, batchedReader } from './batchRead';
import { entryFileQuery, useSchema, type EntryFileData } from './queries';

import { decodeUtf8, parseEntryFile, type EntryFile } from '../../../core/entryFile';
import { EditletError } from '../../../core/issues';
import type { Schema } from '../../../core/schema';
import { gitBlobSha } from '../../../core/sha';
import type { ContentSource, FileRef } from '../../../core/source';
import { summarizeEntry, summaryFingerprint, type EntrySummary } from '../../../core/summary';
import type { GitHubCache } from '../../../github';
import { useWorkspace } from '../github/workspace';
import { useSource } from '../source/context';
import { fnv1a } from '../status/lastCommits';

/** A listed entry file to summarize, as `entryRefs` gives it plus its collection. */
export type SummaryRef = FileRef & { collection: string; slug: string };

/** `summaryFingerprint` of every collection of one schema, by collection key. */
export type Fingerprints = Map<string, string>;

export interface Summaries {
  /** The summary of each ref, in the order of the refs; `undefined` while it loads and when it failed. */
  rows: (EntrySummary | undefined)[];
  /** Why each ref has no summary (a file that does not parse, a failed read), in the same order; else `null`. */
  errors: (Error | null)[];
  /** Refs that have settled, failed ones included: a loading line shows while `loaded < total`. */
  loaded: number;
  total: number;
  /** Refs that have an error. */
  failed: number;
}

const schemaIds = new WeakMap<Schema, number>();
let lastSchemaId = 0;

/** A number per schema object, for a query key: another object gets other fingerprints. */
function schemaId(schema: Schema): number {
  let id = schemaIds.get(schema);
  if (id === undefined) schemaIds.set(schema, (id = ++lastSchemaId));
  return id;
}

/**
 * The query of `schema`'s fingerprints, keyed by the schema object (`useSchema` keeps one per schema file sha). For code
 * outside React: `client.fetchQuery(fingerprintsQuery(schema))`.
 */
export function fingerprintsQuery(schema: Schema) {
  return {
    queryKey: ['summary-fingerprints', schemaId(schema)] as const,
    staleTime: Infinity,
    queryFn: async (): Promise<Fingerprints> =>
      new Map(
        await Promise.all(
          Object.keys(schema.collections).map(async (c) => [c, await summaryFingerprint(schema, c)] as const),
        ),
      ),
  };
}

/** The fingerprints of every collection of `schema`; `undefined` without a schema and until they are computed. */
export function useFingerprints(schema: Schema | undefined): Fingerprints | undefined {
  return useQuery<Fingerprints>(
    schema ? fingerprintsQuery(schema) : { queryKey: ['summary-fingerprints', null], queryFn: skipToken },
  ).data;
}

/** Gathers what is pushed in one task and hands it to `flush` in a microtask (as `batchRead.ts` does). */
function microBatch<T>(flush: (batch: T[]) => void): (item: T) => void {
  let queue: T[] = [];
  return (item) => {
    if (queue.length === 0) {
      queueMicrotask(() => {
        const batch = queue;
        queue = [];
        flush(batch);
      });
    }
    queue.push(item);
  };
}

interface Wanted {
  sha: string;
  fp: string;
  resolve(summary: EntrySummary | undefined): void;
}

interface Made {
  sha: string;
  fp: string;
  summary: EntrySummary;
  /** What the summary was made from. */
  bytes: Uint8Array;
}

/** The kept summaries of one cache: the reads, and the writes, of one task go out as one call each. */
function summaryStore(cache: GitHubCache) {
  const want = microBatch<Wanted>((batch) => {
    void cache
      .getSummaries(batch.map(({ sha, fp }) => ({ sha, fp })))
      // A cache that fails keeps nothing: the files are read.
      .catch(() => new Map<string, EntrySummary>())
      .then((found) => {
        for (const w of batch) w.resolve(found.get(`${w.sha}:${w.fp}`));
      });
  });
  // The listed sha names the row, but the source reads the path as it is now. Content that moved on since the listing
  // is not kept: the row would answer for the old sha in every later session.
  const keep = microBatch<Made>((batch) => {
    void Promise.all(
      batch.map(async ({ sha, fp, summary, bytes }) =>
        (await gitBlobSha(bytes)) === sha ? [{ sha, fp, summary }] : [],
      ),
    )
      .then((rows) => cache.putSummaries(rows.flat()))
      .catch(() => undefined); // best effort
  });
  return {
    get: (sha: string, fp: string) => new Promise<EntrySummary | undefined>((resolve) => want({ sha, fp, resolve })),
    keep,
  };
}

const stores = new WeakMap<GitHubCache, ReturnType<typeof summaryStore>>();

/** One store per cache: every summary query of every source shares its queues. */
function storeOf(cache: GitHubCache) {
  let store = stores.get(cache);
  if (!store) stores.set(cache, (store = summaryStore(cache)));
  return store;
}

/** The file of `bytes`, or an `EditletError` that names `path`, as `entryFileQuery` gives it. */
function parse(bytes: Uint8Array, path: string): EntryFile {
  const decoded = decodeUtf8(bytes, path);
  if ('issue' in decoded) throw new EditletError([decoded.issue]);
  try {
    return parseEntryFile(decoded.text);
  } catch (error) {
    if (error instanceof EditletError) throw new EditletError(error.issues.map((i) => ({ ...i, file: path })));
    throw error;
  }
}

/** The key of one summary: the blob sha and the schema fingerprint it was made from. */
const keyOf = (sha: string, fp: string) => `${sha}:${fp}`;

/** What the session holds of summaries, by `keyOf`: every list shares it, so each is loaded once. */
interface Memory {
  rows: Map<string, EntrySummary>;
  loading: Map<string, Promise<EntrySummary>>;
  /**
   * `rows`, in an object replaced after rows arrive (once for all that arrive together), so a list shows them before its
   * whole batch is there.
   */
  held: { rows: ReadonlyMap<string, EntrySummary> };
  listeners: Set<() => void>;
  announcing: boolean;
}

const memories = new WeakMap<object, Memory>();

function memoryOf(client: QueryClient): Memory {
  // Hung on a query of the cache, so `client.clear()` (sign-out) drops the summaries with it.
  const anchor = client.getQueryCache().build(client, { queryKey: ['summary-memory'], gcTime: Infinity });
  let memory = memories.get(anchor);
  if (!memory) {
    const rows = new Map<string, EntrySummary>();
    memory = { rows, loading: new Map(), held: { rows }, listeners: new Set(), announcing: false };
    memories.set(anchor, memory);
  }
  return memory;
}

/** How long arrived rows wait for others before the lists are told: file by file reads (dev mode) render once for many. */
const ANNOUNCE_MS = 50;

/** Tells the lists that rows arrived, once for all that arrive within `ANNOUNCE_MS`. */
function announce(memory: Memory): void {
  if (memory.announcing) return;
  memory.announcing = true;
  setTimeout(() => {
    memory.announcing = false;
    memory.held = { rows: memory.rows };
    for (const listener of memory.listeners) listener();
  }, ANNOUNCE_MS);
}

/** What every summary of one load is made with. */
interface Loader {
  source: ContentSource;
  cache: GitHubCache | null;
  client: QueryClient;
  schema: Schema;
}

type Wants = FileRef & { collection: string };

async function load({ source, cache, client, schema }: Loader, ref: Wants, fp: string): Promise<EntrySummary> {
  const { path, sha, collection } = ref;
  const open = client.getQueryData<EntryFileData>(entryFileQuery(source, ref).queryKey);
  if (open) return summarizeEntry(schema, collection, open.file);
  const store = cache ? storeOf(cache) : null;
  const kept = await store?.get(sha, fp);
  if (kept) return kept;
  const read = () => batchedReader(source, { keep: false }).read(path);
  // A failed request is tried once more; a path the source does not have is not.
  const bytes = await read().catch((error: unknown) => {
    if (error instanceof EditletError) throw error;
    return read();
  });
  const summary = summarizeEntry(schema, collection, parse(bytes, path));
  store?.keep({ sha, fp, summary, bytes });
  return summary;
}

/** The summary of `ref`: held, or being loaded for another list, or loaded now. A failure is not held. */
function summaryOf(loader: Loader, memory: Memory, ref: Wants, fp: string): Promise<EntrySummary> {
  const key = keyOf(ref.sha, fp);
  const held = memory.rows.get(key);
  if (held) return Promise.resolve(held);
  let loading = memory.loading.get(key);
  if (!loading) {
    loading = load(loader, ref, fp)
      .then((summary) => {
        memory.rows.set(key, summary);
        announce(memory);
        return summary;
      })
      .finally(() => memory.loading.delete(key));
    memory.loading.set(key, loading);
  }
  return loading;
}

/** One loaded batch of summaries, by `keyOf`: every ref of the batch is in one of the two. */
export interface SummaryBatch {
  rows: Map<string, EntrySummary>;
  errors: Map<string, Error>;
}

/**
 * The query of the summaries of `refs`, keyed by a hash of their `sha:fp` pairs: one query for a batch, not one per
 * entry (react-query's work per update grows with the number of queries, so 2,000 of them cost seconds). Each summary
 * comes from, in order: the session's memory; the parsed file when the query cache has it (an open entry); the
 * summaries `cache` keeps (GitHub mode; `null` in dev mode), asked in one call for every batch that starts in one task;
 * a batched read of the file, whose summary `cache` then keeps. It never makes a `['file', …]` query. A file that does
 * not parse is in `errors` with its issues and nothing is kept; a batch with errors loads them again at its next use.
 *
 * `fingerprints` are `schema`'s (`fingerprintsQuery`): the two must belong together, or a summary made under another
 * schema is kept. Two paths with one blob share one summary, so an error names one of them.
 */
export function summariesQuery(
  source: ContentSource,
  cache: GitHubCache | null,
  client: QueryClient,
  refs: Wants[],
  schema: Schema,
  fingerprints: Fingerprints,
) {
  const keys = refs.map((ref) => keyOf(ref.sha, fingerprints.get(ref.collection)!));
  return {
    queryKey: ['summaries', refs.length, fnv1a(keys.join('\n'))] as const,
    staleTime: (query: Query<SummaryBatch>) => (query.state.data?.errors.size ? 0 : Infinity),
    structuralSharing: false,
    queryFn: async (): Promise<SummaryBatch> => {
      const memory = memoryOf(client);
      const loader = { source, cache, client, schema };
      const settled = await Promise.allSettled(
        refs.map((ref) => summaryOf(loader, memory, ref, fingerprints.get(ref.collection)!)),
      );
      const batch: SummaryBatch = { rows: new Map(), errors: new Map() };
      settled.forEach((result, i) => {
        if (result.status === 'fulfilled') batch.rows.set(keys[i]!, result.value);
        else batch.errors.set(keys[i]!, result.reason as Error);
      });
      return batch;
    },
  };
}

/** The session's memory of summaries, rendering again when rows arrive. */
function useMemory() {
  const memory = memoryOf(useQueryClient());
  const subscribe = useCallback(
    (listener: () => void) => {
      memory.listeners.add(listener);
      return () => void memory.listeners.delete(listener);
    },
    [memory],
  );
  return useSyncExternalStore(subscribe, () => memory.held);
}

/**
 * The summaries the session already holds of `refs`, in their order; it asks for none. For a list that loads only some
 * rows' summaries and still shows what an earlier screen loaded.
 */
export function useHeldSummaries(refs: SummaryRef[]): (EntrySummary | undefined)[] {
  const fingerprints = useFingerprints(useSchema().data?.schema);
  const held = useMemory();
  return useMemo(
    () =>
      refs.map((ref) => {
        const fp = fingerprints?.get(ref.collection);
        return fp === undefined ? undefined : held.rows.get(keyOf(ref.sha, fp));
      }),
    [refs, fingerprints, held],
  );
}

/** Which query loads which ref's summary. */
interface Batches {
  /** The refs of each query: one per `[sha, fp]`, `BATCH_LIMIT` (what one read asks for) at most. */
  batches: SummaryRef[][];
  /** `keys[i]` is the summary of `refs[i]`, and `batches[slots[i]]` holds the ref that loads it. */
  keys: string[];
  slots: number[];
}

function batchesOf(refs: SummaryRef[], fingerprints: Fingerprints | undefined): Batches {
  const batches: SummaryRef[][] = [];
  const slotOf = new Map<string, number>();
  const keys: string[] = [];
  const slots = refs.map((ref) => {
    const fp = fingerprints?.get(ref.collection);
    const key = fp === undefined ? '' : keyOf(ref.sha, fp);
    keys.push(key);
    let slot = slotOf.get(key);
    if (slot === undefined && fp !== undefined) {
      if (batches.length === 0 || batches.at(-1)!.length === BATCH_LIMIT) batches.push([]);
      batches.at(-1)!.push(ref);
      slotOf.set(key, (slot = batches.length - 1));
    }
    return slot ?? 0;
  });
  return { batches, keys, slots };
}

/**
 * The summaries of `refs` (from `entryRefs` over the schema of `useSchema`), loaded as `summariesQuery` says, a batch at
 * a time; each row shows as soon as it arrives. Nothing is asked until that schema and its fingerprints are there. The
 * result and its arrays stay the same objects until a summary or an error changes, so they can be `useMemo`
 * dependencies; `refs` itself should be memoised.
 */
export function useSummaries(refs: SummaryRef[]): Summaries {
  const source = useSource();
  const client = useQueryClient();
  const cache = useWorkspace()?.source.cache ?? null;
  const schema = useSchema().data?.schema;
  const fingerprints = useFingerprints(schema);
  const held = useMemory();

  const { queries, keys, slots } = useMemo(() => {
    const { batches, ...at } = batchesOf(refs, schema ? fingerprints : undefined);
    return {
      ...at,
      queries: batches.map((batch) => summariesQuery(source, cache, client, batch, schema!, fingerprints!)),
    };
  }, [refs, fingerprints, schema, source, cache, client]);

  const combine = useCallback(
    (results: UseQueryResult<SummaryBatch>[]): Summaries => {
      // The memory first: a summary the session holds shows at once, whatever batch it is in now.
      const rows = keys.map((key, i) => held.rows.get(key) ?? results[slots[i]!]?.data?.rows.get(key));
      const errors = keys.map((key, i) =>
        rows[i] ? null : (results[slots[i]!]?.data?.errors.get(key) ?? results[slots[i]!]?.error ?? null),
      );
      const failed = errors.filter((error) => error !== null).length;
      const loaded = rows.filter((row) => row !== undefined).length + failed;
      return { rows, errors, loaded, total: keys.length, failed };
    },
    [keys, slots, held],
  );

  return useQueries({ queries, combine });
}
