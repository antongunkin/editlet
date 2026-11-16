import { describe, expect, it } from 'vitest';

import { fileDiff } from './branchDiff';

import { loadSchema } from '../../../core/schema';

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      fields: {
        title: { type: 'string', label: 'Title' },
        body: { type: 'markdown', label: 'Body' },
      },
    },
  },
});

const bytes = (text: string) => new TextEncoder().encode(text);
const ENTRY = 'cms/content/post/hello.md';

describe('fileDiff', () => {
  it('a modified entry is a per-field diff', () => {
    const diff = fileDiff(
      schema,
      ENTRY,
      'modified',
      bytes('---\ntitle: Hello\n---\nSame body\n'),
      bytes('---\ntitle: Hi\n---\nSame body\n'),
    );
    expect(diff).toEqual({
      kind: 'entry',
      path: ENTRY,
      status: 'modified',
      ref: 'post/hello',
      rows: [{ key: 'title', label: 'Title', type: 'string', before: 'Hello', after: 'Hi' }],
    });
  });

  it('an added entry diffs against nothing', () => {
    const diff = fileDiff(schema, ENTRY, 'added', null, bytes('---\ntitle: New\n---\nText\n'));
    expect(diff.kind).toBe('entry');
    if (diff.kind !== 'entry') throw new Error('unreachable');
    expect(diff.rows.map((r) => [r.key, r.before, r.after])).toEqual([
      ['title', '', 'New'],
      ['body', '', 'Text\n'],
    ]);
  });

  it('a removed entry diffs to nothing', () => {
    const diff = fileDiff(schema, ENTRY, 'removed', bytes('---\ntitle: Old\n---\n'), null);
    expect(diff).toMatchObject({
      kind: 'entry',
      status: 'removed',
      rows: [{ key: 'title', before: 'Old', after: '' }],
    });
  });

  it('an entry that does not parse is a text diff', () => {
    const broken = bytes('---\ntitle: Old\n');
    const diff = fileDiff(schema, ENTRY, 'modified', bytes('---\ntitle: Old\n---\n'), broken);
    expect(diff).toEqual({
      kind: 'text',
      path: ENTRY,
      status: 'modified',
      before: '---\ntitle: Old\n---\n',
      after: '---\ntitle: Old\n',
    });
  });

  it('the schema file is a text diff', () => {
    const diff = fileDiff(schema, 'cms/schema.json', 'modified', bytes('{"a":1}\n'), bytes('{"a":2}\n'));
    expect(diff).toEqual({
      kind: 'text',
      path: 'cms/schema.json',
      status: 'modified',
      before: '{"a":1}\n',
      after: '{"a":2}\n',
    });
  });

  it('an image is binary', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0xff, 0xfe, 0x00, 0x80]);
    const path = 'cms/content/post/hello/cover.webp';
    expect(fileDiff(schema, path, 'added', null, webp)).toEqual({ kind: 'binary', path, status: 'added', image: true });
  });

  it('a raster image is binary even when its bytes decode as UTF-8; SVG is text', () => {
    const png = 'cms/content/post/hello/cover.png';
    expect(fileDiff(schema, png, 'modified', bytes('abc'), bytes('abd'))).toEqual({
      kind: 'binary',
      path: png,
      status: 'modified',
      image: true,
    });
    const svg = 'cms/content/post/hello/logo.svg';
    expect(fileDiff(schema, svg, 'added', null, bytes('<svg/>\n'))).toEqual({
      kind: 'text',
      path: svg,
      status: 'added',
      before: '',
      after: '<svg/>\n',
    });
  });

  it('other undecodable bytes are a binary file', () => {
    const path = 'cms/content/post/data.bin';
    const diff = fileDiff(schema, path, 'removed', new Uint8Array([0xc3, 0x28]), null);
    expect(diff).toEqual({ kind: 'binary', path, status: 'removed', image: false });
  });
});
