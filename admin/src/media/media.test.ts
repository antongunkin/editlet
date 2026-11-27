import { describe, expect, it } from 'vitest';

import {
  batchBySize,
  deleteChanges,
  entryEdits,
  imageBytes,
  imageFileError,
  replaceChanges,
  uploadChanges,
} from './edits';
import { buildMediaIndex, filterCounts, matchesFilter, matchesQuery, type MediaIndex } from './mediaIndex';
import { sanitizeSvg } from './svg';

import { parseEntryFile } from '../../../core/entryFile';
import type { FileRef } from '../../../core/source';
import { summarizeEntry } from '../../../core/summary';
import type { EntryFileData } from '../data/queries';
import { schema } from '../entry/testSchema';

const entry = (text: string, sha: string): EntryFileData => {
  const file = parseEntryFile(text);
  return { file, sha, keyOrder: Object.keys(file.data) };
};

const HELLO = [
  '---',
  'title: Hello',
  'cover:',
  '  src: hello/cover.webp',
  '  alt: A laptop',
  '---',
  '',
  'Intro ![Chart](hello/chart.png) and ![](../shared/logo.svg).',
  '',
].join('\n');
const OTHER = ['---', 'title: Other', '---', '', '![Laptop](hello/cover.webp "T")', ''].join('\n');

const files: FileRef[] = [
  { path: 'cms/schema.json', sha: 's0' },
  { path: 'cms/content/post/hello.md', sha: 'e1' },
  { path: 'cms/content/post/other.md', sha: 'e2' },
  { path: 'cms/content/post/hello/cover.webp', sha: 'i1' },
  { path: 'cms/content/post/hello/chart.png', sha: 'i2' },
  { path: 'cms/content/post/hello/old.jpg', sha: 'i3' },
  { path: 'cms/content/shared/logo.svg', sha: 'i4' },
  { path: 'cms/content/.drafts/hidden.png', sha: 'i5' },
  { path: 'public/site.png', sha: 'i6' },
];

const read = new Map([
  ['cms/content/post/hello.md', entry(HELLO, 'e1')],
  ['cms/content/post/other.md', entry(OTHER, 'e2')],
]);

const summaries = (files_: ReadonlyMap<string, EntryFileData> = read) =>
  new Map([...files_].map(([path, e]) => [path, summarizeEntry(schema, 'post', e.file)]));

const sized = (n: number) => ({ content: new Uint8Array(n) });
const svg = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${inner}</svg>`;

const index = (): MediaIndex => buildMediaIndex(schema, files, summaries());
const image = (i: MediaIndex, path: string) => i.images.find((x) => x.path === `cms/content/${path}`)!;

describe('buildMediaIndex', () => {
  it('lists images under contentDir (hidden ones skipped) with their uses', () => {
    const i = index();
    expect(i.images.map((x) => x.path)).toEqual([
      'cms/content/post/hello/chart.png',
      'cms/content/post/hello/cover.webp',
      'cms/content/post/hello/old.jpg',
      'cms/content/shared/logo.svg',
    ]);
    expect(i.folders).toEqual(['cms/content/post/hello', 'cms/content/shared']);
    expect(image(i, 'post/hello/cover.webp').uses.map((u) => [u.slug, u.field, u.alt, u.title])).toEqual([
      ['hello', 'cover', 'A laptop', 'Hello'],
      ['other', 'body', 'Laptop', 'Other'],
    ]);
    expect(i.incomplete).toBe(false);
  });

  it('counts and filters Used, Unused and Missing alt; searches path and alt', () => {
    const i = index();
    expect(filterCounts(i.images)).toEqual({ all: 4, used: 3, unused: 1, 'missing-alt': 1 });
    expect(i.images.filter((x) => matchesFilter(x, 'unused')).map((x) => x.name)).toEqual(['old.jpg']);
    expect(i.images.filter((x) => matchesFilter(x, 'missing-alt')).map((x) => x.name)).toEqual(['logo.svg']);
    expect(i.images.filter((x) => matchesQuery(x, 'LAPTOP')).map((x) => x.name)).toEqual(['cover.webp']);
    expect(i.images.filter((x) => matchesQuery(x, 'shared/')).map((x) => x.name)).toEqual(['logo.svg']);
  });

  it('is incomplete while an entry is not read', () => {
    const partial = buildMediaIndex(
      schema,
      files,
      summaries(new Map([['cms/content/post/hello.md', read.get('cms/content/post/hello.md')!]])),
    );
    expect(partial.incomplete).toBe(true);
    expect(() => deleteChanges(partial, ['cms/content/post/hello/old.jpg'])).toThrow(/Not every entry/);
  });
});

describe('media edits', () => {
  it('names uploads like the files, with -2 on a collision', () => {
    const bytes = new Uint8Array([1]);
    const changes = uploadChanges(['cms/content/media/photo.png'], 'cms/content/media', [
      { name: 'Photo.PNG', bytes },
      { name: 'Photo.png', bytes },
      { name: 'new shot.jpg', bytes },
    ]);
    expect(changes.map((c) => [c.path, c.sha])).toEqual([
      ['cms/content/media/photo-2.png', null],
      ['cms/content/media/photo-3.png', null],
      ['cms/content/media/new-shot.jpg', null],
    ]);
  });

  it('checks type and size, and splits uploads into commits by size', () => {
    expect(imageFileError({ name: 'a.pdf', size: 1 })).toMatch(/only image files/);
    expect(imageFileError({ name: 'a.png', size: 9 * 1024 * 1024 })).toMatch(/larger than 8 MB/);
    expect(imageFileError({ name: 'a.png', size: 1 })).toBeNull();
    expect(
      batchBySize([sized(4), sized(4), sized(4), sized(12), sized(1)], 10).map((b) => b.map((x) => x.content.length)),
    ).toEqual([[4, 4], [4], [12], [1]]);
  });

  it('rewrites alt in a field and in the body, keeping the rest of the file', () => {
    const i = index();
    const cover = image(i, 'post/hello/cover.webp');
    const chart = image(i, 'post/hello/chart.png');
    const changes = entryEdits(
      schema,
      i,
      [
        { use: cover.uses[0]!, alt: 'A desk' },
        { use: chart.uses[0]!, alt: 'Sales chart' },
        { use: cover.uses[1]!, alt: 'A desk' },
      ],
      read,
    );
    expect(changes).toEqual([
      {
        path: 'cms/content/post/hello.md',
        sha: 'e1',
        content: HELLO.replace('A laptop', 'A desk').replace('[Chart]', '[Sales chart]'),
      },
      { path: 'cms/content/post/other.md', sha: 'e2', content: OTHER.replace('[Laptop]', '[A desk]') },
    ]);
  });

  it('replaces in place for the same extension, else adds a file, deletes the old one and repoints every use', () => {
    const i = index();
    const cover = image(i, 'post/hello/cover.webp');
    const bytes = new Uint8Array([7]);
    expect(replaceChanges(schema, i, cover, { name: 'x.webp', bytes }, new Map()).changes).toEqual([
      { path: cover.path, content: bytes, sha: 'i1' },
    ]);
    const { changes, path } = replaceChanges(schema, i, cover, { name: 'x.PNG', bytes }, read);
    expect(path).toBe('cms/content/post/hello/cover.png');
    expect(
      changes.map((c) => [c.path, c.sha, typeof c.content === 'string' ? c.content : c.content && 'bytes']),
    ).toEqual([
      ['cms/content/post/hello/cover.png', null, 'bytes'],
      ['cms/content/post/hello/cover.webp', 'i1', null],
      ['cms/content/post/hello.md', 'e1', HELLO.replace('hello/cover.webp', 'hello/cover.png')],
      ['cms/content/post/other.md', 'e2', OTHER.replace('hello/cover.webp', 'hello/cover.png')],
    ]);
  });

  it('changes the one of two equal uses it was given', () => {
    const text = ['---', 'title: Twice', '---', '', '![](hello/chart.png) and ![](hello/chart.png)', ''].join('\n');
    const twice = new Map([['cms/content/post/hello.md', entry(text, 'e1')]]);
    const i = buildMediaIndex(schema, files, summaries(twice));
    const [, second] = image(i, 'post/hello/chart.png').uses;
    expect(entryEdits(schema, i, [{ use: second!, alt: 'Second' }], twice).map((c) => c.content)).toEqual([
      text.replace('and ![]', 'and ![Second]'),
    ]);
  });

  it('keeps the listed sha for a file that moved since, and refuses one that lost the use', () => {
    const i = index();
    const [use] = image(i, 'post/hello/cover.webp').uses;
    const read_ = (text: string) => new Map([['cms/content/post/hello.md', entry(text, 'e1')]]);
    // The rest of the file moved: the change still names the listed sha, which the commit refuses.
    const [change] = entryEdits(schema, i, [{ use: use!, alt: 'A desk' }], read_(HELLO.replace('Intro', 'Outro')));
    expect(change!.sha).toBe('e1');
    expect(() =>
      entryEdits(schema, i, [{ use: use!, alt: 'A desk' }], read_(HELLO.replace('A laptop', 'Another'))),
    ).toThrow('cms/content/post/hello.md changed since it was read');
  });

  it('deletes only unused images', () => {
    const i = index();
    expect(deleteChanges(i, ['cms/content/post/hello/old.jpg'])).toEqual([
      { path: 'cms/content/post/hello/old.jpg', content: null, sha: 'i3' },
    ]);
    expect(() => deleteChanges(i, ['cms/content/post/hello/chart.png'])).toThrow(
      /is used by cms\/content\/post\/hello.md/,
    );
    expect(() => deleteChanges(i, ['cms/content/post/gone.png'])).toThrow(/not in the repository/);
  });
});

describe('sanitizeSvg', () => {
  it('keeps a clean SVG byte for byte', () => {
    const text = svg('<circle r="4" fill="red"/><use href="#a"/>');
    expect(sanitizeSvg(text)).toBe(text);
  });

  it('removes scripts, foreignObject, handlers, outside links and link animations', () => {
    const out = sanitizeSvg(
      svg(
        '<script>alert(1)</script><foreignObject><div/></foreignObject><a href="javascript:alert(1)"><rect onclick="x()"/></a><set attributeName="href" to="javascript:x"/><image href="data:image/png;base64,AA=="/>',
        ' onload="x()"',
      ),
    );
    expect(out).not.toMatch(/script|foreignObject|onclick|onload|javascript|<set/);
    expect(out).toContain('data:image/png;base64,AA==');
    expect(out).toContain('<rect');
  });

  it('rejects text that is not an SVG document', () => {
    expect(() => sanitizeSvg('<html></html>')).toThrow('Not a valid SVG file');
    expect(() => sanitizeSvg('not xml')).toThrow('Not a valid SVG file');
  });

  it('cleans SVG uploads and passes other images through', async () => {
    const bad = new File([svg('<script>x</script><rect/>')], 'a.svg', { type: 'image/svg+xml' });
    expect(new TextDecoder().decode(await imageBytes(bad))).not.toContain('script');
    const png = new File([new Uint8Array([1, 2])], 'a.png');
    expect([...(await imageBytes(png))]).toEqual([1, 2]);
    await expect(imageBytes(new File(['nope'], 'b.svg'))).rejects.toThrow('b.svg: not a valid SVG file');
  });
});
