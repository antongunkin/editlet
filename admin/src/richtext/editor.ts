import {
  Editor,
  editorViewCtx,
  editorViewOptionsCtx,
  remarkCtx,
  remarkStringifyOptionsCtx,
  rootCtx,
  schemaCtx,
  serializerCtx,
} from '@milkdown/core';
import type { Ctx } from '@milkdown/ctx';
import { clipboard } from '@milkdown/plugin-clipboard';
import { history } from '@milkdown/plugin-history';
import { commonmark, imageSchema } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { keymap } from '@milkdown/prose/keymap';
import { Fragment, Slice, type Node } from '@milkdown/prose/model';
import { Plugin } from '@milkdown/prose/state';
import type { EditorView, NodeViewConstructor } from '@milkdown/prose/view';
import { ParserState } from '@milkdown/transformer';
import { $node, $prose, $view } from '@milkdown/utils';

import { isSafeHref } from './links';
import { RAW_NODE, type Codec, type MdNode, type MdRoot } from './splice';
import { markdownStyle } from './style';

/** A block kept as text: raw HTML, link definitions, anything the editor would not write back exactly. */
const rawNode = $node(RAW_NODE, () => ({
  group: 'block',
  atom: true,
  isolating: true,
  selectable: true,
  attrs: { text: { default: '' } },
  // Above commonmark's `pre` (code_block, priority 50), so a copied raw block pastes back as raw, not as code.
  parseDOM: [
    {
      tag: 'pre[data-type="editlet-raw"]',
      priority: 60,
      getAttrs: (dom) => ({ text: (dom as HTMLElement).textContent }),
    },
  ],
  toDOM: (node) => ['pre', { 'data-type': 'editlet-raw' }, String(node.attrs.text)],
  // Never made from markdown by the parser: `loadMarkdown` creates raw blocks itself.
  parseMarkdown: { match: () => false, runner: () => {} },
  toMarkdown: {
    match: (node) => node.type.name === RAW_NODE,
    runner: (state, node) => {
      state.addNode('html', undefined, String(node.attrs.text));
    },
  },
}));

/** A raw block as a labelled textarea: its text is edited as markdown, never rendered. */
const rawView = $view(rawNode, (): NodeViewConstructor => (initial, view, getPos) => {
  let node = initial;
  const dom = document.createElement('div');
  dom.className = 'editlet-rt-raw';
  dom.contentEditable = 'false';
  const label = document.createElement('div');
  label.className = 'editlet-rt-raw-label';
  label.textContent = 'Markdown kept as text';
  const area = document.createElement('textarea');
  area.className = 'editlet-rt-raw-text';
  area.spellcheck = false;
  area.setAttribute('aria-label', 'Markdown kept as text');
  const fit = () => {
    area.rows = Math.max(1, String(node.attrs.text).split('\n').length);
  };
  area.value = String(node.attrs.text);
  fit();
  area.addEventListener('input', () => {
    const pos = getPos();
    if (pos === undefined) return;
    view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { text: area.value }));
  });
  dom.append(label, area);
  return {
    dom,
    update(next) {
      if (next.type !== node.type) return false;
      node = next;
      if (area.value !== next.attrs.text) area.value = String(next.attrs.text);
      fit();
      return true;
    },
    stopEvent: () => true,
    ignoreMutation: () => true,
  };
});

/** Where image previews are drawn: the React side renders a preview into each `dom` (see `ImageSlots`). */
export type ImageSlotHost = {
  add(dom: HTMLElement, src: string, alt: string): number;
  update(id: number, src: string, alt: string): void;
  remove(id: number): void;
};

const imageView = (host: ImageSlotHost) =>
  $view(imageSchema.node, (): NodeViewConstructor => (initial) => {
    const dom = document.createElement('span');
    dom.className = 'editlet-rt-image';
    dom.contentEditable = 'false';
    const id = host.add(dom, String(initial.attrs.src), String(initial.attrs.alt));
    return {
      dom,
      update(next) {
        if (next.type !== initial.type) return false;
        host.update(id, String(next.attrs.src), String(next.attrs.alt));
        return true;
      },
      destroy: () => host.remove(id),
      ignoreMutation: () => true,
    };
  });

/** Drops links and images with a `javascript:`, `data:` or other unsafe URL from pasted content. */
function cleanSlice(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const nodes: Node[] = [];
    fragment.forEach((node) => {
      if (node.type.name === 'image' && !isSafeHref(String(node.attrs.src))) return;
      const marks = node.marks.filter((m) => m.type.name !== 'link' || isSafeHref(String(m.attrs.href)));
      const content = node.isLeaf ? node.content : clean(node.content);
      nodes.push(node.isText ? node.mark(marks) : node.copy(content).mark(marks));
    });
    return Fragment.from(nodes);
  };
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd);
}

export type RichEditorOptions = {
  root: HTMLElement;
  /** The body the editor is made for: its list markers, emphasis and fences are kept for new blocks. */
  markdown: string;
  /** Attributes of the editable element (`aria-label`, `aria-describedby`…). */
  attributes: Record<string, string>;
  images: ImageSlotHost;
  /** Every state change (document or selection). */
  onUpdate(view: EditorView): void;
  /** Mod-K: open the link dialog. */
  onLinkKey(): void;
};

export function codecFrom(ctx: Ctx): Codec {
  const schema = ctx.get(schemaCtx);
  const remark = ctx.get(remarkCtx);
  const serializer = ctx.get(serializerCtx);
  return {
    schema,
    tree: (markdown) => remark.runSync(remark.parse(markdown), markdown) as unknown as MdRoot,
    toNodes(children: MdNode[]) {
      const doc = new ParserState(schema).next({ type: 'root', children } as never).toDoc();
      const out: Node[] = [];
      doc.forEach((n) => out.push(n));
      return out;
    },
    toMarkdown: (nodes) => serializer(schema.topNodeType.create(null, nodes)),
  };
}

/** A headless Milkdown editor (CommonMark, GFM, history, clipboard) with raw blocks and image previews. */
export async function createRichEditor(options: RichEditorOptions): Promise<{ editor: Editor; codec: Codec }> {
  const updates = $prose(
    () =>
      new Plugin({
        view: (view) => {
          options.onUpdate(view);
          return { update: (v) => options.onUpdate(v) };
        },
        props: { transformPasted: cleanSlice },
      }),
  );
  const keys = $prose(() =>
    keymap({
      'Mod-k': () => {
        options.onLinkKey();
        return true;
      },
    }),
  );
  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, options.root);
      ctx.update(remarkStringifyOptionsCtx, (prev) => ({ ...prev, ...markdownStyle(options.markdown) }));
      ctx.update(editorViewOptionsCtx, (prev) => ({ ...prev, attributes: options.attributes }));
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(rawNode)
    .use(rawView)
    .use(imageView(options.images))
    .use(updates)
    .use(keys)
    .create();
  return { editor, codec: editor.action(codecFrom) };
}

export const viewOf = (editor: Editor): EditorView => editor.action((ctx) => ctx.get(editorViewCtx));
