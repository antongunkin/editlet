import type { Node as PmNode } from '@milkdown/prose/model';

/** A projection's text with, for each character, where it is in the field (a source offset or an editor position). */
export type Mapped = { text: string; at: number[] };

type MdNode = {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** Blocks that start on a new line in the projection. */
const BLOCKS = new Set([
  'paragraph',
  'heading',
  'code',
  'listItem',
  'tableCell',
  'blockquote',
  'thematicBreak',
  'html',
]);

/**
 * Where each character of `value` is in `source[from, to)`: the next equal source character, so markup the value does
 * not have (backslash escapes, entities, code fences, backticks) is skipped. A character with no match keeps the last
 * place.
 */
function align(source: string, from: number, to: number, value: string): number[] {
  const out: number[] = [];
  let j = from;
  for (const c of value) {
    const k = source.indexOf(c, j);
    if (k !== -1 && k < to) {
      out.push(k);
      j = k + 1;
    } else out.push(Math.min(j, to - 1));
  }
  return out;
}

/**
 * The text a markdown body shows (text, inline code and code, one line per block, no markup), with each character's
 * offset in the source. mdast is loaded on first use.
 */
export async function projectMarkdown(source: string): Promise<Mapped> {
  const [{ fromMarkdown }, { gfm }, { gfmFromMarkdown }] = await Promise.all([
    import('mdast-util-from-markdown'),
    import('micromark-extension-gfm'),
    import('mdast-util-gfm'),
  ]);
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] }) as MdNode;
  let text = '';
  const at: number[] = [];
  const walk = (node: MdNode) => {
    if (BLOCKS.has(node.type) && text !== '' && !text.endsWith('\n')) {
      text += '\n';
      at.push(node.position?.start.offset ?? at.at(-1) ?? 0);
    }
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if ((node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') && node.value !== undefined) {
      if (start === undefined || end === undefined) return;
      // A fenced block's value starts after the fence line.
      const from =
        node.type === 'code' && /^\s*(`{3,}|~{3,})/.test(source.slice(start)) ? source.indexOf('\n', start) + 1 : start;
      text += node.value;
      at.push(...align(source, from, end, node.value));
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree);
  return { text, at };
}

/** The text of a ProseMirror document, one line per textblock, with each character's document position. */
export function projectDoc(doc: PmNode): Mapped {
  let text = '';
  const at: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock && text !== '' && !text.endsWith('\n')) {
      text += '\n';
      at.push(pos);
    }
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) at.push(pos + i);
      text += node.text;
    }
    return true;
  });
  return { text, at };
}

/** Selects `[start, end)` of a projection in an `<input>` or `<textarea>` (offsets into its value). */
export function selectInControl(el: HTMLInputElement | HTMLTextAreaElement, start: number, end: number): void {
  el.focus({ preventScroll: true });
  el.setSelectionRange(start, end);
  el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
}
