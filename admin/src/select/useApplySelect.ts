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

/**
 * Applies a select request for the entry `ref` once its form is up: finds the quote in the field the page marked, else
 * in every text field and the body, then focuses that field and selects the words. Returns the notice to show.
 */
export function useApplySelect(
  ref: string,
  collection: Collection,
  values: () => Record<string, unknown>,
  targets: Map<string, SelectTarget>,
): { notice: SelectNotice | null; dismiss(): void } {
  const { request, finish } = useSelectRequest();
  const [notice, setNotice] = useState<SelectNotice | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    if (!request || request.entry !== ref) return;
    const run = { cancelled: false };
    void (async () => {
      let candidates: Candidate[] = [];
      for (let tries = 0; tries < READY_TRIES && !run.cancelled; tries++) {
        const own = await Promise.all([...targets].map(async ([key, target]) => ({ key, projection: await target() })));
        if (own.every((c) => c.projection) || tries === READY_TRIES - 1) {
          candidates = [
            ...controlCandidates(collection, valuesRef.current()),
            ...own.filter((c): c is Candidate => c.projection !== null),
          ];
          break;
        }
        await wait(READY_MS);
      }
      if (run.cancelled) return;
      const marked = candidates.filter((c) => c.key === request.field);
      const hit = (marked.length > 0 ? findQuote(marked, request) : null) ?? findQuote(candidates, request);
      finish(request.id);
      if (!hit) {
        setNotice({ found: false, text: "Couldn't find the selected text in this entry" });
        return;
      }
      candidates.find((c) => c.key === hit.key)!.projection.select(hit.start, hit.end);
      const label = collection.fields[hit.key]?.label ?? 'Body';
      setNotice({ found: true, text: `Selected in ${label}` });
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
