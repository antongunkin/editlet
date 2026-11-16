import type { MarkType, Node, NodeType } from '@milkdown/prose/model';
import { NodeSelection, type EditorState, type Transaction } from '@milkdown/prose/state';

import { isSafeHref } from './links';

/** Whether the selection (or the stored marks at the cursor) has `type`. */
export function markActive(state: EditorState, type: MarkType | undefined): boolean {
  if (!type) return false;
  const { from, to, empty, $from } = state.selection;
  if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
  return state.doc.rangeHasMark(from, to, type);
}

/** Whether the selection is inside a node of `type` (the nearest one wins for lists). */
export function inNode(state: EditorState, type: NodeType | undefined): boolean {
  if (!type) return false;
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === type) return true;
  return false;
}

/** The kind of textblock the selection starts in: `paragraph`, `h1`…`h6`, `code` or `other`. */
export function blockKind(state: EditorState): string {
  const parent = state.selection.$from.parent;
  if (parent.type.name === 'heading') return `h${String(parent.attrs.level)}`;
  if (parent.type.name === 'paragraph') return 'paragraph';
  if (parent.type.name === 'code_block') return 'code';
  return 'other';
}

/** The link around the cursor or selection start: its href and range in the text node. */
export function linkAt(state: EditorState): { href: string; from: number; to: number } | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const { $from } = state.selection;
  const mark = type.isInSet($from.marks()) ?? type.isInSet($from.nodeAfter?.marks ?? []);
  if (!mark) return null;
  // Extend over the neighbouring text with the same link, both ways: the parts of `[to **the** docs](…)` are
  // separate text nodes, and the cursor can sit in any of them.
  const start = $from.start();
  const parts: { from: number; to: number }[] = [];
  $from.parent.forEach((child, offset) => {
    if (mark.isInSet(child.marks)) parts.push({ from: start + offset, to: start + offset + child.nodeSize });
  });
  let i = parts.findIndex((p) => p.from <= $from.pos && $from.pos <= p.to);
  if (i === -1) return null;
  let j = i;
  while (i > 0 && parts[i - 1]!.to === parts[i]!.from) i -= 1;
  while (j < parts.length - 1 && parts[j]!.to === parts[j + 1]!.from) j += 1;
  const from = parts[i]!.from;
  const to = parts[j]!.to;
  return { href: String(mark.attrs.href), from, to };
}

export type LinkInput = { href: string; text: string };

/**
 * Sets, changes or removes (empty `href`) the link on the selection or the link at the cursor. With an empty
 * selection and no link there, inserts `text` (or the URL) as a new link. `null` when the URL is not allowed.
 */
export function applyLink(state: EditorState, { href, text }: LinkInput): Transaction | null {
  const type = state.schema.marks.link;
  if (!type) return null;
  const url = href.trim();
  if (url !== '' && !isSafeHref(url)) return null;
  const existing = linkAt(state);
  const { from, to, empty } = state.selection;
  const range = existing && empty ? existing : { from, to };
  const tr = state.tr;
  if (url === '') return tr.removeMark(range.from, range.to, type);
  const mark = type.create({ href: url });
  if (empty && !existing) return tr.insert(from, state.schema.text(text.trim() || url, [mark]));
  return tr.removeMark(range.from, range.to, type).addMark(range.from, range.to, mark);
}

/** The selected image node and its position, when an image is selected. */
export function selectedImage(state: EditorState): { node: Node; pos: number } | null {
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') return { node: sel.node, pos: sel.from };
  return null;
}

/** Inserts an image at the selection, or changes the selected one. */
export function applyImage(state: EditorState, attrs: { src: string; alt: string }): Transaction | null {
  const type = state.schema.nodes.image;
  if (!type || !isSafeHref(attrs.src)) return null;
  const selected = selectedImage(state);
  if (selected) return state.tr.setNodeMarkup(selected.pos, undefined, { ...selected.node.attrs, ...attrs });
  return state.tr.replaceSelectionWith(type.create({ src: attrs.src, alt: attrs.alt, title: '' }));
}
