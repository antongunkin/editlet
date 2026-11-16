import type { Editor } from '@milkdown/core';
import type { Node } from '@milkdown/prose/model';
import { EditorState, NodeSelection, TextSelection, type Transaction } from '@milkdown/prose/state';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyImage, applyLink, blockKind, inNode, linkAt, markActive, selectedImage } from './commands';
import { createRichEditor } from './editor';
import type { Codec } from './splice';

let editor: Editor;
let codec: Codec;

beforeAll(async () => {
  const root = document.createElement('div');
  document.body.append(root);
  ({ editor, codec } = await createRichEditor({
    root,
    markdown: '',
    attributes: {},
    images: { add: () => 0, update: () => {}, remove: () => {} },
    onUpdate: () => {},
    onLinkKey: () => {},
  }));
});

afterAll(() => editor.destroy());

const docOf = (markdown: string): Node =>
  codec.schema.topNodeType.create(null, codec.toNodes(codec.tree(markdown).children));

/** The position of the first character of `needle` in the doc's text (`offset` characters further). */
function posOf(doc: Node, needle: string, offset = 0): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found !== -1 || !node.isText) return found === -1;
    const i = node.text!.indexOf(needle);
    if (i !== -1) found = pos + i + offset;
    return false;
  });
  if (found === -1) throw new Error(`no "${needle}"`);
  return found;
}

function stateAt(markdown: string, needle: string, offset = 0, length = 0): EditorState {
  const doc = docOf(markdown);
  const from = posOf(doc, needle, offset);
  return EditorState.create({ doc, selection: TextSelection.create(doc, from, from + length) });
}

const markdownOf = (tr: Transaction | null) => {
  const nodes: Node[] = [];
  tr!.doc.forEach((n) => nodes.push(n));
  return codec.toMarkdown(nodes);
};

describe('markActive and inNode', () => {
  it('reads the marks at the cursor, the stored marks and the marks over a range', () => {
    const strong = codec.schema.marks.strong;
    expect(markActive(stateAt('a **bold** c\n', 'bold', 2), strong)).toBe(true);
    expect(markActive(stateAt('a **bold** c\n', 'c'), strong)).toBe(false);
    expect(markActive(stateAt('a **bold** c\n', 'bold', 0, 4), strong)).toBe(true);
    expect(markActive(stateAt('a **bold** c\n', 'a', 0, 1), strong)).toBe(false);
    const state = stateAt('plain\n', 'plain', 2);
    const stored = state.apply(state.tr.addStoredMark(strong!.create()));
    expect(markActive(stored, strong)).toBe(true);
    expect(markActive(state, undefined)).toBe(false);
  });

  it('finds a list around the cursor at any depth', () => {
    const list = codec.schema.nodes.bullet_list;
    expect(inNode(stateAt('- one\n  - two\n', 'two'), list)).toBe(true);
    expect(inNode(stateAt('text\n', 'text'), list)).toBe(false);
    expect(inNode(stateAt('text\n', 'text'), undefined)).toBe(false);
  });
});

describe('blockKind', () => {
  it('names headings by level, paragraphs and code; anything else is other', () => {
    expect(blockKind(stateAt('## Two\n', 'Two'))).toBe('h2');
    expect(blockKind(stateAt('Para\n', 'Para'))).toBe('paragraph');
    expect(blockKind(stateAt('```\ncode\n```\n', 'code'))).toBe('code');
    const doc = docOf('***\n\nafter\n');
    expect(blockKind(EditorState.create({ doc, selection: NodeSelection.create(doc, 0) }))).toBe('other');
  });
});

describe('linkAt', () => {
  it('spans the whole link from a cursor in its first part, across differently marked parts', () => {
    const state = stateAt('Go [to **the** docs](https://e.test) now\n', 'to', 1);
    const link = linkAt(state)!;
    expect(link.href).toBe('https://e.test');
    expect(state.doc.textBetween(link.from, link.to)).toBe('to the docs');
  });

  // A link split by inner marks is several text nodes: the range grows both ways from the part holding the cursor.
  it('spans the whole link from a cursor in a later part', () => {
    const state = stateAt('Go [to **the** docs](https://e.test) now\n', 'docs', 1);
    const link = linkAt(state)!;
    expect(state.doc.textBetween(link.from, link.to)).toBe('to the docs');
  });

  it('finds a link that starts right after the cursor, and nothing in plain text', () => {
    expect(linkAt(stateAt('[x](a.md) b\n', 'x'))?.href).toBe('a.md');
    expect(linkAt(stateAt('[x](a.md) b\n', 'b'))).toBeNull();
  });
});

describe('applyLink', () => {
  it('refuses an unsafe URL', () => {
    expect(applyLink(stateAt('text\n', 'text', 0, 4), { href: 'javascript:alert(1)', text: '' })).toBeNull();
  });

  it('links the selection, or inserts the text (or the URL) as a new link at a bare cursor', () => {
    expect(markdownOf(applyLink(stateAt('see docs\n', 'docs', 0, 4), { href: ' https://e.test ', text: '' }))).toBe(
      'see [docs](https://e.test)\n',
    );
    expect(markdownOf(applyLink(stateAt('see x\n', 'x'), { href: 'https://e.test', text: ' Docs ' }))).toBe(
      'see [Docs](https://e.test)x\n',
    );
    expect(markdownOf(applyLink(stateAt('a b\n', 'b'), { href: 'b.md', text: '' }))).toBe('a [b.md](b.md)b\n');
  });

  it('changes or removes the link at the cursor as a whole', () => {
    const state = stateAt('Go [the docs](old.md) now\n', 'docs', 1);
    expect(markdownOf(applyLink(state, { href: 'new.md', text: '' }))).toBe('Go [the docs](new.md) now\n');
    expect(markdownOf(applyLink(state, { href: '  ', text: '' }))).toBe('Go the docs now\n');
  });

  it('does nothing without a link mark in the schema', () => {
    const noLink = { schema: { marks: {} } } as unknown as EditorState;
    expect(applyLink(noLink, { href: 'a.md', text: '' })).toBeNull();
    expect(linkAt(noLink)).toBeNull();
  });
});

const imageState = () => {
  const doc = docOf('![Old](a.png "T")\n');
  let pos = -1;
  doc.descendants((node, p) => {
    if (node.type.name === 'image') pos = p;
  });
  return EditorState.create({ doc, selection: NodeSelection.create(doc, pos) });
};

describe('selectedImage and applyImage', () => {
  it('changes the selected image and keeps its other attributes', () => {
    const state = imageState();
    expect(selectedImage(state)?.node.attrs.src).toBe('a.png');
    expect(markdownOf(applyImage(state, { src: 'b.png', alt: 'New' }))).toBe('![New](b.png "T")\n');
  });

  it('inserts an image at a text selection and refuses an unsafe source', () => {
    const state = stateAt('Hi\n', 'Hi', 2);
    expect(selectedImage(state)).toBeNull();
    expect(markdownOf(applyImage(state, { src: 'c.png', alt: 'C' }))).toBe('Hi![C](c.png)\n');
    expect(applyImage(state, { src: 'javascript:x', alt: '' })).toBeNull();
    const noImage = { schema: { nodes: {} } } as unknown as EditorState;
    expect(applyImage(noImage, { src: 'c.png', alt: '' })).toBeNull();
  });
});
