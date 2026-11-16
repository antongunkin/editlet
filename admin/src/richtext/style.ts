/** The remark-stringify options that match a body's own style, so a rewritten block looks like its neighbours. */
export type MarkdownStyle = {
  bullet: '-' | '*' | '+';
  emphasis: '*' | '_';
  strong: '*' | '_';
  fence: '`' | '~';
  rule: '-' | '*' | '_';
};

/** Strips fenced code so markers inside code samples do not count. */
const withoutCode = (text: string) => text.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, '');

const RULE = { '-': /^ {0,3}(-\s*){3,}$/gm, '*': /^ {0,3}(\*\s*){3,}$/gm, _: /^ {0,3}(_\s*){3,}$/gm };

/** The value in `counts` with the highest count; `fallback` on a tie with it or when all are zero. */
function most<T extends string>(counts: Record<T, number>, fallback: NoInfer<T>): T {
  let best = fallback;
  for (const [k, n] of Object.entries(counts) as [T, number][]) if (n > counts[best]) best = k;
  return best;
}

/**
 * Picks the most common bullet, emphasis, strong, fence and thematic-break markers in `markdown`; the CommonMark
 * defaults (`-`, `*`, `**`, backticks, `---`) when there is none.
 */
export function markdownStyle(markdown: string): MarkdownStyle {
  const code = withoutCode(markdown);
  // Thematic breaks (`***`, `___`) would count as list and emphasis markers.
  const text = code.replace(RULE['-'], '').replace(RULE['*'], '').replace(RULE._, '');
  const count = (re: RegExp, within = text) => (within.match(re) ?? []).length;
  const fences = (markdown.match(/^ {0,3}(`{3,}|~{3,})/gm) ?? []).map((f) => f.trim()[0]);
  return {
    bullet: most({ '-': count(/^\s*- /gm), '*': count(/^\s*\* /gm), '+': count(/^\s*\+ /gm) }, '-'),
    emphasis: most({ '*': count(/(?<![*\w])\*(?!\*)\S/g), _: count(/(?<![_\w])_(?!_)\S/g) }, '*'),
    strong: most({ '*': count(/\*\*\S/g), _: count(/__\S/g) }, '*'),
    fence: most({ '`': fences.filter((c) => c === '`').length, '~': fences.filter((c) => c === '~').length }, '`'),
    rule: most({ '-': count(RULE['-'], code), '*': count(RULE['*'], code), _: count(RULE._, code) }, '-'),
  };
}
