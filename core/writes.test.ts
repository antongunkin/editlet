import { describe, expect, it } from 'vitest';

import { loadSchema, type Schema } from './schema';
import type { FileChange } from './source';
import { isWritablePath, validateChanges } from './writes';

const SCHEMA_PATH = 'cms/schema.json';

const schemaJson = {
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
};

const schema: Schema = loadSchema(schemaJson);

function current(files: string[] = [], s: Schema | null = schema) {
  const set = new Set(files);
  return { schema: s, schemaPath: SCHEMA_PATH, exists: (path: string) => set.has(path) };
}

describe('isWritablePath', () => {
  it.each([
    'cms/schema.json',
    'cms/content/post/hello.md',
    'cms/content/homePage/index.md',
    'cms/content/post/hello/cover.webp',
    'cms/content/post/cover.PNG',
    'cms/content/a/b/c/d.svg',
  ])('accepts %s', (path) => {
    expect(isWritablePath(schema, SCHEMA_PATH, path)).toBe(true);
  });

  it.each([
    '',
    '/etc/passwd',
    '/cms/content/post/hello.md',
    '../package.json',
    'cms/content/../../package.json',
    'cms/content/post/../post/hello.md',
    'cms/content/./post/hello.md',
    'cms/content//post/hello.md',
    'cms\\content\\post\\hello.md',
    'cms/content/post\\hello.md',
    'src/app/page.tsx',
    'cms/content/post/script.ts',
    'cms/content/post/notes.txt',
    'cms/content/unknown/hello.md',
    'cms/content/homePage/other.md',
    'cms/content/post/nested/hello.md',
    'cms/content/post/.hidden/cover.png',
    'cms/content/.cover.png',
    'cms/other.json',
    'public/cover.png',
    'cms/content',
    'cms/content/post/a\0.md',
    'cms/content/post/c:cover.png',
    'C:/cms/content/post/hello.md',
  ])('rejects %j', (path) => {
    expect(isWritablePath(schema, SCHEMA_PATH, path)).toBe(false);
  });
});

const post = (extra = '') => `---\ntitle: Hello\n${extra}---\nBody\n`;

describe('validateChanges', () => {
  it('accepts a valid entry write', () => {
    expect(validateChanges(current(), [{ path: 'cms/content/post/hello.md', content: post() }])).toEqual([]);
  });

  it('accepts entry bytes', () => {
    const content = new TextEncoder().encode(post());
    expect(validateChanges(current(), [{ path: 'cms/content/post/hello.md', content }])).toEqual([]);
  });

  it('reports invalid UTF-8 in an entry', () => {
    const issues = validateChanges(current(), [
      { path: 'cms/content/post/hello.md', content: new Uint8Array([0x2d, 0xff, 0xfe]) },
    ]);
    expect(issues).toEqual([{ file: 'cms/content/post/hello.md', path: '', message: 'File is not valid UTF-8' }]);
  });

  it('reports entry validation issues with the file', () => {
    const issues = validateChanges(current(), [{ path: 'cms/content/post/hello.md', content: '---\nfoo: 1\n---\n' }]);
    expect(issues).toContainEqual({ file: 'cms/content/post/hello.md', path: 'title', message: 'Required' });
    expect(issues).toContainEqual({ file: 'cms/content/post/hello.md', path: 'foo', message: 'Unknown field' });
  });

  it('reports unparsable frontmatter with the file', () => {
    const issues = validateChanges(current(), [{ path: 'cms/content/post/hello.md', content: '---\ntitle: [\n' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].file).toBe('cms/content/post/hello.md');
  });

  it('rejects non-writable paths', () => {
    const changes: FileChange[] = [
      { path: '../package.json', content: '{}' },
      { path: 'cms/content/post/a.ts', content: null },
    ];
    expect(validateChanges(current(), changes)).toEqual([
      { file: '../package.json', path: '', message: 'Path not writable' },
      { file: 'cms/content/post/a.ts', path: '', message: 'Path not writable' },
    ]);
  });

  it('rejects deleting the schema file', () => {
    const issues = validateChanges(current(), [{ path: SCHEMA_PATH, content: null }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: SCHEMA_PATH, path: '' });
  });

  it('allows deletes of writable paths', () => {
    const changes: FileChange[] = [
      { path: 'cms/content/post/hello.md', content: null },
      { path: 'cms/content/post/hello/cover.webp', content: null },
    ];
    expect(validateChanges(current(['cms/content/post/hello.md']), changes)).toEqual([]);
  });

  it('accepts a reference to an author created in the same batch', () => {
    const changes: FileChange[] = [
      { path: 'cms/content/post/hello.md', content: post('author: author/jane\n') },
      { path: 'cms/content/author/jane.md', content: '---\nname: Jane\n---\n' },
    ];
    expect(validateChanges(current(), changes)).toEqual([]);
  });

  it('accepts a reference to an author already on disk', () => {
    const changes: FileChange[] = [{ path: 'cms/content/post/hello.md', content: post('author: author/jane\n') }];
    expect(validateChanges(current(['cms/content/author/jane.md']), changes)).toEqual([]);
  });

  it('reports a dangling reference', () => {
    const changes: FileChange[] = [{ path: 'cms/content/post/hello.md', content: post('author: author/ghost\n') }];
    expect(validateChanges(current(), changes)).toEqual([
      { file: 'cms/content/post/hello.md', path: 'author', message: 'Referenced entry not found: author/ghost' },
    ]);
  });

  it('reports a reference to an author deleted in the same batch', () => {
    const changes: FileChange[] = [
      { path: 'cms/content/post/hello.md', content: post('author: author/jane\n') },
      { path: 'cms/content/author/jane.md', content: null },
    ];
    const issues = validateChanges(current(['cms/content/author/jane.md']), changes);
    expect(issues).toEqual([
      { file: 'cms/content/post/hello.md', path: 'author', message: 'Referenced entry not found: author/jane' },
    ]);
  });

  it('checks image files against the post-change file set', () => {
    const md = post('cover:\n  src: hello/cover.webp\n  alt: Cover\n');
    const missing = validateChanges(current(), [{ path: 'cms/content/post/hello.md', content: md }]);
    expect(missing).toEqual([
      {
        file: 'cms/content/post/hello.md',
        path: 'cover.src',
        message: 'Image file not found: cms/content/post/hello/cover.webp',
      },
    ]);
    const added = validateChanges(current(), [
      { path: 'cms/content/post/hello.md', content: md },
      { path: 'cms/content/post/hello/cover.webp', content: new Uint8Array([1, 2, 3]) },
    ]);
    expect(added).toEqual([]);
  });

  it('reports schema parse failures with the schema file and skips entries', () => {
    const changes: FileChange[] = [
      { path: SCHEMA_PATH, content: JSON.stringify({ ...schemaJson, contentDir: '' }) },
      { path: 'cms/content/post/hello.md', content: '---\nfoo: 1\n---\n' },
    ];
    const issues = validateChanges(current(), changes);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.file === SCHEMA_PATH)).toBe(true);
    expect(issues.map((i) => i.path)).toContain('contentDir');
  });

  it('reports invalid schema JSON', () => {
    const issues = validateChanges(current(), [{ path: SCHEMA_PATH, content: '{ nope' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: SCHEMA_PATH, path: '' });
    expect(issues[0].message).toContain('Invalid JSON');
  });

  it('validates entries in the batch against the new schema', () => {
    const next = structuredClone(schemaJson) as typeof schemaJson & {
      collections: Record<string, unknown>;
    };
    next.collections.page = { label: 'Page', fields: { heading: { type: 'string', label: 'H', required: true } } };
    const ok = validateChanges(current(), [
      { path: SCHEMA_PATH, content: JSON.stringify(next) },
      { path: 'cms/content/page/about.md', content: '---\nheading: About\n---\n' },
    ]);
    expect(ok).toEqual([]);
    const bad = validateChanges(current(), [
      { path: SCHEMA_PATH, content: new TextEncoder().encode(JSON.stringify(next)) },
      { path: 'cms/content/page/about.md', content: '---\ntitle: About\n---\n' },
    ]);
    expect(bad).toContainEqual({ file: 'cms/content/page/about.md', path: 'heading', message: 'Required' });
  });

  it('accepts a valid schema change on its own', () => {
    expect(validateChanges(current(), [{ path: SCHEMA_PATH, content: JSON.stringify(schemaJson) }])).toEqual([]);
  });

  describe('when the current schema is broken', () => {
    it('accepts a valid schema change', () => {
      expect(validateChanges(current([], null), [{ path: SCHEMA_PATH, content: JSON.stringify(schemaJson) }])).toEqual(
        [],
      );
    });

    it('reports issues of an invalid schema change', () => {
      const issues = validateChanges(current([], null), [{ path: SCHEMA_PATH, content: '{' }]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({ file: SCHEMA_PATH, path: '' });
    });

    it('rejects deleting the schema', () => {
      expect(validateChanges(current([], null), [{ path: SCHEMA_PATH, content: null }])).toEqual([
        { file: SCHEMA_PATH, path: '', message: 'The schema file cannot be deleted' },
      ]);
    });

    it('rejects any other change, even with a valid schema in the batch', () => {
      const issues = validateChanges(current([], null), [
        { path: SCHEMA_PATH, content: JSON.stringify(schemaJson) },
        { path: 'cms/content/author/jane.md', content: '---\nname: Jane\n---\n' },
        { path: 'cms/content/post/x.webp', content: null },
      ]);
      expect(issues).toEqual([
        {
          file: 'cms/content/author/jane.md',
          path: '',
          message: 'The schema (cms/schema.json) is invalid; fix it first',
        },
        { file: 'cms/content/post/x.webp', path: '', message: 'The schema (cms/schema.json) is invalid; fix it first' },
      ]);
    });
  });
});

describe('validateChanges duplicates', () => {
  it('rejects the same path twice in one batch', () => {
    const issues = validateChanges(current(), [
      { path: 'cms/content/author/jane.md', content: '---\nname: Jane\n---\n' },
      { path: 'cms/content/author/jane.md', content: null },
    ]);
    expect(issues).toEqual([{ file: 'cms/content/author/jane.md', path: '', message: 'Duplicate path in changes' }]);
  });
});

function withSchema(edit: (next: any) => void): FileChange {
  const next = structuredClone(schemaJson) as any;
  edit(next);
  return { path: SCHEMA_PATH, content: JSON.stringify(next) };
}

describe('validateChanges project-wide checks (with read and list)', () => {
  const base: Record<string, string> = {
    'cms/content/post/hello.md': post('author: author/jane\ncover:\n  src: hello/cover.webp\n  alt: Cover\n'),
    'cms/content/author/jane.md': '---\nname: Jane\n---\n',
    'cms/content/post/hello/cover.webp': 'img',
  };
  function project(extra: Record<string, string | undefined> = {}) {
    const files = { ...base, ...extra };
    return {
      ...current(Object.keys(files)),
      read: (path: string) => files[path],
      list: () => Object.keys(files),
    };
  }

  it('reports an unchanged entry that references a deleted author', () => {
    expect(validateChanges(project(), [{ path: 'cms/content/author/jane.md', content: null }])).toEqual([
      { file: 'cms/content/post/hello.md', path: 'author', message: 'Referenced entry not found: author/jane' },
    ]);
  });

  it('reports an unchanged entry whose image is deleted', () => {
    expect(validateChanges(project(), [{ path: 'cms/content/post/hello/cover.webp', content: null }])).toEqual([
      {
        file: 'cms/content/post/hello.md',
        path: 'cover.src',
        message: 'Image file not found: cms/content/post/hello/cover.webp',
      },
    ]);
  });

  it('accepts a delete when nothing depends on it', () => {
    expect(validateChanges(project(), [{ path: 'cms/content/post/hello.md', content: null }])).toEqual([]);
  });

  it('reports existing entries broken by a schema change', () => {
    const change = withSchema((next) => {
      next.collections.author.fields.bio = { type: 'string', label: 'Bio', required: true };
    });
    expect(validateChanges(project(), [change])).toEqual([
      { file: 'cms/content/author/jane.md', path: 'bio', message: 'Required' },
    ]);
  });

  it('reports entries left behind by a removed collection', () => {
    const change = withSchema((next) => {
      delete next.collections.post.fields.author;
      delete next.collections.author;
    });
    expect(validateChanges(project(), [change])).toEqual([
      { file: 'cms/content/post/hello.md', path: 'author', message: 'Unknown field' },
      { file: 'cms/content/author/jane.md', path: '', message: 'Not an entry file' },
    ]);
  });

  it('skips hidden, non-markdown and unreadable files', () => {
    const files = project({
      'cms/content/post/.drafts/x.md': 'junk',
      'cms/content/post/notes.txt': 'junk',
      'cms/content/author/bob.md': undefined,
    });
    expect(validateChanges(files, [{ path: 'cms/content/post/hello/cover.webp', content: null }])).toEqual([
      {
        file: 'cms/content/post/hello.md',
        path: 'cover.src',
        message: 'Image file not found: cms/content/post/hello/cover.webp',
      },
    ]);
  });

  const messy = () =>
    project({
      'cms/content/README.md': '# Notes',
      'cms/content/author/bob.md': '---\nfoo: 1\n---\n',
      'cms/content/post/old.md': post('author: author/ghost\n'),
    });

  describe('reports only issues the batch introduces', () => {
    it('lets an unrelated delete pass next to a stray .md and broken entries', () => {
      expect(validateChanges(messy(), [{ path: 'cms/content/post/hello.md', content: null }])).toEqual([]);
    });

    it('lets an unchanged schema save pass', () => {
      expect(validateChanges(messy(), [withSchema(() => {})])).toEqual([]);
    });

    it('still reports a delete of a referenced author', () => {
      expect(validateChanges(messy(), [{ path: 'cms/content/author/jane.md', content: null }])).toEqual([
        { file: 'cms/content/post/hello.md', path: 'author', message: 'Referenced entry not found: author/jane' },
      ]);
    });

    it('reports a new issue on an already broken entry', () => {
      const change = withSchema((next) => {
        next.collections.author.fields.bio = { type: 'string', label: 'Bio', required: true };
      });
      expect(validateChanges(messy(), [change])).toEqual([
        { file: 'cms/content/author/jane.md', path: 'bio', message: 'Required' },
        { file: 'cms/content/author/bob.md', path: 'bio', message: 'Required' },
      ]);
    });
  });

  it('checks only the changed entries when the batch has no delete or schema change', () => {
    const files = project({ 'cms/content/post/broken.md': '---\nfoo: 1\n---\n' });
    expect(validateChanges(files, [{ path: 'cms/content/author/bob.md', content: '---\nname: Bob\n---\n' }])).toEqual(
      [],
    );
  });

  it('does not cross-check without read', () => {
    expect(
      validateChanges(current(Object.keys(base)), [{ path: 'cms/content/author/jane.md', content: null }]),
    ).toEqual([]);
  });
});
