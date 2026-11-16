// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { removeTopLevelKey, renameTopLevelKey } from './frontmatter';

const text =
  '---\ntitle: Hello # keep\nfeaturedImage:\n  src: a.webp\n  alt: A\ntags:\n- a\n- b\nauthor: x\n---\nBody\n';

describe('renameTopLevelKey', () => {
  it('renames one line and keeps the others byte-identical', () => {
    const out = renameTopLevelKey(text, 'featuredImage', 'cover');
    expect(out).toBe(text.replace('featuredImage:', 'cover:'));
  });

  it('does not touch a similarly named key or body text', () => {
    const src = '---\ntitleX: a\ntitle: b\n---\ntitle: in body\n';
    expect(renameTopLevelKey(src, 'title', 'name')).toBe('---\ntitleX: a\nname: b\n---\ntitle: in body\n');
  });

  it('returns null for a flow mapping, a missing key or no frontmatter', () => {
    expect(renameTopLevelKey('---\n{title: x}\n---\n', 'title', 'name')).toBeNull();
    expect(renameTopLevelKey(text, 'nope', 'name')).toBeNull();
    expect(renameTopLevelKey('Body\n', 'title', 'name')).toBeNull();
  });
});

describe('removeTopLevelKey', () => {
  it('removes nested value lines (image object)', () => {
    expect(removeTopLevelKey(text, 'featuredImage')).toBe(
      '---\ntitle: Hello # keep\ntags:\n- a\n- b\nauthor: x\n---\nBody\n',
    );
  });

  it('removes a block list at column 0', () => {
    expect(removeTopLevelKey(text, 'tags')).toBe(
      '---\ntitle: Hello # keep\nfeaturedImage:\n  src: a.webp\n  alt: A\nauthor: x\n---\nBody\n',
    );
  });

  it('removes a single-line key and keeps the closing line', () => {
    expect(removeTopLevelKey('---\ntitle: x\n---\nB\n', 'title')).toBe('---\n---\nB\n');
  });

  it('returns null for a flow mapping', () => {
    expect(removeTopLevelKey('---\n{title: x}\n---\n', 'title')).toBeNull();
  });
});

describe('block scalars and trailing comments', () => {
  const src = '---\ntitle: x\nnote: |\n  one\n\n  two\nauthor: y\n---\nBody\n';

  it('removes a block scalar including its blank line', () => {
    expect(removeTopLevelKey(src, 'note')).toBe('---\ntitle: x\nauthor: y\n---\nBody\n');
  });

  it('renames a block scalar key and keeps its lines', () => {
    expect(renameTopLevelKey(src, 'note', 'memo')).toBe(src.replace('note:', 'memo:'));
  });

  it('keeps a trailing column-0 comment when removing the last key', () => {
    const out = removeTopLevelKey('---\ntitle: x\nauthor: y\n# end\n---\nB\n', 'author');
    expect(out).toBe('---\ntitle: x\n# end\n---\nB\n');
  });
});
