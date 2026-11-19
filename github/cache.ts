import Dexie from 'dexie';
import type { Table } from 'dexie';

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

export interface GitHubCache {
  getBlobs(shas: string[]): Promise<Map<string, Uint8Array>>;
  putBlobs(blobs: { sha: string; bytes: Uint8Array }[]): Promise<void>;
  pending(scope: string): PendingQueue;
  /** The scopes that have pending rows. */
  scopes(): Promise<string[]>;
  /** `false` for the memory cache (no IndexedDB): pending rows do not survive a reload. */
  readonly persistent: boolean;
  clear(): Promise<void>;
  /** Releases the underlying database connection (no-op for the memory cache). */
  close?(): Promise<void>;
}

interface BlobRow {
  sha: string;
  bytes: Uint8Array;
}
interface PendingRow extends PendingChange {
  scope: string;
}

type CacheDb = Dexie & { blobs: Table<BlobRow, string>; pending: Table<PendingRow, [string, string]> };

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
  options: { name?: string; indexedDB?: IDBFactory; IDBKeyRange?: typeof IDBKeyRange } = {},
): GitHubCache {
  if (!options.indexedDB && (globalThis as { indexedDB?: unknown }).indexedDB === undefined) {
    return createMemoryCache();
  }
  const deps = options.indexedDB ? { indexedDB: options.indexedDB, IDBKeyRange: options.IDBKeyRange } : {};
  const db = new Dexie(options.name ?? 'editlet-github', deps) as CacheDb;
  db.version(1).stores({ blobs: 'sha', pending: '[scope+path], scope' });

  return {
    async getBlobs(shas) {
      const out = new Map<string, Uint8Array>();
      try {
        const rows = await db.blobs.bulkGet(shas);
        for (const row of rows) if (row) out.set(row.sha, new Uint8Array(row.bytes));
      } catch {
        // best-effort cache
      }
      return out;
    },
    async putBlobs(blobs) {
      try {
        await db.blobs.bulkPut(blobs.map((b) => ({ sha: b.sha, bytes: new Uint8Array(b.bytes) })));
      } catch {
        // best-effort cache
      }
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
    async clear() {
      await Promise.all([db.blobs.clear(), db.pending.clear()]);
    },
    async close() {
      db.close();
    },
  };
}

export function createMemoryCache(): GitHubCache {
  const blobs = new Map<string, Uint8Array>();
  const pending = new Map<string, Map<string, PendingRow>>();
  const scopeMap = (scope: string): Map<string, PendingRow> => {
    let m = pending.get(scope);
    if (!m) pending.set(scope, (m = new Map()));
    return m;
  };
  return {
    async getBlobs(shas) {
      const out = new Map<string, Uint8Array>();
      for (const sha of shas) {
        const b = blobs.get(sha);
        if (b) out.set(sha, new Uint8Array(b));
      }
      return out;
    },
    async putBlobs(list) {
      for (const b of list) blobs.set(b.sha, new Uint8Array(b.bytes));
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
    async clear() {
      blobs.clear();
      pending.clear();
    },
  };
}
