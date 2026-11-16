import type { ImageSlotHost } from './editor';

export type ImageSlot = { id: number; dom: HTMLElement; src: string; alt: string };

/**
 * The image node views' DOM elements, for React to render a preview into each one (a portal). The editor adds,
 * updates and removes slots; React subscribes (`useSyncExternalStore`).
 */
export function createImageSlots(): ImageSlotHost & {
  subscribe(listener: () => void): () => void;
  snapshot(): readonly ImageSlot[];
} {
  let slots: readonly ImageSlot[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: readonly ImageSlot[]) => {
    slots = next;
    for (const l of listeners) l();
  };
  return {
    add(dom, src, alt) {
      const id = nextId++;
      set([...slots, { id, dom, src, alt }]);
      return id;
    },
    update(id, src, alt) {
      const slot = slots.find((s) => s.id === id);
      if (slot && (slot.src !== src || slot.alt !== alt)) set(slots.map((s) => (s.id === id ? { ...s, src, alt } : s)));
    },
    remove(id) {
      set(slots.filter((s) => s.id !== id));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => slots,
  };
}
