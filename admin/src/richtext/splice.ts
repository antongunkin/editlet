import type { Node, Schema } from '@milkdown/prose/model';

/** The markdown tools of one Milkdown editor (its schema, remark and transformers), see `codecFrom`. */
export type Codec = {
  schema: Schema;
  /** Markdown → mdast root after Milkdown's remark plugins (positions are offsets into `markdown`). */
  tree(markdown: string): MdRoot;
  /** Top-level mdast nodes → the ProseMirror nodes Milkdown makes of them. */
  toNodes(children: MdNode[]): Node[];
  /** ProseMirror block nodes → markdown (Milkdown's serializer). */
  toMarkdown(nodes: Node[]): string;
};

export type MdNode = {
  type: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  [key: string]: unknown;
};
export type MdRoot = { type: 'root'; children: MdNode[] };

/** The node type of a block kept as text (raw HTML, definitions, anything the editor would not keep exactly). */
export const RAW_NODE = 'editlet_raw';

export type Block = {
  /** The block's exact source text. */
  source: string;
  /** The ProseMirror node made of it (a raw node when `raw`). */
  node: Node;
  raw: boolean;
};

export type Loaded = {
  source: string;
  doc: Node;
  blocks: Block[];
  /** `seps[i]` is the source text before `blocks[i]`; `seps[blocks.length]` the text after the last block. */
  seps: string[];
};

/** An mdast tree without positions and data, for comparing what two pieces of markdown mean. */
function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (typeof node !== 'object' || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'position' || k === 'data' || v === undefined || v === null) continue;
    out[k] = strip(v);
  }
  return out;
}

const sameTree = (a: unknown, b: unknown) => JSON.stringify(strip(a)) === JSON.stringify(strip(b));

const rawNode = (schema: Schema, text: string) => schema.nodes[RAW_NODE]!.create({ text });

/**
 * A rich node for one top-level mdast block, or `null` when the editor cannot keep it exactly: HTML, a block that
 * does not become exactly one node, or one whose markdown, written back, means something else (a lost definition,
 * code fence meta, footnotes…).
 */
const hasHtml = (node: MdNode): boolean => node.type === 'html' || (node.children ?? []).some(hasHtml);

function richNode(codec: Codec, child: MdNode): Node | null {
  // Raw HTML (Milkdown wraps a block of it in a paragraph) is edited as text, never rendered in the admin.
  if (hasHtml(child)) return null;
  const nodes = codec.toNodes([child]);
  if (nodes.length !== 1) return null;
  const again = codec.tree(codec.toMarkdown(nodes)).children;
  return sameTree(again, [child]) ? nodes[0]! : null;
}

/** Start of the line that holds `i`. */
const lineStart = (text: string, i: number) => text.lastIndexOf('\n', i - 1) + 1;

/**
 * Splits `source` into top-level blocks with the text between them, and makes a ProseMirror document of them. Text
 * the parser drops (link definitions) and blocks the editor cannot keep become raw blocks, edited as text. Throws when
 * the parser fails.
 */
export function loadMarkdown(codec: Codec, source: string): Loaded {
  const { schema } = codec;
  const blocks: Block[] = [];
  const seps: string[] = [];
  let cursor = 0;
  const push = (sepEnd: number, start: number, end: number, node: Node | null) => {
    const text = source.slice(start, end);
    seps.push(source.slice(cursor, sepEnd));
    blocks.push(node ? { source: text, node, raw: false } : { source: text, node: rawNode(schema, text), raw: true });
    cursor = end;
  };
  /** Text between blocks that is not just whitespace (dropped by the parser) is kept as a raw block. */
  const gap = (until: number) => {
    const between = source.slice(cursor, until);
    const first = between.search(/\S/);
    if (first === -1) return;
    const start = lineStart(source, cursor + first);
    const end = cursor + between.trimEnd().length;
    push(Math.max(start, cursor), Math.max(start, cursor), end, null);
  };

  for (const child of codec.tree(source).children) {
    const start = child.position?.start.offset;
    const end = child.position?.end.offset;
    if (start === undefined || end === undefined || start < cursor) continue;
    gap(start);
    push(start, start, end, richNode(codec, child));
  }
  gap(source.length);
  seps.push(source.slice(cursor));

  const content = blocks.length > 0 ? blocks.map((b) => b.node) : [schema.nodes.paragraph!.create()];
  return { source, doc: schema.topNodeType.create(null, content), blocks, seps };
}

/** Share of blocks kept as raw text; the field falls back to Source when it is too high. */
export const rawShare = (loaded: Loaded) =>
  loaded.blocks.length === 0 ? 0 : loaded.blocks.filter((b) => b.raw).length / loaded.blocks.length;

/**
 * The markdown for `doc`. Unchanged blocks are their source text, byte for byte, with the original text between
 * neighbours that are still neighbours; only changed or new blocks are written by the serializer. A document equal to
 * the loaded one (no edits, or all of them undone) is the source unchanged.
 */
export function saveMarkdown(codec: Codec, loaded: Loaded, doc: Node): string {
  if (doc.eq(loaded.doc)) return loaded.source;
  const { blocks, seps } = loaded;
  let out = '';
  let next = 0;
  let previous: number | null = null;
  doc.forEach((child, _offset, index) => {
    let match: number | null = null;
    for (let j = next; j < blocks.length; j++) {
      const node = blocks[j]!.node;
      if (node === child || node.eq(child)) {
        match = j;
        break;
      }
    }
    let text: string;
    if (match !== null) {
      text = blocks[match]!.source;
      next = match + 1;
    } else if (child.type.name === RAW_NODE) {
      text = String(child.attrs.text);
    } else {
      text = codec.toMarkdown([child]).replace(/\n+$/, '');
    }
    const keepsSep = match !== null && previous !== null && match === previous + 1;
    if (index === 0) out += blocks.length > 0 ? (seps[0] ?? '') : '';
    else out += keepsSep ? seps[match!]! : '\n\n';
    out += text;
    previous = match;
  });
  const last = blocks.length > 0 ? (seps[blocks.length] ?? '') : '\n';
  return out + last;
}
