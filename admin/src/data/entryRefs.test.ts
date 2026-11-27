import { describe, expect, it } from 'vitest';

import { entryRefs } from './queries';

import { isHiddenContentPath, parseEntryPath } from '../../../core/paths';
import { parseSchemaText, type Schema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';

const schemaOf = (contentDir: string) =>
  parseSchemaText(
    JSON.stringify({
      contentDir,
      git: { baseBranch: 'main' },
      collections: {
        post: { label: 'Post', fields: { title: { type: 'text', label: 'Title' } } },
        author: { label: 'Author', fields: { title: { type: 'text', label: 'Title' } } },
        home: { label: 'Home', singleton: true, fields: { title: { type: 'text', label: 'Title' } } },
        empty: { label: 'Empty', fields: { title: { type: 'text', label: 'Title' } } },
      },
    }),
    'cms/schema.json',
  );

// Entries of several collections interleaved and not sorted, and every kind of file that is no entry.
const PATHS = [
  'cms/schema.json',
  'cms/content/post/b.md',
  'cms/content/author/ann.md',
  'cms/content/post/a.md',
  'cms/content/post/a/cover.png',
  'cms/content/post/.draft.md',
  'cms/content/.trash/old.md',
  'cms/content/post/notes.txt',
  'cms/content/post/.md',
  'cms/content/post/deep/er.md',
  'cms/content/post//twice.md',
  'cms/content/unknown/x.md',
  'cms/content/home/other.md',
  'cms/content/home/index.md',
  'cms/content/loose.md',
  'elsewhere/post/c.md',
  'cms/content/author/bob.md',
];
const files = (): FileRef[] => PATHS.map((path, i) => ({ path, sha: `sha-${i}` }));

/** The scan `entryRefs` did before it grouped the files: one pass over the list per collection. */
function scan(schema: Schema, list: FileRef[], collection: string) {
  return list.flatMap((ref) => {
    if (isHiddenContentPath(schema, ref.path)) return [];
    const parsed = parseEntryPath(schema, ref.path);
    return parsed?.collection === collection ? [{ ...ref, slug: parsed.slug }] : [];
  });
}

describe('entryRefs', () => {
  const schema = schemaOf('cms/content');
  const collections = [...Object.keys(schema.collections), 'unknown', 'constructor'];

  it('gives what a scan of the list per collection gave, in the same order', () => {
    const list = files();
    for (const collection of collections) {
      expect(entryRefs(schema, list, collection), collection).toStrictEqual(scan(schema, list, collection));
    }
    expect(entryRefs(schema, list, 'post').map((r) => r.slug)).toEqual(['b', 'a']);
    expect(entryRefs(schema, list, 'home').map((r) => r.slug)).toEqual(['index']);
  });

  it('returns the same arrays for the same file list and schema', () => {
    const list = files();
    for (const collection of collections) {
      expect(entryRefs(schema, list, collection), collection).toBe(entryRefs(schema, list, collection));
    }
  });

  it('groups again for another file list or another schema', () => {
    const list = files();
    const posts = entryRefs(schema, list, 'post');
    const fewer = list.filter((ref) => ref.path !== 'cms/content/post/a.md');
    expect(entryRefs(schema, fewer, 'post').map((r) => r.slug)).toEqual(['b']);
    expect(entryRefs(schemaOf('elsewhere'), list, 'post').map((r) => r.slug)).toEqual(['c']);
    // Neither replaced what the first pair holds.
    expect(entryRefs(schema, list, 'post')).toBe(posts);
  });
});
