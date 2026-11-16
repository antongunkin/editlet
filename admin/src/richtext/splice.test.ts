import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Editor } from '@milkdown/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createRichEditor } from './editor';
import { loadMarkdown, rawShare, saveMarkdown, type Codec, type Loaded } from './splice';

import { parseEntryFile } from '../../../core/entryFile';

const REPO = join(import.meta.dirname, '../../../../..');

let editor: Editor;
let codec: Codec;

beforeAll(async () => {
  const root = document.createElement('div');
  document.body.append(root);
  const host = { add: () => 0, update: () => {}, remove: () => {} };
  ({ editor, codec } = await createRichEditor({
    root,
    markdown: '',
    attributes: {},
    images: host,
    onUpdate: () => {},
    onLinkKey: () => {},
  }));
});

afterAll(() => editor.destroy());

/** Saves with the splice path even when nothing changed (a copy of the doc, so `doc.eq` short-cut is skipped). */
const forceSave = (loaded: Loaded) => {
  const copy = codec.schema.topNodeType.create(
    null,
    loaded.blocks.map((b) => b.node.copy(b.node.content)),
  );
  return saveMarkdown(codec, { ...loaded, doc: codec.schema.topNodeType.create() }, copy);
};

/** The doc with block `i` replaced by `node`. */
const replaceBlock = (loaded: Loaded, i: number, text: string) => {
  const nodes: import('@milkdown/prose/model').Node[] = [];
  loaded.doc.forEach((n) => nodes.push(n));
  const [paragraph] = codec.toNodes(codec.tree(text).children);
  nodes[i] = paragraph!;
  return codec.schema.topNodeType.create(null, nodes);
};

function bodies(): [string, string][] {
  const dir = join(REPO, 'cms/content');
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const path = join(entry.parentPath, entry.name);
    const body = parseEntryFile(readFileSync(path, 'utf8')).body;
    if (body.trim() !== '') out.push([path.slice(REPO.length + 1), body]);
  }
  return out;
}

const EDGE = [
  '__strong__ and *em* and _em_ and \\* not em  \nhard break\\\nagain',
  '* star\n* list\n\n+ plus\n+ list\n\n3. three\n3. three again',
  '- [ ] todo\n- [x] done',
  '| a | b |\n|:--|--:|\n| 1 | 2 |',
  'See [the docs][docs] and [other].\n\n[docs]: https://example.test/docs "Docs"\n[other]: ./other.md',
  '<div class="note">\n  <p>Raw *HTML*</p>\n</div>\n\nAfter.',
  'Text[^1].\n\n[^1]: A footnote.',
  '![Alt](pic.png "Title") and ![](<a b.png>)',
  '```js title="x.js"\nconst a = 1;\n```\n\n~~~\ntilde\n~~~',
  'Line one\r\n\r\nLine two\r\n',
  'No final newline',
  '\n\nLeading blank lines\n\n\n\nand gaps\n\n',
  '> quote\n> - list in quote\n\n***\n\n# Heading #\n\nSetext\n======',
];

describe('loadMarkdown / saveMarkdown', () => {
  it.each(bodies())('keeps %s byte for byte through the splice path', (_path, body) => {
    const loaded = loadMarkdown(codec, body);
    expect(saveMarkdown(codec, loaded, loaded.doc)).toBe(body);
    expect(forceSave(loaded)).toBe(body);
  });

  it.each(EDGE.map((e) => [JSON.stringify(e).slice(0, 40), e]))('keeps edge case %s', (_name, body) => {
    const loaded = loadMarkdown(codec, body);
    expect(forceSave(loaded)).toBe(body);
  });

  it('keeps blocks it cannot represent as raw text: HTML, definitions, footnotes, fence meta', () => {
    const raws = (body: string) =>
      loadMarkdown(codec, body)
        .blocks.filter((b) => b.raw)
        .map((b) => b.source);
    expect(raws('<div>x</div>\n\nok')).toEqual(['<div>x</div>']);
    expect(raws('[a][d]\n\n[d]: https://x.test')).toEqual(['[d]: https://x.test']);
    expect(raws('```js title="x"\nc\n```')).toEqual(['```js title="x"\nc\n```']);
    expect(raws('Plain *text* with `code` and [a link](https://x.test).')).toEqual([]);
  });

  it('rewrites only the edited block and keeps the separators around it', () => {
    const body = 'First  paragraph   kept.\n\n\n* star list\n* kept\n\nSecond *para*.\n';
    const loaded = loadMarkdown(codec, body);
    const out = saveMarkdown(codec, loaded, replaceBlock(loaded, 2, 'Second **para**.'));
    expect(out).toBe('First  paragraph   kept.\n\n\n* star list\n* kept\n\nSecond **para**.\n');
  });

  it("writes new blocks in the body's own style", () => {
    const body = '* a\n* b\n\nText _em_.';
    const loaded = loadMarkdown(codec, body);
    const nodes: import('@milkdown/prose/model').Node[] = [];
    loaded.doc.forEach((n) => nodes.push(n));
    nodes.push(...codec.toNodes(codec.tree('- new\n- list').children));
    expect(saveMarkdown(codec, loaded, codec.schema.topNodeType.create(null, nodes))).toBe(
      '* a\n* b\n\nText _em_.\n\n- new\n- list',
    );
  });

  it('measures the share of raw blocks', () => {
    expect(rawShare(loadMarkdown(codec, '<a>\n\n<b>\n\ntext'))).toBeCloseTo(2 / 3);
    expect(rawShare(loadMarkdown(codec, ''))).toBe(0);
  });

  it('an empty body edited becomes the new text plus a newline', () => {
    const loaded = loadMarkdown(codec, '');
    const doc = codec.schema.topNodeType.create(null, codec.toNodes(codec.tree('Hello').children));
    expect(saveMarkdown(codec, loaded, doc)).toBe('Hello\n');
  });
});
