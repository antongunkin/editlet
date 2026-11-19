import { describe, expect, it } from 'vitest';

import { editBodyImages, findBodyImages, findImageRefs } from './assets';
import type { Collection, Schema } from './schema';

const post: Collection = {
  label: 'Post',
  path: 'post',
  titleField: 'title',
  fields: {
    title: { type: 'string', label: 'Title' },
    cover: { type: 'image', label: 'Cover' },
    content: { type: 'markdown', label: 'Content' },
  },
} as unknown as Collection;

const schema = { version: 2, contentDir: 'cms/content', collections: { post } } as unknown as Schema;

const srcs = (body: string) => findBodyImages(body).map((i) => i.src);

describe('findBodyImages', () => {
  it('finds inline images with alt, title and angle-bracket destinations', () => {
    const body = 'A ![Chart](chart.png "Sales") and ![](<my photo.jpg>) and ![a \\] b](x(1).png).';
    const images = findBodyImages(body);
    expect(images.map((i) => [i.kind, i.src, i.alt])).toEqual([
      ['inline', 'chart.png', 'Chart'],
      ['inline', 'my photo.jpg', ''],
      ['inline', 'x(1).png', 'a ] b'],
    ]);
    const [first] = images;
    expect(body.slice(...first!.srcRange)).toBe('chart.png');
    expect(body.slice(...first!.altRange!)).toBe('Chart');
  });

  it('resolves full, collapsed and shortcut references through definitions', () => {
    const body = [
      '![One][a] ![Two][] ![Three]',
      '',
      '[a]: one.png',
      '[TWO]: <two.png> "t"',
      '[three]: three.webp',
    ].join('\n');
    expect(findBodyImages(body).map((i) => [i.src, i.alt, i.label?.form])).toEqual([
      ['one.png', 'One', 'full'],
      ['two.png', 'Two', 'collapsed'],
      ['three.webp', 'Three', 'shortcut'],
    ]);
  });

  it('skips images without a definition, escaped images and links', () => {
    expect(srcs('![no][missing] \\![escaped](a.png) [link](b.png)')).toEqual([]);
  });

  it('finds HTML <img> tags and decodes entities', () => {
    const body = '<p><img alt="A &quot;b&quot;" src=\'c.png\' width="10"><IMG SRC=d.png></p>';
    expect(findBodyImages(body).map((i) => [i.kind, i.src, i.alt, i.altRange === null])).toEqual([
      ['html', 'c.png', 'A "b"', false],
      ['html', 'd.png', '', true],
    ]);
  });

  it('skips fenced code, indented code, inline code and HTML comments', () => {
    const body = [
      '```md',
      '![fenced](a.png)',
      '```',
      '',
      '    ![indented](b.png)',
      '',
      'Use `![inline](c.png)` or ``![double](d.png)``.',
      '<!-- ![comment](e.png) -->',
      '~~~',
      '![tilde](f.png)',
      '~~~',
      '![real](g.png)',
    ].join('\n');
    expect(srcs(body)).toEqual(['g.png']);
  });

  it('keeps document order across markdown and HTML images', () => {
    expect(srcs('<img src="a.png"> ![b](b.png) <img src="c.png">')).toEqual(['a.png', 'b.png', 'c.png']);
  });
});

describe('findImageRefs', () => {
  it('lists image fields, then body images, with repo paths', () => {
    const uses = findImageRefs(
      schema,
      post,
      'cms/content/post/hello.md',
      { title: 'Hi', cover: { src: 'hello/cover.webp', alt: 'Cover' } },
      '![Chart](hello/chart.png) ![Remote](https://x.test/a.png) ![Up](../shared/logo.svg)',
    );
    expect(uses.map((u) => [u.field, u.src, u.alt, u.path])).toEqual([
      ['cover', 'hello/cover.webp', 'Cover', 'cms/content/post/hello/cover.webp'],
      ['content', 'hello/chart.png', 'Chart', 'cms/content/post/hello/chart.png'],
      ['content', 'https://x.test/a.png', 'Remote', null],
      ['content', '../shared/logo.svg', 'Up', 'cms/content/shared/logo.svg'],
    ]);
    expect(uses[0]!.body).toBeUndefined();
    expect(uses[1]!.body?.kind).toBe('inline');
  });

  it('ignores empty image fields and names body images "body" without a markdown field', () => {
    const plain = { ...post, fields: { cover: { type: 'image', label: 'Cover' } } } as unknown as Collection;
    const uses = findImageRefs(schema, plain, 'cms/content/post/a.md', { cover: { src: '', alt: '' } }, '![x](x.png)');
    expect(uses.map((u) => u.field)).toEqual(['body']);
  });
});

const edit = (body: string, i: number, change: { alt?: string; src?: string }) =>
  editBodyImages(body, [{ image: findBodyImages(body)[i]!, ...change }]);

describe('editBodyImages', () => {
  it('changes only the alt or src of an inline image', () => {
    const body = 'Before ![Old](a.png "T") after';
    expect(edit(body, 0, { alt: 'New [1]' })).toBe('Before ![New \\[1\\]](a.png "T") after');
    expect(edit(body, 0, { src: 'b c.png' })).toBe('Before ![Old](<b c.png> "T") after');
  });

  it('keeps angle brackets of an angle-bracket destination', () => {
    expect(edit('![](<a b.png>)', 0, { src: 'c d.png' })).toBe('![](<c d.png>)');
  });

  it('writes the label out when changing the alt of a collapsed or shortcut reference', () => {
    const body = '![Logo][] ![Logo]\n\n[logo]: logo.png';
    const images = findBodyImages(body);
    const out = editBodyImages(body, [
      { image: images[0]!, alt: 'Brand' },
      { image: images[1]!, alt: 'Mark' },
    ]);
    expect(out).toBe('![Brand][Logo] ![Mark][Logo]\n\n[logo]: logo.png');
    expect(findBodyImages(out).map((i) => [i.src, i.alt])).toEqual([
      ['logo.png', 'Brand'],
      ['logo.png', 'Mark'],
    ]);
  });

  it('rewrites a shared definition once for all images using it', () => {
    const body = '![a][x] ![b][x]\n\n[x]: old.png';
    const images = findBodyImages(body);
    const out = editBodyImages(
      body,
      images.map((image) => ({ image, src: 'new.png' })),
    );
    expect(out).toBe('![a][x] ![b][x]\n\n[x]: new.png');
  });

  it('edits HTML attributes and adds a missing alt', () => {
    expect(edit('<img src="a.png" alt="x">', 0, { alt: 'Say "hi" & go' })).toBe(
      '<img src="a.png" alt="Say &quot;hi&quot; &amp; go">',
    );
    expect(edit('<img src="a.png">', 0, { alt: 'Logo', src: 'b.png' })).toBe('<img alt="Logo" src="b.png">');
  });

  it('applies several edits without shifting each other', () => {
    const body = '![a](1.png) text ![b](2.png)';
    const [one, two] = findBodyImages(body);
    expect(
      editBodyImages(body, [
        { image: one!, alt: 'first', src: 'one.png' },
        { image: two!, alt: 'second' },
      ]),
    ).toBe('![first](one.png) text ![second](2.png)');
  });
});

describe('findBodyImages edge cases', () => {
  it('reads balanced and escaped parentheses, titles in any quote and wrapped destinations', () => {
    expect(srcs("![a](x_(1).png) ![b](y\\).png) ![c](z.png (Paren title)) ![d](\n  w.png\n  'T'\n)")).toEqual([
      'x_(1).png',
      'y).png',
      'z.png',
      'w.png',
    ]);
  });

  it('skips broken destinations: an open angle bracket, a line break inside one, an unclosed title or junk', () => {
    expect(srcs('![a](<x.png)')).toEqual([]);
    expect(srcs('![a](<x\n.png>)')).toEqual([]);
    expect(srcs('![a](x.png "open)')).toEqual([]);
    expect(srcs('![a](x.png junk)')).toEqual([]);
    expect(srcs('![a\n\nb](x.png)')).toEqual([]);
  });

  it('keeps the first definition of a label and reads angle-bracket definitions', () => {
    const body = '![A][x]\n\n[X]: <first file.png>\n[x]: second.png\n';
    expect(findBodyImages(body)).toMatchObject([{ kind: 'reference', src: 'first file.png', alt: 'A' }]);
  });

  it('a reference with an unclosed label falls back to the shortcut form', () => {
    expect(findBodyImages('![logo][oops\n\n[logo]: l.png\n')).toMatchObject([
      { kind: 'reference', src: 'l.png', label: { text: 'logo', form: 'shortcut' } },
    ]);
  });

  it('reads unquoted and single-quoted HTML attributes, the first of each, and skips <img> without src', () => {
    expect(
      findBodyImages(`<img src=a.png alt='One' alt="Two"> <img alt="none"> <IMG SRC="b&amp;c.png">`),
    ).toMatchObject([
      { kind: 'html', src: 'a.png', alt: 'One' },
      { kind: 'html', src: 'b&c.png', alt: '', altRange: null },
    ]);
  });

  it('masks code to the end of the body: an unclosed fence, trailing indented code, an unclosed comment', () => {
    expect(srcs('```\n![a](a.png)')).toEqual([]);
    expect(srcs('text\n\n    ![b](b.png)')).toEqual([]);
    expect(srcs('<!-- ![c](c.png)')).toEqual([]);
    expect(srcs('`unclosed ![d](d.png)')).toEqual(['d.png']);
    expect(srcs('~~~\nx\n```\n![e](e.png)\n~~~\n![f](f.png)')).toEqual(['f.png']);
  });
});

describe('editBodyImages edge cases', () => {
  it('wraps a new destination with spaces or parentheses in angle brackets', () => {
    const body = '![a](a.png)';
    const [image] = findBodyImages(body);
    expect(editBodyImages(body, [{ image: image!, src: 'my file (1).png' }])).toBe('![a](<my file (1).png>)');
    expect(editBodyImages(body, [{ image: image!, alt: 'x [y]' }])).toBe('![x \\[y\\]](a.png)');
  });

  it('escapes HTML attribute values and leaves a full reference label alone', () => {
    const html = '<img src="a.png" alt="old">';
    const [img] = findBodyImages(html);
    expect(editBodyImages(html, [{ image: img!, alt: 'say "hi" & <go>', src: 'b&c.png' }])).toBe(
      '<img src="b&amp;c.png" alt="say &quot;hi&quot; &amp; &lt;go>">',
    );
    const ref = '![old][logo]\n\n[logo]: l.png\n';
    const [r] = findBodyImages(ref);
    expect(editBodyImages(ref, [{ image: r!, alt: 'new' }])).toBe('![new][logo]\n\n[logo]: l.png\n');
  });
});

describe('findImageRefs inside object and blocks', () => {
  it('finds images in nested fields and in a nested Markdown string, with their paths', async () => {
    const { readProject } = await import('../node/project');
    const root = `${import.meta.dirname}/../__fixtures__/survey`;
    const { schema: project, entries } = await readProject(root);
    const page = entries.find((e) => e.collection === 'page')!;
    const uses = findImageRefs(project, project.collections.page!, 'cms/content/page/landing.md', page.data, page.body);
    expect(uses.map((u) => [u.field, u.path, u.label ?? '', u.body ? 'text' : 'field'])).toEqual([
      ['content.0.image', 'cms/content/page/landing/hero.webp', 'Image (content.0)', 'field'],
      ['content.1.items.0.icon', 'cms/content/page/landing/fast.webp', 'Icon (content.1.items.0)', 'field'],
      ['content.2.text', 'cms/content/page/landing/chart.webp', 'Text (content.2)', 'text'],
    ]);
    expect(uses[2]!.at).toEqual(['content', 2, 'text']);
    expect(uses[2]!.alt).toBe('Chart of answers');
  });
});
