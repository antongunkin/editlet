// Image values need a real Blob, which fake-indexeddb cannot store (see db.test.ts): `readSnapshot` is stubbed here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startOverlay } from './overlay';

import type { PreviewSnapshot } from '../protocol';

const h = vi.hoisted(() => ({ snapshot: null as PreviewSnapshot | null }));

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  readSnapshot: async () => h.snapshot,
}));

const img = () => document.querySelector('img')!;

let win: Window;

beforeEach(() => {
  document.body.innerHTML = '<article data-editlet-entry="post/a"><img src="/m/cover.webp" alt="Cover"></article>';
  h.snapshot = {
    v: 1,
    branch: 'editlet/x',
    expiresAt: Date.now() + 60_000,
    entries: {
      'post/a': { cover: { image: { from: 'cover.webp', to: new Blob(['x']), alt: { from: 'Cover', to: 'New' } } } },
    },
  };
  win = {
    document,
    localStorage,
    location: { reload: vi.fn() },
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
    requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0),
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    MutationObserver,
    BroadcastChannel: class {
      addEventListener() {}
      close() {}
    },
    URL: { createObjectURL: () => 'blob:new', revokeObjectURL: () => {} },
  } as unknown as Window;
});

afterEach(() => localStorage.clear());

describe('startOverlay: image attributes', () => {
  it('re-applies a patched img src the page reverts', async () => {
    const o = startOverlay({ win });
    await o.ready;
    expect(img().getAttribute('src')).toBe('blob:new');
    expect(img().getAttribute('alt')).toBe('New');

    img().setAttribute('src', '/m/cover.webp');
    await vi.waitFor(() => expect(img().getAttribute('src')).toBe('blob:new'));
    img().setAttribute('alt', 'Cover');
    await vi.waitFor(() => expect(img().getAttribute('alt')).toBe('New'));
    o.stop();
    expect(img().getAttribute('src')).toBe('/m/cover.webp');
  });
});
