import { useEffect, useRef, useState } from 'react';

import { findQuote, type Candidate, type Projection } from './match';
import { selectInControl } from './project';
import { useSelectRequest } from './SelectProvider';

import type { Collection } from '../../../core/schema';

/** A field that projects itself (the markdown body); `null` while it is not ready (the rich editor loading). */
export type SelectTarget = () => Projection | null | Promise<Projection | null>;

export type SelectNotice = { found: boolean; text: string };

const READY_TRIES = 30;
const READY_MS = 100;
const NOTICE_MS = 6000;

/** Text inputs and textareas of the form: their value is what the page shows. */
function controlCandidates(collection: Collection, values: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  for (const [key, field] of Object.entries(collection.fields)) {
    const plain = (field.type === 'string' && !field.list) || field.type === 'text' || field.type === 'url';
    const value = values[key];
    if (!plain || typeof value !== 'string' || value === '') continue;
    out.push({
      key,
      projection: {
        text: value,
        select(start, end) {
          const el = document.getElementById(key);
          if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) selectInControl(el, start, end);
        },
      },
    });
  }
  return out;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `get` until it gives a value (a field's modal mounting, the rich editor loading), or gives up. */
async function until<T>(get: () => T | null | undefined | Promise<T | null | undefined>, run: { cancelled: boolean }) {
  for (let tries = 0; tries < READY_TRIES && !run.cancelled; tries++) {
    const value = await get();
    if (value) return value;
    await wait(READY_MS);
  }
  return null;
}

/**
 * Applies a select request for the entry `ref` once its form is up: finds the quote in the field the page marked, else
 * in every text field, else in the body. Each field is edited in its own modal (screens/FieldSheet.tsx), so the hit is
 * opened first (`open`), then the words are selected in it. The body projects itself only while its modal is open:
 * it is opened to be searched, and closed again when the quote is not in it. Returns the notice to show.
 */
export function useApplySelect(
  ref: string,
  collection: Collection,
  values: () => Record<string, unknown>,
  targets: Map<string, SelectTarget>,
  open: (key: string | null) => void,
  /** The fields that project themselves when mounted (the markdown body), in the order to search them. */
  ownKeys: string[],
  /** The field whose modal is open now: put back when the quote is nowhere. */
  openKey: () => string | null = () => null,
  /**
   * Called before the body is searched; what it returns runs when the quote is nowhere (the entry screen puts its
   * field-group tab back: opening the body to search it chose the body's tab).
   */
  snapshot: () => () => void = () => () => {},
): { notice: SelectNotice | null; dismiss(): void } {
  const { request, finish } = useSelectRequest();
  const [notice, setNotice] = useState<SelectNotice | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const openRef = useRef(open);
  openRef.current = open;
  const ownRef = useRef(ownKeys);
  ownRef.current = ownKeys;
  const openKeyRef = useRef(openKey);
  openKeyRef.current = openKey;
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!request || request.entry !== ref) return;
    const run = { cancelled: false };
    const found = (key: string) => {
      const label = collection.fields[key]?.label ?? 'Body';
      setNotice({ found: true, text: `Selected in ${label}` });
    };
    void (async () => {
      const plain = controlCandidates(collection, valuesRef.current());
      const marked = plain.filter((c) => c.key === request.field);
      const hit = (marked.length > 0 ? findQuote(marked, request) : null) ?? findQuote(plain, request);
      if (hit) {
        // `finish` ends the request, which re-runs this effect and cancels this run: only once the words are selected.
        openRef.current(hit.key);
        // The modal puts the focus on itself as it opens: select once it has, or the selection loses the focus to it.
        const el = await until(() => {
          const control = document.getElementById(hit.key);
          const modal = control?.closest('[role="dialog"]');
          return control && (!modal || modal.contains(document.activeElement)) ? control : null;
        }, run);
        if (run.cancelled) return;
        if (el) plain.find((c) => c.key === hit.key)!.projection.select(hit.start, hit.end);
        finish(request.id);
        found(hit.key);
        return;
      }
      const own = ownRef.current.toSorted((a, b) => Number(b === request.field) - Number(a === request.field));
      // The modal the editor had open comes back when the quote is nowhere (the search opens the body's to read it).
      const before = openKeyRef.current();
      const restore = snapshotRef.current();
      for (const key of own) {
        openRef.current(key);
        const projection = await until(async () => (await targets.get(key)?.()) ?? null, run);
        if (run.cancelled) return;
        const inBody = projection ? findQuote([{ key, projection }], request) : null;
        if (inBody && projection) {
          finish(request.id);
          projection.select(inBody.start, inBody.end);
          found(key);
          return;
        }
      }
      finish(request.id);
      openRef.current(before);
      restore();
      setNotice({ found: false, text: "Couldn't find the selected text in this entry" });
    })();
    return () => {
      run.cancelled = true;
    };
  }, [request, ref, collection, targets, finish]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return { notice, dismiss: () => setNotice(null) };
}
