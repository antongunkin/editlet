import { describe, expect, it } from 'vitest';

import { entriesFromFiles } from './project';
import { loadSchema } from './schema';

const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});
const enc = (s: string) => new TextEncoder().encode(s);

describe('entriesFromFiles', () => {
  it('parses entries and sorts by file path', () => {
    const files = new Map([
      ['cms/content/post/b.md', enc('---\ntitle: B\n---\nbody b')],
      ['cms/content/post/a.md', enc('---\ntitle: A\n---\nbody a')],
    ]);
    const { entries, issues } = entriesFromFiles(schema, 'cms/schema.json', files);
    expect(issues).toEqual([]);
    expect(entries.map((e) => e.slug)).toEqual(['a', 'b']);
    expect(entries[0]).toMatchObject({ collection: 'post', data: { title: 'A' }, body: 'body a' });
  });

  it('skips schema, hidden and image paths', () => {
    const files = new Map([
      ['cms/schema.json', enc('{}')],
      ['cms/content/post/.hidden/x.md', enc('x')],
      ['cms/content/post/pic.png', new Uint8Array([1])],
    ]);
    expect(entriesFromFiles(schema, 'cms/schema.json', files)).toEqual({ entries: [], issues: [] });
  });

  it('reports non-entry files and invalid UTF-8 / frontmatter as issues', () => {
    const files = new Map([
      ['cms/content/post/notes.txt', enc('x')],
      ['cms/content/post/bad.md', new Uint8Array([0xff, 0xfe])],
      ['cms/content/post/fm.md', enc('---\ntitle: [\n---\n')],
    ]);
    const { entries, issues } = entriesFromFiles(schema, 'cms/schema.json', files);
    expect(entries).toEqual([]);
    expect(issues.map((i) => i.file)).toEqual([
      'cms/content/post/bad.md',
      'cms/content/post/fm.md',
      'cms/content/post/notes.txt',
    ]);
    expect(issues[0].message).toBe('File is not valid UTF-8');
    expect(issues[2].message).toBe('Not an entry file');
  });
});
