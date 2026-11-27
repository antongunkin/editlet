import Dexie from 'dexie';
import type { Table } from 'dexie';

import type { FileEvent } from '../core/source.ts';
import type { EntrySummary } from '../core/summary.ts';

export interface PendingChange {
  path: string;
  /** The new file (an entry: its serialised text; an image: its bytes); `null` deletes it. */
  content: Uint8Array | string | null;
  /** The blob sha it is based on; `null` = the file must not exist (a new entry, an upload). */
  sha: string | null;
  /** When it was written: strictly increasing within a page, so `removeIf` can tell a newer row. */
  updatedAt: number;
  /** Entries: the file text at `sha` (`null` for a new entry), for the diff, the conflict compare and a restore. */
  base?: string | null;
  /** Row format; absent = 1. A row of an unknown format is not written over or committed by an older admin. */
  v?: number;
}

/** What a write gives: `updatedAt` is stamped by the queue. */
export type PendingWrite = Omit<PendingChange, 'updatedAt'>;

export interface PendingQueue {
  list(): Promise<PendingChange[]>;
  get(path: string): Promise<PendingChange | undefined>;
  put(change: PendingWrite): Promise<void>;
  /** Writes several rows in one transaction (an entry row and its images). */
  putMany(changes: PendingWrite[]): Promise<void>;
  remove(paths: string[]): Promise<void>;
  /** Removes the row of `path` only when it is not newer than `updatedAt` (one transaction). */
  removeIf(path: string, updatedAt: number): Promise<void>;
  clear(): Promise<void>;
}

/** What a cached blob is, so the two can have their own size budgets. */
export type BlobKind = 'entry' | 'image';

/**
 * What the cache keeps before it drops the least recently used rows: bytes of each blob kind, rows of last commits and
 * of entry summaries.
 */
export interface CacheBudget {
  entries: number;
  images: number;
  lastCommits: number;
  summaries: number;
}

/**
 * The default budgets. In an IndexedDB cache `entries` and `images` are each lowered to 10 % of the origin's free quota
 * when that is smaller.
 */
export const CACHE_BUDGET: Readonly<CacheBudget> = {
  entries: 50 * 2 ** 20,
  images: 50 * 2 ** 20,
  lastCommits: 50_000,
  summaries: 50_000,
};

/** An eviction takes what is over its budget down to this share of it, so the next put does not start another. */
const EVICT_TO = 0.8;
const QUOTA_SHARE = 0.1;

export interface GitHubCache {
  /** The kept blobs by sha; a sha it does not have is absent. */
  getBlobs(shas: string[]): Promise<Map<string, Uint8Array>>;
  /** `kind` defaults to `entry`. */
  putBlobs(blobs: { sha: string; bytes: Uint8Array; kind?: BlobKind }[]): Promise<void>;
  /** The kept last commits by path, for the keys it has (`null` = no commit found); a path it does not have is absent. `scope` is `owner/repo#branch`. */
  getLastCommits(scope: string, keys: { path: string; sha: string }[]): Promise<Map<string, FileEvent | null>>;
  putLastCommits(scope: string, rows: { path: string; sha: string; event: FileEvent | null }[]): Promise<void>;
  /**
   * The kept entry summaries by `${sha}:${fp}` (blob sha and schema fingerprint); a key it does not have is absent. A
   * summary follows from those two alone, so it has no scope.
   */
  getSummaries(keys: { sha: string; fp: string }[]): Promise<Map<string, EntrySummary>>;
  putSummaries(rows: { sha: string; fp: string; summary: EntrySummary }[]): Promise<void>;
  /**
   * Drops the least recently used rows of every kind that is over its budget, down to 80 % of it. A put that crosses a
   * budget runs this by itself when the page is idle. `budget` overrides the cache's budgets for this run. Best effort.
   */
  evict(budget?: Partial<CacheBudget>): Promise<void>;
  /**
   * Drops blobs, last commits and summaries whose blob sha is not in `reachable` and that were last used before
   * `olderThan` (ms since the epoch). Best effort.
   */
  pruneUnreachable(reachable: ReadonlySet<string>, olderThan: number): Promise<void>;
  pending(scope: string): PendingQueue;
  /** The scopes that have pending rows. */
  scopes(): Promise<string[]>;
  /** `false` for the memory cache (no IndexedDB): pending rows do not survive a reload. */
  readonly persistent: boolean;
  /** Drops what GitHub can give again (blobs, last commits and summaries, of every repository). Unsaved edits stay. */
  clearContent(): Promise<void>;
  /** Drops everything, unsaved edits included. */
  clear(): Promise<void>;
  /** Releases the underlying database connection (no-op for the memory cache). */
  close?(): Promise<void>;
}

interface BlobRow {
  sha: string;
  bytes: Uint8Array;
  /** `bytes.byteLength`, kept so totals do not read the bytes. */
  size: number;
  /** When it was last written or read. A read writes it only when it is `TOUCH_MS` old, so it is that accurate. */
  usedAt: number;
  kind: BlobKind;
}
interface CommitRow {
  /** The scope `owner/repo#branch`; the column keeps its first name, so the Dexie schema stays. */
  branch: string;
  path: string;
  sha: string;
  event: FileEvent | null;
  usedAt: number;
}
interface SummaryRow {
  sha: string;
  fp: string;
  summary: EntrySummary;
  usedAt: number;
}
interface PendingRow extends PendingChange {
  scope: string;
}

type CommitDbKey = [branch: string, path: string, sha: string];
type SummaryDbKey = [sha: string, fp: string];
type CacheDb = Dexie & {
  blobs: Table<BlobRow, string>;
  pending: Table<PendingRow, [string, string]>;
  lastCommits: Table<CommitRow, CommitDbKey>;
  summaries: Table<SummaryRow, SummaryDbKey>;
};

/** A read writes a row's `usedAt` only when it is this old: writing a blob row rewrites its bytes too. */
const TOUCH_MS = 24 * 60 * 60_000;

/**
 * Answers whether a read writes a row's `usedAt`: the stored one is old (or missing: a tab still on version 1 writes
 * none), and this cache has not asked for the write yet (a second read can start before the first one's write lands).
 */
function touchGate(): (key: string, usedAt: number | undefined, now: number) => boolean {
  const lastTouch = new Map<string, number>();
  return (key, usedAt, now) => {
    if (now - Math.max(usedAt ?? 0, lastTouch.get(key) ?? 0) < TOUCH_MS) return false;
    lastTouch.set(key, now);
    return true;
  };
}

const blobRow = (blob: { sha: string; bytes: Uint8Array; kind?: BlobKind }): BlobRow => ({
  sha: blob.sha,
  bytes: new Uint8Array(blob.bytes),
  size: blob.bytes.byteLength,
  usedAt: Date.now(),
  kind: blob.kind ?? 'entry',
});

const blobRows = (blobs: { sha: string; bytes: Uint8Array; kind?: BlobKind }[]): BlobRow[] => [
  ...new Map(blobs.map((b) => [b.sha, blobRow(b)])).values(),
];

/** Runs `task` when the page is idle; without `requestIdleCallback` (Safari, Node), a second later. */
export function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => task());
  else setTimeout(task, 1000);
}

/** What the budgets need to know of a blob row. */
interface BlobMeta {
  sha: string;
  size: number;
  usedAt: number;
  kind: BlobKind;
}

/** A row a tab still on version 1 wrote has no `size`, `usedAt` or `kind`: it counts as an entry never used. */
const metaOf = (row: BlobRow): BlobMeta => ({
  sha: row.sha,
  size: row.size ?? row.bytes.byteLength,
  usedAt: row.usedAt ?? 0,
  kind: row.kind ?? 'entry',
});

const BUDGET_OF = { entry: 'entries', image: 'images' } as const satisfies Record<BlobKind, keyof CacheBudget>;

/** The shas to drop so each kind over its budget is at `EVICT_TO` of it (least recently used first), and what stays. */
function pickBlobs(rows: BlobMeta[], budget: CacheBudget) {
  const left: Record<BlobKind, number> = { entry: 0, image: 0 };
  for (const row of rows) left[row.kind] += row.size;
  const over = new Set((['entry', 'image'] as const).filter((kind) => left[kind] > budget[BUDGET_OF[kind]]));
  const victims: string[] = [];
  if (over.size === 0) return { victims, left };
  for (const row of rows.toSorted((a, b) => a.usedAt - b.usedAt)) {
    if (!over.has(row.kind) || left[row.kind] <= budget[BUDGET_OF[row.kind]] * EVICT_TO) continue;
    victims.push(row.sha);
    left[row.kind] -= row.size;
  }
  return { victims, left };
}

/** How many rows to drop from `count` of a table with a row budget of `max`. */
const rowExcess = (count: number, max: number): number => (count > max ? count - Math.floor(max * EVICT_TO) : 0);

/** Drops the least recently used rows of a table over its row budget (the index gives their keys); counts what stays. */
async function trimTable<T, K>(table: Table<T, K>, max: number): Promise<number> {
  const count = await table.count();
  const excess = rowExcess(count, max);
  if (excess > 0) await table.bulkDelete(await table.orderBy('usedAt').limit(excess).primaryKeys());
  return count - excess;
}

/** The same rows of a Map, which the caller drops. */
const oldestKeys = (rows: ReadonlyMap<string, { usedAt: number }>, max: number): string[] =>
  [...rows]
    .toSorted(([, a], [, b]) => a.usedAt - b.usedAt)
    .slice(0, rowExcess(rows.size, max))
    .map(([key]) => key);

/** The cache's totals, and the one eviction a put over budget schedules (later puts do not add another). */
function budgetKeeper(
  limits: () => Promise<CacheBudget>,
  evict: () => Promise<void>,
  /** Resolves when `totals` count what was stored before this cache. */
  counted: () => Promise<void> = () => Promise.resolve(),
) {
  const totals: CacheBudget = { entries: 0, images: 0, lastCommits: 0, summaries: 0 };
  let scheduled = false;
  return {
    totals,
    /** Called after a put, which does not wait for it. Never rejects. */
    async check(): Promise<void> {
      await counted();
      const max = await limits();
      const over = (['entries', 'images', 'lastCommits', 'summaries'] as const).some((key) => totals[key] > max[key]);
      if (!over || scheduled) return;
      scheduled = true;
      whenIdle(() => {
        void evict().finally(() => (scheduled = false));
      });
    },
    reset(): void {
      totals.entries = totals.images = totals.lastCommits = totals.summaries = 0;
    },
  };
}

/** The budgets lowered to the room the origin has left; unchanged where the browser cannot say. */
async function withinQuota(budget: CacheBudget): Promise<CacheBudget> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    if (estimate?.quota === undefined) return budget;
    const room = Math.max(0, Math.floor((estimate.quota - (estimate.usage ?? 0)) * QUOTA_SHARE));
    return { ...budget, entries: Math.min(budget.entries, room), images: Math.min(budget.images, room) };
  } catch {
    return budget;
  }
}

/** Rows read or deleted at a time: a blob row carries its bytes. */
const PRUNE_CHUNK = 200;

const copyContent = (c: Uint8Array | string | null): Uint8Array | string | null =>
  c === null || typeof c === 'string' ? c : new Uint8Array(c);

const toChange = (r: PendingRow): PendingChange => ({
  path: r.path,
  content: copyContent(r.content),
  sha: r.sha,
  updatedAt: r.updatedAt,
  ...(r.base !== undefined ? { base: r.base } : {}),
  ...(r.v !== undefined ? { v: r.v } : {}),
});

let lastStamp = 0;
/** `Date.now()`, but never the same twice: two writes in one millisecond stay ordered. */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

const toRow = (scope: string, change: PendingWrite): PendingRow => ({
  scope,
  path: change.path,
  content: copyContent(change.content),
  sha: change.sha,
  updatedAt: stamp(),
  ...(change.base !== undefined ? { base: change.base } : {}),
  ...(change.v !== undefined ? { v: change.v } : {}),
});

const byPath = (a: PendingChange, b: PendingChange): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export function openGitHubCache(
  options: {
    name?: string;
    indexedDB?: IDBFactory;
    IDBKeyRange?: typeof IDBKeyRange;
    budget?: Partial<CacheBudget>;
  } = {},
): GitHubCache {
  if (!options.indexedDB && (globalThis as { indexedDB?: unknown }).indexedDB === undefined) {
    return createMemoryCache({ budget: options.budget });
  }
  const deps = options.indexedDB ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange } : {};
  const db = new Dexie(options.name ?? 'editlet-github', deps) as CacheDb;
  db.version(1).stores({ blobs: 'sha', pending: '[scope+path], scope' });
  db.version(2)
    .stores({
      blobs: 'sha, usedAt, kind',
      pending: '[scope+path], scope',
      lastCommits: '[branch+path+sha], usedAt',
    })
    .upgrade(async (tx) => {
      // Only blob rows change: `pending` (unsaved edits) is not read or written.
      const now = Date.now();
      await tx
        .table<BlobRow>('blobs')
        .toCollection()
        .modify((row) => {
          row.size = row.bytes.byteLength;
          row.usedAt = now;
          row.kind = 'entry';
        });
    });
  // A new, empty table: no upgrade body.
  db.version(3).stores({
    blobs: 'sha, usedAt, kind',
    pending: '[scope+path], scope',
    lastCommits: '[branch+path+sha], usedAt',
    summaries: '[sha+fp], usedAt, sha',
  });
  const blobDue = touchGate();
  const commitDue = touchGate();
  const summaryDue = touchGate();

  const budget: CacheBudget = { ...CACHE_BUDGET, ...options.budget };
  let quota: Promise<CacheBudget> | undefined;
  /** The budgets in force: the quota is asked once, when first needed. */
  const limits = (): Promise<CacheBudget> => (quota ??= withinQuota(budget));
  const keeper = budgetKeeper(
    limits,
    () => evict(),
    () => sum(),
  );
  const { totals } = keeper;

  /** Writes that change the totals run one at a time, so the totals match the rows. */
  let queue: Promise<unknown> = Promise.resolve();
  function write<T>(task: () => Promise<T>): Promise<T> {
    const done = queue.then(task);
    queue = done.catch(() => undefined);
    return done;
  }
  const bestEffort = (task: () => Promise<void>): Promise<void> => write(task).catch(() => undefined);

  let summed: Promise<void> | undefined;
  /**
   * Counts the stored rows into the totals, once. It is asked after the first put, which does not wait for it: a page
   * that only reads never pays, and no read of a new blob is held up (about 70 ms at 2,000 rows).
   */
  function sum(): Promise<void> {
    return (summed ??= bestEffort(async () => {
      // After `open()`: a table call on a database that cannot open at all leaks an uncaught error past its `catch`.
      await db.open();
      const found = { entry: 0, image: 0 };
      // There is no index on `size`: `each` holds one row (and so one blob's bytes) at a time.
      await db.blobs.each((row) => {
        const { size, kind } = metaOf(row);
        found[kind] += size;
      });
      totals.lastCommits = await db.lastCommits.count();
      totals.summaries = await db.summaries.count();
      totals.entries = found.entry;
      totals.images = found.image;
    }));
  }

  function evict(override?: Partial<CacheBudget>): Promise<void> {
    return bestEffort(async () => {
      const max = { ...(await limits()), ...override };
      // Blobs: sizes are only in the rows, so this reads them all (one at a time), then deletes by key.
      const rows: BlobMeta[] = [];
      await db.blobs.each((row) => rows.push(metaOf(row)));
      const { victims, left } = pickBlobs(rows, max);
      await db.blobs.bulkDelete(victims);
      totals.entries = left.entry;
      totals.images = left.image;
      // Last commits and summaries: every row has `usedAt`, so the index gives the oldest keys.
      totals.lastCommits = await trimTable(db.lastCommits, max.lastCommits);
      totals.summaries = await trimTable(db.summaries, max.summaries);
    });
  }

  return {
    evict,
    pruneUnreachable(reachable, olderThan) {
      return bestEffort(async () => {
        // Keys alone first, so rows that stay are not read. A row without `usedAt` is in no index: not recent.
        const all = await db.blobs.toCollection().primaryKeys();
        const recent = new Set(await db.blobs.where('usedAt').aboveOrEqual(olderThan).primaryKeys());
        const gone = all.filter((sha) => !reachable.has(sha) && !recent.has(sha));
        for (let i = 0; i < gone.length; i += PRUNE_CHUNK) {
          const rows = await db.blobs.bulkGet(gone.slice(i, i + PRUNE_CHUNK));
          // Asked again of the row: a read may have touched it since.
          const stale = rows.filter((row) => row !== undefined).map(metaOf);
          const drop = stale.filter((row) => row.usedAt < olderThan);
          await db.blobs.bulkDelete(drop.map((row) => row.sha));
          for (const { size, kind } of drop) totals[BUDGET_OF[kind]] -= size;
        }
        // The sha is part of the key: no row is read.
        const commits = await db.lastCommits.where('usedAt').below(olderThan).primaryKeys();
        const stale = commits.filter(([, , sha]) => !reachable.has(sha));
        await db.lastCommits.bulkDelete(stale);
        totals.lastCommits -= stale.length;
        const summaries = await db.summaries.where('usedAt').below(olderThan).primaryKeys();
        const unused = summaries.filter(([sha]) => !reachable.has(sha));
        await db.summaries.bulkDelete(unused);
        totals.summaries -= unused.length;
      });
    },
    async getBlobs(shas) {
      const out = new Map<string, Uint8Array>();
      const due: string[] = [];
      const now = Date.now();
      try {
        const rows = await db.blobs.bulkGet(shas);
        for (const row of rows) {
          if (!row) continue;
          out.set(row.sha, new Uint8Array(row.bytes));
          if (blobDue(row.sha, row.usedAt, now)) due.push(row.sha);
        }
      } catch {
        // best-effort cache
      }
      if (due.length > 0) {
        // Not awaited: the read does not wait for the write, and a failed one only leaves an older `usedAt`.
        db.blobs.bulkUpdate(due.map((key) => ({ key, changes: { usedAt: now } }))).catch(() => undefined);
      }
      return out;
    },
    async putBlobs(blobs) {
      const rows = blobRows(blobs);
      if (rows.length === 0) return;
      await bestEffort(async () => {
        const replaced = await db.transaction('rw', db.blobs, async () => {
          // A sha the cache already has is not counted twice. For a new one the lookup reads nothing.
          const had = await db.blobs.bulkGet(rows.map((row) => row.sha));
          await db.blobs.bulkPut(rows);
          return had;
        });
        for (const row of replaced) {
          if (!row) continue;
          const { size, kind } = metaOf(row);
          totals[BUDGET_OF[kind]] -= size;
        }
        for (const row of rows) totals[BUDGET_OF[row.kind]] += row.size;
      });
      void keeper.check();
    },
    async getLastCommits(scope, keys) {
      const out = new Map<string, FileEvent | null>();
      const due: CommitDbKey[] = [];
      const now = Date.now();
      try {
        const rows = await db.lastCommits.bulkGet(keys.map(({ path, sha }): CommitDbKey => [scope, path, sha]));
        for (const row of rows) {
          if (!row) continue;
          out.set(row.path, row.event);
          if (commitDue(commitKey(row.branch, row.path, row.sha), row.usedAt, now)) {
            due.push([row.branch, row.path, row.sha]);
          }
        }
      } catch {
        // best-effort cache
      }
      if (due.length > 0) {
        db.lastCommits.bulkUpdate(due.map((key) => ({ key, changes: { usedAt: now } }))).catch(() => undefined);
      }
      return out;
    },
    async putLastCommits(scope, rows) {
      if (rows.length === 0) return;
      const usedAt = Date.now();
      const puts = rows.map(({ path, sha, event }) => ({ branch: scope, path, sha, event, usedAt }));
      await bestEffort(async () => {
        const added = await db.transaction('rw', db.lastCommits, async () => {
          const keys = puts.map(({ path, sha }): CommitDbKey => [scope, path, sha]);
          const had = await db.lastCommits.bulkGet(keys);
          await db.lastCommits.bulkPut(puts);
          return new Set(puts.filter((_, i) => !had[i]).map((row) => commitKey(scope, row.path, row.sha))).size;
        });
        totals.lastCommits += added;
      });
      void keeper.check();
    },
    async getSummaries(keys) {
      const out = new Map<string, EntrySummary>();
      const due: SummaryDbKey[] = [];
      const now = Date.now();
      try {
        const rows = await db.summaries.bulkGet(keys.map(({ sha, fp }): SummaryDbKey => [sha, fp]));
        for (const row of rows) {
          if (!row) continue;
          const key = summaryKey(row.sha, row.fp);
          out.set(key, row.summary);
          if (summaryDue(key, row.usedAt, now)) due.push([row.sha, row.fp]);
        }
      } catch {
        // best-effort cache
      }
      if (due.length > 0) {
        db.summaries.bulkUpdate(due.map((key) => ({ key, changes: { usedAt: now } }))).catch(() => undefined);
      }
      return out;
    },
    async putSummaries(rows) {
      if (rows.length === 0) return;
      const usedAt = Date.now();
      const puts = rows.map(({ sha, fp, summary }) => ({ sha, fp, summary, usedAt }));
      await bestEffort(async () => {
        const added = await db.transaction('rw', db.summaries, async () => {
          const had = await db.summaries.bulkGet(puts.map(({ sha, fp }): SummaryDbKey => [sha, fp]));
          await db.summaries.bulkPut(puts);
          return new Set(puts.filter((_, i) => !had[i]).map((row) => summaryKey(row.sha, row.fp))).size;
        });
        totals.summaries += added;
      });
      void keeper.check();
    },
    pending(scope) {
      return {
        async list() {
          const rows = await db.pending.where('scope').equals(scope).toArray();
          return rows.map(toChange).toSorted(byPath);
        },
        async get(path) {
          const row = await db.pending.get([scope, path]);
          return row ? toChange(row) : undefined;
        },
        async put(change) {
          await db.pending.put(toRow(scope, change));
        },
        async putMany(changes) {
          await db.transaction('rw', db.pending, () => db.pending.bulkPut(changes.map((c) => toRow(scope, c))));
        },
        async remove(paths) {
          await db.pending.bulkDelete(paths.map((p): [string, string] => [scope, p]));
        },
        async removeIf(path, updatedAt) {
          await db.transaction('rw', db.pending, async () => {
            const row = await db.pending.get([scope, path]);
            if (row && row.updatedAt <= updatedAt) await db.pending.delete([scope, path]);
          });
        },
        async clear() {
          await db.pending.where('scope').equals(scope).delete();
        },
      };
    },
    async scopes() {
      return (await db.pending.orderBy('scope').uniqueKeys()).map(String);
    },
    persistent: true,
    clearContent() {
      return write(async () => {
        await Promise.all([db.blobs.clear(), db.lastCommits.clear(), db.summaries.clear()]);
        keeper.reset();
      });
    },
    clear() {
      return write(async () => {
        await Promise.all([db.blobs.clear(), db.lastCommits.clear(), db.summaries.clear(), db.pending.clear()]);
        keeper.reset();
      });
    },
    async close() {
      db.close();
    },
  };
}

const commitKey = (branch: string, path: string, sha: string): string => `${branch}\0${path}\0${sha}`;

/** The key `getSummaries` answers with. */
const summaryKey = (sha: string, fp: string): string => `${sha}:${fp}`;

/**
 * The same rows in Maps. A read always writes `usedAt`: there is no write to spare here. The same budgets apply, without
 * the quota: nothing here is stored.
 */
export function createMemoryCache(options: { budget?: Partial<CacheBudget> } = {}): GitHubCache {
  const budget: CacheBudget = { ...CACHE_BUDGET, ...options.budget };
  const keeper = budgetKeeper(
    async () => budget,
    () => evict(),
  );
  const { totals } = keeper;
  const blobs = new Map<string, BlobRow>();
  /** By `commitKey`. */
  const lastCommits = new Map<string, CommitRow>();
  /** By `summaryKey`. */
  const summaries = new Map<string, SummaryRow>();
  const pending = new Map<string, Map<string, PendingRow>>();
  const scopeMap = (scope: string): Map<string, PendingRow> => {
    let m = pending.get(scope);
    if (!m) pending.set(scope, (m = new Map()));
    return m;
  };
  const dropBlob = (sha: string): void => {
    const row = blobs.get(sha);
    if (!row) return;
    totals[BUDGET_OF[row.kind]] -= row.size;
    blobs.delete(sha);
  };
  const dropCommit = (key: string): void => {
    if (lastCommits.delete(key)) totals.lastCommits--;
  };
  const dropSummary = (key: string): void => {
    if (summaries.delete(key)) totals.summaries--;
  };
  async function evict(override?: Partial<CacheBudget>): Promise<void> {
    const max = { ...budget, ...override };
    for (const sha of pickBlobs([...blobs.values()].map(metaOf), max).victims) dropBlob(sha);
    for (const key of oldestKeys(lastCommits, max.lastCommits)) dropCommit(key);
    for (const key of oldestKeys(summaries, max.summaries)) dropSummary(key);
  }
  return {
    evict,
    async pruneUnreachable(reachable, olderThan) {
      for (const row of blobs.values()) {
        if (row.usedAt < olderThan && !reachable.has(row.sha)) dropBlob(row.sha);
      }
      for (const [key, row] of lastCommits) {
        if (row.usedAt < olderThan && !reachable.has(row.sha)) dropCommit(key);
      }
      for (const [key, row] of summaries) {
        if (row.usedAt < olderThan && !reachable.has(row.sha)) dropSummary(key);
      }
    },
    async getBlobs(shas) {
      const out = new Map<string, Uint8Array>();
      for (const sha of shas) {
        const row = blobs.get(sha);
        if (!row) continue;
        row.usedAt = Date.now();
        out.set(sha, new Uint8Array(row.bytes));
      }
      return out;
    },
    async putBlobs(list) {
      for (const row of blobRows(list)) {
        dropBlob(row.sha);
        blobs.set(row.sha, row);
        totals[BUDGET_OF[row.kind]] += row.size;
      }
      void keeper.check();
    },
    async getLastCommits(scope, keys) {
      const out = new Map<string, FileEvent | null>();
      for (const { path, sha } of keys) {
        const row = lastCommits.get(commitKey(scope, path, sha));
        if (!row) continue;
        row.usedAt = Date.now();
        out.set(path, structuredClone(row.event));
      }
      return out;
    },
    async putLastCommits(scope, rows) {
      const usedAt = Date.now();
      for (const { path, sha, event } of rows) {
        const key = commitKey(scope, path, sha);
        if (!lastCommits.has(key)) totals.lastCommits++;
        lastCommits.set(key, { branch: scope, path, sha, event: structuredClone(event), usedAt });
      }
      void keeper.check();
    },
    async getSummaries(keys) {
      const out = new Map<string, EntrySummary>();
      for (const { sha, fp } of keys) {
        const row = summaries.get(summaryKey(sha, fp));
        if (!row) continue;
        row.usedAt = Date.now();
        out.set(summaryKey(sha, fp), structuredClone(row.summary));
      }
      return out;
    },
    async putSummaries(rows) {
      const usedAt = Date.now();
      for (const { sha, fp, summary } of rows) {
        const key = summaryKey(sha, fp);
        if (!summaries.has(key)) totals.summaries++;
        summaries.set(key, { sha, fp, summary: structuredClone(summary), usedAt });
      }
      void keeper.check();
    },
    pending(scope) {
      return {
        async list() {
          return [...scopeMap(scope).values()].map(toChange).toSorted(byPath);
        },
        async get(path) {
          const row = scopeMap(scope).get(path);
          return row ? toChange(row) : undefined;
        },
        async put(change) {
          scopeMap(scope).set(change.path, toRow(scope, change));
        },
        async putMany(changes) {
          const m = scopeMap(scope);
          for (const c of changes) m.set(c.path, toRow(scope, c));
        },
        async remove(paths) {
          const m = scopeMap(scope);
          for (const p of paths) m.delete(p);
        },
        async removeIf(path, updatedAt) {
          const m = scopeMap(scope);
          const row = m.get(path);
          if (row && row.updatedAt <= updatedAt) m.delete(path);
        },
        async clear() {
          scopeMap(scope).clear();
        },
      };
    },
    async scopes() {
      return [...pending]
        .filter(([, rows]) => rows.size > 0)
        .map(([scope]) => scope)
        .toSorted();
    },
    persistent: false,
    async clearContent() {
      blobs.clear();
      lastCommits.clear();
      summaries.clear();
      keeper.reset();
    },
    async clear() {
      blobs.clear();
      lastCommits.clear();
      summaries.clear();
      keeper.reset();
      pending.clear();
    },
  };
}
