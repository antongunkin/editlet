import type { Editor } from '@milkdown/core';
import { DOMParser, DOMSerializer, Fragment, Slice, type Node } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRichEditor, viewOf } from './editor';
import { createImageSlots } from './imageSlots';
import { loadMarkdown, RAW_NODE, type Codec } from './splice';

let editor: Editor;
let codec: Codec;
let view: EditorView;
let images: ReturnType<typeof createImageSlots>;
const onLinkKey = vi.fn();
const onUpdate = vi.fn();

beforeEach(async () => {
  const root = document.createElement('div');
  document.body.append(root);
  images = createImageSlots();
  ({ editor, codec } = await createRichEditor({
    root,
    markdown: '',
    attributes: { 'aria-label': 'Body' },
    images,
    onUpdate,
    onLinkKey,
  }));
  view = viewOf(editor);
});

afterEach(() => {
  editor.destroy();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

/** Replaces the whole document with the blocks of `markdown` (raw blocks as `loadMarkdown` makes them). */
function load(markdown: string) {
  const { doc } = loadMarkdown(codec, markdown);
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, doc.content));
}

function positionsOf(type: string): number[] {
  const out: number[] = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === type) out.push(pos);
  });
  return out;
}

describe('createRichEditor', () => {
  it('sets the editable attributes and reports every state change', () => {
    expect(view.dom.getAttribute('aria-label')).toBe('Body');
    const before = onUpdate.mock.calls.length;
    load('Text\n');
    expect(onUpdate.mock.calls.length).toBeGreaterThan(before);
    expect(onUpdate).toHaveBeenLastCalledWith(view);
  });

  it('opens the link dialog on Mod-K', () => {
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }));
    expect(onLinkKey).toHaveBeenCalledTimes(1);
  });
});

const area = () => view.dom.querySelector<HTMLTextAreaElement>('textarea.editlet-rt-raw__text')!;

describe('raw blocks', () => {
  it('edit their text in a textarea sized to the text, and follow document changes', () => {
    load('<div>\n  a\n</div>\n');
    expect(area().value).toBe('<div>\n  a\n</div>');
    expect(area().rows).toBe(3);
    expect(view.dom.querySelector('.editlet-rt-raw__label')?.textContent).toBe('Markdown kept as text');

    area().value = '<p>b</p>';
    area().dispatchEvent(new Event('input'));
    expect(view.state.doc.firstChild?.attrs.text).toBe('<p>b</p>');
    expect(area().rows).toBe(1);

    const [pos] = positionsOf(RAW_NODE);
    view.dispatch(view.state.tr.setNodeMarkup(pos!, undefined, { text: 'x\ny' }));
    expect(area().value).toBe('x\ny');
    expect(area().rows).toBe(2);
  });

  it('copy as a pre that carries their text', () => {
    const raw = codec.schema.nodes[RAW_NODE]!.create({ text: '<b>x</b>' });
    const dom = DOMSerializer.fromSchema(codec.schema).serializeNode(raw) as HTMLElement;
    expect(dom.outerHTML).toBe('<pre data-type="editlet-raw">&lt;b&gt;x&lt;/b&gt;</pre>');
  });

  // The raw block's rule outranks commonmark's `pre` (code_block), so a copied raw block pastes back as raw.
  it('paste back as raw blocks', () => {
    const holder = document.createElement('div');
    holder.innerHTML = '<pre data-type="editlet-raw">&lt;b&gt;x&lt;/b&gt;</pre>';
    const parsed = DOMParser.fromSchema(codec.schema).parse(holder);
    expect(parsed.firstChild?.type.name).toBe(RAW_NODE);
    expect(parsed.firstChild?.attrs.text).toBe('<b>x</b>');
  });
});

describe('image previews', () => {
  it('add a slot per image, update it with the node and remove it with the node', () => {
    load('![A](a.png) and ![B](b.png)\n');
    expect(images.snapshot().map((s) => [s.src, s.alt])).toEqual([
      ['a.png', 'A'],
      ['b.png', 'B'],
    ]);
    expect(images.snapshot()[0]!.dom.className).toBe('editlet-rt-image');

    const [first] = positionsOf('image');
    const node = view.state.doc.nodeAt(first!)!;
    view.dispatch(view.state.tr.setNodeMarkup(first!, undefined, { ...node.attrs, alt: 'A2' }));
    expect(images.snapshot().find((s) => s.src === 'a.png')?.alt).toBe('A2');

    load('No images\n');
    expect(images.snapshot()).toEqual([]);
  });
});

const paste = (slice: Slice): Slice => {
  let out = slice;
  view.someProp('transformPasted', (f) => {
    out = f(out, view, false);
  });
  return out;
};

describe('pasting', () => {
  it('drops unsafe links and images and keeps safe ones', () => {
    const { schema } = codec;
    const link = (href: string) => schema.marks.link!.create({ href });
    const image = (src: string) => schema.nodes.image!.create({ src, alt: '' });
    const paragraph = schema.nodes.paragraph!.create(null, [
      schema.text('bad', [link('javascript:alert(1)')]),
      schema.text('good', [link('https://e.test')]),
      image('data:image/png;base64,x'),
      image('ok.png'),
    ]);
    const out = paste(new Slice(Fragment.from(paragraph), 0, 0));
    const p = out.content.firstChild as Node;
    const parts: [string, string[]][] = [];
    p.forEach((child) =>
      parts.push([child.isText ? child.text! : `img:${child.attrs.src}`, child.marks.map((m) => String(m.attrs.href))]),
    );
    expect(parts).toEqual([
      ['bad', []],
      ['good', ['https://e.test']],
      ['img:ok.png', []],
    ]);
  });
});
