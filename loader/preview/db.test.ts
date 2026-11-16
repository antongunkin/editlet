// @vitest-environment node
// Node env: fake-indexeddb's structured clone cannot carry a jsdom Blob (it comes back as {}), a test-env artifact.
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { announceSnapshot, clearSnapshot, readPreviewFlag, readSnapshot, setPreviewFlag, writeSnapshot } from './db';

import { PREVIEW_DB, PREVIEW_FLAG_KEY, PREVIEW_KEY, PREVIEW_STORE, type PreviewSnapshot } from '../protocol';

const snapshot = (): PreviewSnapshot => ({
  v: 1,
  branch: 'editlet/x',
  expiresAt: Date.now() + 60_000,
  entries: {
    'post/hello': {
      title: { text: { from: 'Hello', to: 'Hi' } },
      cover: { image: { from: 'post/hello/cover.webp', to: new Blob(['pixels']), alt: { from: 'a', to: 'b' } } },
      body: { stale: true },
    },
  },
});

function throwingStorage(): Storage {
  const boom = () => {
    throw new DOMException('denied', 'SecurityError');
  };
  return { getItem: boom, setItem: boom, removeItem: boom } as unknown as Storage;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  } as unknown as Storage;
}

afterEach(() => vi.unstubAllGlobals());

describe('preview snapshot storage', () => {
  it('round-trips a snapshot with a Blob', async () => {
    const idb = new IDBFactory();
    await writeSnapshot(snapshot(), idb);
    const got = await readSnapshot(idb);
    expect(got?.branch).toBe('editlet/x');
    const v = got?.entries['post/hello']?.cover;
    expect(v && 'image' in v && v.image.to instanceof Blob).toBe(true);
    if (v && 'image' in v) expect(await new Response(v.image.to).text()).toBe('pixels');
  });

  it('clearSnapshot leaves null', async () => {
    const idb = new IDBFactory();
    await writeSnapshot(snapshot(), idb);
    await clearSnapshot(idb);
    expect(await readSnapshot(idb)).toBeNull();
  });

  it('readSnapshot resolves null without indexedDB', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await readSnapshot()).toBeNull();
  });

  it('readSnapshot ignores an invalid stored value', async () => {
    const idb = new IDBFactory();
    await new Promise<void>((resolve, reject) => {
      const open = idb.open(PREVIEW_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(PREVIEW_STORE);
      open.onsuccess = () => {
        const tx = open.result.transaction(PREVIEW_STORE, 'readwrite');
        tx.objectStore(PREVIEW_STORE).put({ v: 9 }, PREVIEW_KEY);
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
    });
    expect(await readSnapshot(idb)).toBeNull();
  });
});

describe('preview flag', () => {
  it('swallows storage errors', () => {
    const s = throwingStorage();
    expect(readPreviewFlag(s)).toBeNull();
    expect(() => setPreviewFlag('editlet/x', s)).not.toThrow();
  });

  it('sets, reads and removes the key', () => {
    const s = memoryStorage();
    setPreviewFlag('editlet/x', s);
    expect(readPreviewFlag(s)).toBe('editlet/x');
    setPreviewFlag(null, s);
    expect(s.getItem(PREVIEW_FLAG_KEY)).toBeNull();
  });
});

describe('announceSnapshot', () => {
  it('is a no-op without BroadcastChannel', () => {
    vi.stubGlobal('BroadcastChannel', undefined);
    expect(() => announceSnapshot()).not.toThrow();
  });

  it('posts a snapshot message and closes', () => {
    const post = vi.fn();
    const close = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage = post;
        close = close;
      },
    );
    announceSnapshot();
    expect(post).toHaveBeenCalledWith({ source: 'editlet', type: 'snapshot' });
    expect(close).toHaveBeenCalled();
  });
});
