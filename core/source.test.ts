import { describe, expect, expectTypeOf, it } from 'vitest';

import { EditletError } from './issues';
import { gitBlobSha } from './sha';
import {
  createMemorySource,
  DEFAULT_FILE_VERSIONS,
  MAX_FILE_VERSIONS,
  versionLimit,
  type ContentSource,
} from './source';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      fields: {
        title: { type: 'string', label: 'Title', required: true },
        body: { type: 'markdown', label: 'Body' },
        cover: { type: 'image', label: 'Cover' },
        author: { type: 'reference', label: 'Author', collections: ['author'] },
      },
    },
    author: { label: 'Author', fields: { name: { type: 'string', label: 'Name', required: true } } },
    homePage: { label: 'Home', singleton: true, fields: { title: { type: 'string', label: 'Title' } } },
  },
});

const JANE = '---\nname: Jane\n---\n';

function make() {
  return createMemorySource({ 'cms/schema.json': SCHEMA, 'cms/content/author/jane.md': JANE });
}

describe('createMemorySource', () => {
  it('is a local ContentSource', () => {
    expectTypeOf(createMemorySource({})).toEqualTypeOf<ContentSource>();
    expect(make().kind).toBe('local');
  });

  it('round-trips strings and bytes, with sorted git shas', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const source = createMemorySource({ 'z.bin': bytes, 'a.txt': 'hello' });
    const list = await source.listFiles();
    expect(list.map((f) => f.path)).toEqual(['a.txt', 'z.bin']);
    expect(list[0].sha).toBe(await gitBlobSha('hello'));
    expect(list[1].sha).toBe(await gitBlobSha(bytes));
    expect(new TextDecoder().decode(await source.readFile('a.txt'))).toBe('hello');
    const read = await source.readFile('z.bin');
    expect([...read]).toEqual([1, 2, 3]);
    read[0] = 9;
    expect([...(await source.readFile('z.bin'))]).toEqual([1, 2, 3]);
    bytes[1] = 9;
    expect([...(await source.readFile('z.bin'))]).toEqual([1, 2, 3]);
  });

  it('rejects reading a missing file', async () => {
    const error = await make()
      .readFile('nope.md')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditletError);
    expect((error as EditletError).issues[0].message).toContain('not found');
    expect((error as EditletError).issues[0].path).toBe('');
  });

  it('applies a valid commit and changes the sha after an edit', async () => {
    const source = make();
    const before = (await source.listFiles()).find((f) => f.path === 'cms/content/author/jane.md');
    const result = await source.commit(
      [
        { path: 'cms/content/author/jane.md', content: '---\nname: Jane D\n---\n' },
        { path: 'cms/content/author/bob.md', content: '---\nname: Bob\n---\n' },
      ],
      'Edit authors',
    );
    expect(result).toEqual({ issues: [] });
    const after = await source.listFiles();
    expect(after.find((f) => f.path === 'cms/content/author/jane.md')?.sha).not.toBe(before?.sha);
    expect(after.some((f) => f.path === 'cms/content/author/bob.md')).toBe(true);
  });

  it('is atomic: an invalid file in the batch leaves everything untouched', async () => {
    const source = make();
    const before = await source.listFiles();
    const { issues } = await source.commit(
      [
        { path: 'cms/content/author/bob.md', content: '---\nname: Bob\n---\n' },
        { path: 'cms/content/post/bad.md', content: '---\n---\n' },
      ],
      'Mixed',
    );
    expect(issues.length).toBeGreaterThan(0);
    expect(await source.listFiles()).toEqual(before);
  });

  it('deletes with null', async () => {
    const source = make();
    expect(await source.commit([{ path: 'cms/content/author/jane.md', content: null }], 'Delete')).toEqual({
      issues: [],
    });
    expect((await source.listFiles()).map((f) => f.path)).toEqual(['cms/schema.json']);
  });

  it('rejects deleting an author that an unchanged post references', async () => {
    const source = createMemorySource({
      'cms/schema.json': SCHEMA,
      'cms/content/author/jane.md': JANE,
      'cms/content/post/hello.md': '---\ntitle: Hi\nauthor: author/jane\n---\n',
    });
    const { issues } = await source.commit([{ path: 'cms/content/author/jane.md', content: null }], 'Delete Jane');
    expect(issues).toEqual([
      { file: 'cms/content/post/hello.md', path: 'author', message: 'Referenced entry not found: author/jane' },
    ]);
    expect(await source.listFiles()).toHaveLength(3);
  });

  it('rejects an empty message and treats empty changes as a no-op', async () => {
    const source = make();
    const { issues } = await source.commit([{ path: 'cms/content/author/jane.md', content: null }], '  ');
    expect(issues).toEqual([{ path: '', message: 'Commit message is required' }]);
    expect(await source.listFiles()).toHaveLength(2);
    expect(await source.commit([], 'Nothing')).toEqual({ issues: [] });
  });

  it('rejects duplicate paths in one batch', async () => {
    const { issues } = await make().commit(
      [
        { path: 'cms/content/author/a.md', content: JANE },
        { path: 'cms/content/author/a.md', content: null },
      ],
      'Dup',
    );
    expect(issues[0].message).toBe('Duplicate path in changes');
  });

  it('accepts only a schema fix when the stored schema is broken', async () => {
    const source = createMemorySource({ 'cms/schema.json': '{' });
    const blocked = await source.commit([{ path: 'cms/content/author/a.md', content: JANE }], 'x');
    expect(blocked.issues).toHaveLength(1);
    expect(await source.commit([{ path: 'cms/schema.json', content: SCHEMA }], 'Fix schema')).toEqual({ issues: [] });
  });
});

describe('versionLimit', () => {
  it('defaults, keeps an integer in range and caps a large one', () => {
    expect(versionLimit(undefined)).toBe(DEFAULT_FILE_VERSIONS);
    expect(versionLimit(0)).toBe(DEFAULT_FILE_VERSIONS);
    expect(versionLimit(2.5)).toBe(DEFAULT_FILE_VERSIONS);
    expect(versionLimit(7)).toBe(7);
    expect(versionLimit(1000)).toBe(MAX_FILE_VERSIONS);
  });

  it('leaves the history reads out of the memory source', () => {
    const source = createMemorySource({});
    expect(source.listVersions).toBeUndefined();
    expect(source.readVersion).toBeUndefined();
  });
});
