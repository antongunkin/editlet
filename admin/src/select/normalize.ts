/** Text in a comparable form and, for each of its characters, the index of the original character it came from. */
export type Normalized = { text: string; map: number[] };

const REPLACE: Record<string, string> = {
  ' ': ' ',
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '′': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '″': '"',
  '«': '"',
  '»': '"',
  '‐': '-',
  '‑': '-',
  '‒': '-',
  '–': '-',
  '—': '-',
  '−': '-',
  '…': '...',
};
/** Soft hyphen and zero-width characters: invisible on the page, dropped. */
const DROP = /[­​-‍⁠﻿]/;

/**
 * What the page shows and what the field holds, made comparable: whitespace runs become one space, typographic quotes,
 * dashes and the ellipsis become ASCII, invisible characters go, and case is folded (CSS `text-transform` changes how
 * the page reads, not its text, but authors also type in other cases).
 */
export function normalize(input: string): Normalized {
  let text = '';
  const map: number[] = [];
  let space = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (DROP.test(c)) continue;
    const r = REPLACE[c] ?? c;
    if (/\s/.test(r)) {
      if (!space) {
        text += ' ';
        map.push(i);
      }
      space = true;
      continue;
    }
    space = false;
    for (const out of r.toLowerCase()) {
      text += out;
      map.push(i);
    }
  }
  return { text, map };
}
