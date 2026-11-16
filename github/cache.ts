import Dexie from 'dexie';
import type { Table } from 'dexie';

export interface PendingChange {
  path: string;
  content: Uint8Array | string | null;
  sha: string | null;
  updatedAt: number;
}

export interface PendingQueue {
  list(): Promise<PendingChange[]>;
  get(path: string): Promise<PendingChange | undefined>;
  put(change: { path: string; content: Uint8Array | string | null; sha: string | null }): Promise<void>;
  remove(paths: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface GitHubCache {
  getBlobs(shas: string[]): Promise<Map<string, Uint8Array>>;
  putBlobs(blobs: { sha: string; bytes: Uint8Array }[]): Promise<void>;
  pending(scope: string): PendingQueue;
  clear(): Promise<void>;
  /** Releases the underlying database connection (no-op for the memory cache). */
  close?(): Promise<void>;
}

interface BlobRow {
  sha: string;
  bytes: Uint8Array;
}
interface PendingRow {
  scope: string;
  path: string;
  content: Uint8Array | string | null;
  sha: string | null;
  updatedAt: number;
}

type CacheDb = Dexie & { blobs: Table<BlobRow, string>; pending: Table<PendingRow, [string, string]> };

const copyContent = (c: Uint8Array | string | null): Uint8Array | string | null =>
  c === null || typeof c === 'string' ? c : new Uint8Array(c);

const toChange = (r: PendingRow): PendingChange => ({
  path: r.path,
  content: copyContent(r.content),
  sha: r.sha,
  updatedAt: r.updatedAt,
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
          await db.pending.put({
            scope,
            path: change.path,
            content: copyContent(change.content),
            sha: change.sha,
            updatedAt: Date.now(),
          });
        },
        async remove(paths) {
          await db.pending.bulkDelete(paths.map((p): [string, string] => [scope, p]));
        },
        async clear() {
          await db.pending.where('scope').equals(scope).delete();
        },
      };
    },
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
          scopeMap(scope).set(change.path, {
            scope,
            path: change.path,
            content: copyContent(change.content),
            sha: change.sha,
            updatedAt: Date.now(),
          });
        },
        async remove(paths) {
          const m = scopeMap(scope);
          for (const p of paths) m.delete(p);
        },
        async clear() {
          scopeMap(scope).clear();
        },
      };
    },
    async clear() {
      blobs.clear();
      pending.clear();
    },
  };
}
