import search from 'approx-string-match';

import { normalize } from './normalize';

/** A field's text as the page would show it, and how to select a range of it in the form. */
export type Projection = {
  text: string;
  /** Select `[start, end)` of `text` in the field (focus, scroll, selection). */
  select(start: number, end: number): void;
};

export type Candidate = { key: string; projection: Projection };

export type Quote = { quote: string; prefix: string; suffix: string };

export type Hit = { key: string; start: number; end: number };

/** Most errors a fuzzy match may have, as a share of the quote's length. */
const MAX_ERROR_SHARE = 0.15;

/** How many characters of `a`'s end equal `b`'s end (compared backwards). */
function commonEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

type Scored = { key: string; start: number; end: number; score: number; map: number[] };

/** The one best of `hits` by score; `null` when there is none or the best is tied. */
function best(hits: Scored[]): Scored | null {
  if (hits.length === 0) return null;
  const sorted = hits.toSorted((a, b) => b.score - a.score);
  return sorted.length > 1 && sorted[0]!.score === sorted[1]!.score ? null : sorted[0]!;
}

/**
 * Where `quote` is in the candidates' text: exact matches first (repeats told apart by how much of the prefix and
 * suffix agree), else a fuzzy match (Myers, at most 15 % errors). Only a single or clearly best match is returned:
 * "not found" is better than the wrong field.
 */
export function findQuote(candidates: Candidate[], { quote, prefix, suffix }: Quote): Hit | null {
  const q = normalize(quote).text.trim();
  if (q === '') return null;
  const pre = normalize(prefix).text;
  const suf = normalize(suffix).text;
  const toHit = (c: Candidate, map: number[], s: number, e: number) => ({
    key: c.key,
    start: map[s]!,
    end: map[e - 1]! + 1,
  });

  const exact: Scored[] = [];
  const texts = candidates.map((c) => normalize(c.projection.text));
  candidates.forEach((c, i) => {
    const { text, map } = texts[i]!;
    for (let at = text.indexOf(q); at !== -1; at = text.indexOf(q, at + 1)) {
      const score = commonEnd(text.slice(0, at), pre) + commonStart(text.slice(at + q.length), suf);
      exact.push({ key: c.key, start: at, end: at + q.length, score, map });
    }
  });
  if (exact.length > 0) {
    const top = best(exact);
    if (!top) return null;
    const c = candidates.find((x) => x.key === top.key)!;
    return toHit(c, top.map, top.start, top.end);
  }

  const maxErrors = Math.floor(q.length * MAX_ERROR_SHARE);
  if (maxErrors === 0) return null;
  const fuzzy: Scored[] = [];
  candidates.forEach((c, i) => {
    const { text, map } = texts[i]!;
    // The search reports every end of an equally good match: keep one per overlapping run.
    let last = -1;
    for (const m of search(text, q, maxErrors).toSorted((a, b) => a.start - b.start || a.errors - b.errors)) {
      if (m.start < last) continue;
      fuzzy.push({ key: c.key, start: m.start, end: m.end, score: -m.errors, map });
      last = m.end;
    }
  });
  const top = best(fuzzy);
  if (!top || top.end <= top.start) return null;
  const c = candidates.find((x) => x.key === top.key)!;
  return toHit(c, top.map, top.start, top.end);
}
