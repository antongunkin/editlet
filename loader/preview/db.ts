// Preview snapshot storage (IndexedDB) and the preview flag (localStorage). Best-effort: every failure degrades to
// "no preview". Raw IndexedDB, no dependencies; shared by the page overlay and the admin, not by the loader itself.
import {
  EDITLET_SOURCE,
  isPreviewSnapshot,
  PREVIEW_CHANNEL,
  PREVIEW_DB,
  PREVIEW_FLAG_KEY,
  PREVIEW_KEY,
  PREVIEW_STORE,
  type PreviewChannelMessage,
  type PreviewSnapshot,
} from '../protocol';

function defaultIdb(): IDBFactory | undefined {
  return typeof indexedDB === 'undefined' ? undefined : indexedDB;
}

function open(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(PREVIEW_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PREVIEW_STORE)) req.result.createObjectStore(PREVIEW_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

async function run<T>(
  idb: IDBFactory | undefined,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest | undefined,
): Promise<T | undefined> {
  if (!idb) return undefined;
  let db: IDBDatabase | undefined;
  try {
    db = await open(idb);
    const conn = db;
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = conn.transaction(PREVIEW_STORE, mode);
      const req = op(tx.objectStore(PREVIEW_STORE));
      tx.oncomplete = () => resolve(req?.result as T | undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

export async function readSnapshot(idb: IDBFactory | undefined = defaultIdb()): Promise<PreviewSnapshot | null> {
  const value = await run<unknown>(idb, 'readonly', (s) => s.get(PREVIEW_KEY));
  return isPreviewSnapshot(value) ? value : null;
}

export async function writeSnapshot(s: PreviewSnapshot, idb: IDBFactory | undefined = defaultIdb()): Promise<void> {
  await run(idb, 'readwrite', (store) => store.put(s, PREVIEW_KEY));
}

export async function clearSnapshot(idb: IDBFactory | undefined = defaultIdb()): Promise<void> {
  await run(idb, 'readwrite', (store) => store.delete(PREVIEW_KEY));
}

function defaultStorage(): Storage | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function readPreviewFlag(storage: Storage | undefined = defaultStorage()): string | null {
  try {
    return storage?.getItem(PREVIEW_FLAG_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setPreviewFlag(branch: string | null, storage: Storage | undefined = defaultStorage()): void {
  try {
    if (branch === null) storage?.removeItem(PREVIEW_FLAG_KEY);
    else storage?.setItem(PREVIEW_FLAG_KEY, branch);
  } catch {
    // Storage blocked: preview just will not persist.
  }
}

export function announceSnapshot(): void {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(PREVIEW_CHANNEL);
    const message: PreviewChannelMessage = { source: EDITLET_SOURCE, type: 'snapshot' };
    channel.postMessage(message);
    channel.close();
  } catch {
    // Best-effort.
  }
}
