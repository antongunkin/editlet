// Private channel between the admin (inside the iframe) and the site page (window.js, and preview.js for the preview
// state): the admin draws the window chrome, window.js owns the dialog's geometry. Both ship in the same admin dist, so this is not part of the frozen
// loader protocol (the loader ignores these messages: `isAdminToSiteMessage` rejects the unknown `source`).

import { EDGES, type Gesture } from './geometry';

export const WINDOW_SOURCE = 'editlet-window' as const;

/**
 * Admin → site page. `hello`: the admin mounted (the preview overlay answers with its state). `drag` → window.js: `kind`
 * is `move` or the edge or corner being pulled; deltas are screen pixels since `phase: 'start'`, so they survive the
 * window moving. `edge` → window.js: the pointer entered (`hover: true`) or left a resize edge, so the window's outline
 * lights up. `collapse` → window.js: shrink the dialog to a pill of `w`×`h` px at the bottom centre; `expand`: back to the
 * window.
 */
export type AdminToWindowMessage =
  | { source: typeof WINDOW_SOURCE; type: 'hello' }
  | { source: typeof WINDOW_SOURCE; type: 'collapse'; w: number; h: number }
  | { source: typeof WINDOW_SOURCE; type: 'expand' }
  | { source: typeof WINDOW_SOURCE; type: 'edge'; hover: boolean }
  | {
      source: typeof WINDOW_SOURCE;
      type: 'drag';
      kind: Gesture;
      phase: 'start' | 'move' | 'end';
      dx: number;
      dy: number;
    };

/** A message without its `source` (distributes over the union, so `Omit` keeps each variant's fields). */
export type WindowBody<T> = T extends unknown ? Omit<T, 'source'> : never;

/** What the live-preview overlay reports about the page (see loader/preview/overlay.ts). */
export type PreviewState = { branch: string; patched: number; pending: number };

/** Overlay → admin: the preview state (`null`: no preview), for the window's status bar. */
export type PreviewToAdminMessage = { source: typeof WINDOW_SOURCE; type: 'preview'; state: PreviewState | null };

/** Admin → overlay: the editor pressed Exit in the status bar. */
export type AdminToPreviewMessage = { source: typeof WINDOW_SOURCE; type: 'preview-exit' };

/**
 * window.js → admin: the editor pressed **Edit** next to a selection on the page. `entry` is `<collection>/<slug>` from
 * the nearest `data-editlet-entry` (or the `data-editlet-field` mark); `field` the field key when a `data-editlet-field`
 * mark encloses the selection. `quote` is the selected text, `prefix` and `suffix` up to 32 characters of the entry's
 * text around it (to tell repeats apart).
 */
export type SelectMessage = {
  source: typeof WINDOW_SOURCE;
  type: 'select';
  entry: string;
  field?: string;
  quote: string;
  prefix: string;
  suffix: string;
};

const isObject = (data: unknown): data is Record<string, unknown> => typeof data === 'object' && data !== null;
const isSize = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function isAdminToWindowMessage(data: unknown): data is AdminToWindowMessage {
  if (!isObject(data) || data.source !== WINDOW_SOURCE) return false;
  switch (data.type) {
    case 'hello':
    case 'expand':
      return true;
    case 'collapse':
      return isSize(data.w) && isSize(data.h);
    case 'edge':
      return typeof data.hover === 'boolean';
    case 'drag':
      return (
        (data.kind === 'move' || (EDGES as readonly unknown[]).includes(data.kind)) &&
        (data.phase === 'start' || data.phase === 'move' || data.phase === 'end') &&
        Number.isFinite(data.dx) &&
        Number.isFinite(data.dy)
      );
    default:
      return false;
  }
}

export function isPreviewToAdminMessage(data: unknown): data is PreviewToAdminMessage {
  if (!isObject(data) || data.source !== WINDOW_SOURCE || data.type !== 'preview') return false;
  const s = data.state;
  return (
    s === null ||
    (isObject(s) && typeof s.branch === 'string' && Number.isFinite(s.patched) && Number.isFinite(s.pending))
  );
}

export function isAdminToPreviewMessage(data: unknown): data is AdminToPreviewMessage {
  return isObject(data) && data.source === WINDOW_SOURCE && data.type === 'preview-exit';
}

export function isSelectMessage(data: unknown): data is SelectMessage {
  return (
    isObject(data) &&
    data.source === WINDOW_SOURCE &&
    data.type === 'select' &&
    typeof data.entry === 'string' &&
    data.entry !== '' &&
    (data.field === undefined || typeof data.field === 'string') &&
    typeof data.quote === 'string' &&
    data.quote.trim() !== '' &&
    typeof data.prefix === 'string' &&
    typeof data.suffix === 'string'
  );
}
