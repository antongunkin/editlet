import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo, useRef } from 'react';

import { parseEntryFile } from '../../../core/entryFile';
import { isImagePath, parseEntryPath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import {
  createMemoryCache,
  openGitHubCache,
  type GitHubCache,
  type GitHubSource,
  type PendingChange,
  type PendingQueue,
  type PendingWrite,
} from '../../../github';
import { referencedAssets } from '../entry/changes';
import { useSource } from '../source/context';
import { useLocalGitQuery } from '../status/localGit';

/** The broadcast every store write posts, to this tab's listeners and on `BroadcastChannel('editlet-changes')`. */
export type ChangesMessage = { scope: string; paths: string[]; tab: string };

export const CHANGES_CHANNEL = 'editlet-changes';
const CHANNEL_NAME = CHANGES_CHANNEL;

/** This tab's id in `ChangesMessage.tab`: a form ignores what it wrote itself. */
export const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random());

const listeners = new Set<(message: ChangesMessage) => void>();
let channel: BroadcastChannel | null | undefined;

function openChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
    channel?.addEventListener('message', (event: MessageEvent<ChangesMessage>) => {
      for (const fn of listeners) fn(event.data);
    });
  } catch {
    // A page without a working BroadcastChannel (a stub, a sandbox): this tab's listeners still work.
    channel = null;
  }
  return channel;
}

/** Listens to every store write: this tab's (`tab === TAB_ID`) and the other tabs'. Returns the unsubscribe. */
export function onChanges(fn: (message: ChangesMessage) => void): () => void {
  openChannel();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function post(message: ChangesMessage) {
  for (const fn of listeners) {
    try {
      fn(message);
    } catch {
      // One listener's error must not stop the others, nor the other tabs.
    }
  }
  try {
    openChannel()?.postMessage(message);
  } catch {
    // Another tab learns of it on its next focus (`refetchOnWindowFocus`).
  }
}

// One serial queue per cache: the writes of every store of a cache run in order (the form's unmount flush before the
// next screen's read, a save's removals after its flush).
const chains = new WeakMap<GitHubCache, Promise<unknown>>();
function serial<T>(cache: GitHubCache, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(cache) ?? Promise.resolve()).then(task, task);
  chains.set(
    cache,
    run.catch(() => undefined),
  );
  return run;
}

/** An entry row of the buffer (a file of a collection), as opposed to an image row or another file. */
export const isEntryRow = (schema: Schema, path: string) => parseEntryPath(schema, path) !== null;
/** A `.md` file directly under a collection folder of the content dir, whether or not the schema knows the collection. */
const isEntryLike = (schema: Schema, path: string) =>
  path.startsWith(`${schema.contentDir}/`) && /^[^/]+\/[^/]+\.md$/.test(path.slice(schema.contentDir.length + 1));

export interface ChangesStore {
  /** `owner/repo#branch` (GitHub) or `local:<project>#<branch or ->` (dev). */
  readonly scope: string;
  readonly queue: PendingQueue;
  readonly cache: GitHubCache;
  /** `false` without IndexedDB: the rows do not survive a reload, so the leave confirms stay. */
  readonly persistent: boolean;
  /** An entry row and the staged images it references, in one transaction. */
  writeEntry(row: PendingWrite, images?: PendingWrite[]): Promise<void>;
  removeEntry(path: string): Promise<void>;
  /** Removes `path` unless it was written after `updatedAt` (a save keeps a row typed into meanwhile). */
  removeIf(path: string, updatedAt: number): Promise<void>;
  /** Removes the image rows no entry row references (image fields and body images): after a save, a discard, a revert. */
  pruneImages(schema: Schema): Promise<void>;
  /** Every row of the scope. */
  clearAll(): Promise<void>;
  /** The rows, read after every write queued before this call has landed (an entry opened right after another closed). */
  read(): Promise<PendingChange[]>;
  /** Moves every row of `from` into `to` (rows of the same path in `to` are replaced). */
  moveScope(from: string, to: string): Promise<void>;
}

const shadows = new WeakMap<GitHubCache, Map<string, PendingQueue>>();
/** A memory queue per cache and scope: the rows a failing database could not take (see `withShadow`). */
function shadowOf(cache: GitHubCache, scope: string): PendingQueue {
  let byScope = shadows.get(cache);
  if (!byScope) shadows.set(cache, (byScope = new Map()));
  let queue = byScope.get(scope);
  if (!queue) byScope.set(scope, (queue = createMemoryCache().pending(scope)));
  return queue;
}

const byPath = (a: PendingChange, b: PendingChange) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The scope's queue, with a memory shadow: a write the database refuses (quota, a blocked or private-mode IndexedDB)
 * lands in memory instead and still rejects, so the form says so (*could not be kept on this device*) but *Your changes*
 * can save what the editor typed. Reads merge both, the newer row of a path wins.
 */
function withShadow(cache: GitHubCache, scope: string): PendingQueue {
  const real = cache.pending(scope);
  const shadow = shadowOf(cache, scope);
  const putMany = async (rows: PendingWrite[]) => {
    try {
      await real.putMany(rows);
      await shadow.remove(rows.map((r) => r.path));
    } catch (error) {
      await shadow.putMany(rows);
      throw error;
    }
  };
  const list = async () => {
    const [stored, memory] = await Promise.all([real.list().catch(() => [] as PendingChange[]), shadow.list()]);
    const merged = new Map(stored.map((r) => [r.path, r]));
    for (const row of memory)
      if (!merged.has(row.path) || row.updatedAt >= merged.get(row.path)!.updatedAt) merged.set(row.path, row);
    return [...merged.values()].toSorted(byPath);
  };
  return {
    list,
    get: async (path) => (await list()).find((r) => r.path === path),
    put: (change) => putMany([change]),
    putMany,
    remove: async (paths) => {
      await shadow.remove(paths);
      await real.remove(paths);
    },
    removeIf: async (path, updatedAt) => {
      await shadow.removeIf(path, updatedAt);
      await real.removeIf(path, updatedAt);
    },
    clear: async () => {
      await shadow.clear();
      await real.clear();
    },
  };
}

/** The buffer of unsaved changes of one scope, over the cache's pending queue. */
export function changesStore(cache: GitHubCache, scope: string): ChangesStore {
  const queue = withShadow(cache, scope);
  const write = (paths: string[], task: () => Promise<void>, on = scope) =>
    serial(cache, async () => {
      try {
        await task();
      } finally {
        // Also when the database refused (the memory shadow may have changed): readers look again.
        post({ scope: on, paths, tab: TAB_ID });
      }
    });
  return {
    scope,
    queue,
    cache,
    persistent: cache.persistent,
    writeEntry: (row, images = []) =>
      write([row.path, ...images.map((i) => i.path)], () => queue.putMany([row, ...images])),
    removeEntry: (path) => write([path], () => queue.remove([path])),
    removeIf: (path, updatedAt) => write([path], () => queue.removeIf(path, updatedAt)),
    pruneImages: (schema) =>
      serial(cache, async () => {
        const rows = await queue.list();
        // A row of a newer format (or of a collection that left the schema) may reference images this admin cannot see:
        // nothing is pruned then.
        if (rows.some((r) => (r.v ?? 1) > 1 || (isEntryLike(schema, r.path) && !isEntryRow(schema, r.path)))) return;
        const used = new Set<string>();
        for (const row of rows) {
          const at = parseEntryPath(schema, row.path);
          const def = at ? schema.collections[at.collection] : undefined;
          if (!def || typeof row.content !== 'string') continue;
          try {
            const file = parseEntryFile(row.content);
            for (const p of referencedAssets(schema, def, row.path, file.data, file.body)) used.add(p);
          } catch {
            // A row that does not parse references nothing.
          }
        }
        const unused = rows.filter((r) => isImagePath(r.path) && !isEntryRow(schema, r.path) && !used.has(r.path));
        if (unused.length === 0) return;
        await queue.remove(unused.map((r) => r.path));
        post({ scope, paths: unused.map((r) => r.path), tab: TAB_ID });
      }),
    read: () => serial(cache, () => queue.list()),
    clearAll: () =>
      serial(cache, async () => {
        const paths = (await queue.list()).map((r) => r.path);
        await queue.clear();
        post({ scope, paths, tab: TAB_ID });
      }),
    moveScope: (from, to) =>
      serial(cache, async () => {
        const rows = await cache.pending(from).list();
        if (rows.length === 0) return;
        await cache.pending(to).putMany(rows.map(({ updatedAt: _, ...row }) => row));
        await cache.pending(from).remove(rows.map((r) => r.path));
        const paths = rows.map((r) => r.path);
        post({ scope: from, paths, tab: TAB_ID });
        post({ scope: to, paths, tab: TAB_ID });
      }),
  };
}

const localCaches = new WeakMap<QueryClient, GitHubCache>();
/**
 * Dev mode's cache: one per app, that is per query client (the database `editlet-github`, as GitHub mode's), opened on
 * first use. Without IndexedDB it is a memory cache, so each app (and each test) starts empty.
 */
export function localChangesCache(client: QueryClient): GitHubCache {
  let cache = localCaches.get(client);
  if (!cache) localCaches.set(client, (cache = openGitHubCache()));
  return cache;
}
/** Tests: dev mode's cache of this query client. */
export function setLocalChangesCache(client: QueryClient, cache: GitHubCache) {
  localCaches.set(client, cache);
}

/**
 * The dev server's git state (`status/localGit.ts`, the one `['local-git']` query): the project id and the branch for
 * dev mode's scope. `null` while it loads; the default project without a branch after it failed.
 */
function useLocalGitState(enabled: boolean): { project: string; branch: string | null } | null {
  const git = useLocalGitQuery(enabled);
  const now = git.data
    ? { project: git.data.project, branch: git.data.branch }
    : git.isError
      ? { project: 'default', branch: null }
      : null;
  // A poll that fails puts a query without data back to pending for a moment: the scope must not flap to `null`.
  const last = useRef(now);
  if (now) last.current = now;
  return now ?? last.current;
}

/** Dev mode's scope: the project (a hash of its root) and the checked-out branch (`-` without one). */
export const localScope = (project: string, branch: string | null) => `local:${project}#${branch ?? '-'}`;

/**
 * The buffer of the active scope: GitHub mode's active branch (`source.pending` of the workspace's source), dev mode's
 * project and git branch. `null` in dev mode until the dev server's git state is known.
 */
export function useChangesStore(): ChangesStore | null {
  const source = useSource();
  const client = useQueryClient();
  // A GitHub source carries its cache; any other source (dev, memory) buffers in dev mode's cache.
  const github = source.kind === 'github' && 'cache' in source ? (source as GitHubSource) : null;
  const local = useLocalGitState(github === null);
  const scope = github
    ? `${github.owner}/${github.repo}#${github.branch}`
    : local
      ? localScope(local.project, local.branch)
      : null;
  const cache = github ? github.cache : null;
  return useMemo(
    () => (scope === null ? null : changesStore(cache ?? localChangesCache(client), scope)),
    [cache, scope, client],
  );
}
