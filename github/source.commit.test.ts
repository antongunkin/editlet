// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient, GitHubError } from './client.ts';
import { createGitHubSource, type GitHubFileChange, type GitHubSource, type GitHubSourceOptions } from './source.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

import { gitBlobSha } from '../core/sha.ts';
import type { ContentSource } from '../core/source.ts';

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
  },
});

const HELLO = '---\ntitle: Hello\nauthor: author/jane\n---\nHi there\n';
const WORLD = '---\ntitle: World\n---\n';
const JANE = '---\nname: Jane\n---\n';
const IMAGE = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe, 0x80,
]);

const FILES: Record<string, FileInput> = {
  'cms/schema.json': SCHEMA,
  'cms/content/post/hello.md': HELLO,
  'cms/content/post/world.md': WORLD,
  'cms/content/author/jane.md': JANE,
  'README.md': '# Site\n',
};

const CONFLICT = 'Changed on GitHub since it was read; reload and review';
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function setup(opts: { branches?: Record<string, Record<string, FileInput>> } = {}) {
  const fake = createFakeGitHub({ branches: opts.branches ?? { main: FILES, 'editlet/edit': FILES } });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  const cache = createMemoryCache();
  const make = (extra: Partial<GitHubSourceOptions> = {}) =>
    createGitHubSource({ owner: 'o', repo: 'r', branch: 'editlet/edit', client, cache, ...extra });
  return { fake, client, cache, make, source: make() };
}

const commitOps = (calls: { operation?: string }[]) => calls.filter((c) => c.operation === 'Commit').length;

/** The file content at the head of `branch` in the fake. */
function headFile(fake: ReturnType<typeof createFakeGitHub>, branch: string, path: string): string | undefined {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path);
  return sha === undefined ? undefined : decode(fake.state.blobs.get(sha)!);
}

describe('GitHubSource.commit', () => {
  it('is a ContentSource', () => {
    expectTypeOf<GitHubSource>().toExtend<ContentSource>();
    expectTypeOf<GitHubFileChange>().toExtend<{ path: string; sha?: string | null }>();
  });

  it('commits an entry and the next read sees it without refetch', async () => {
    const { source, fake } = setup();
    await source.listFiles();
    const content = '---\ntitle: New\n---\nBody\n';
    const result = await source.commit([{ path: 'cms/content/post/new.md', content }], 'Add new');
    expect(result.issues).toEqual([]);
    const oid = fake.state.refs.get('editlet/edit')!;
    expect(result.commit).toEqual({ oid, url: `https://github.com/o/r/commit/${oid}` });
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/new.md')).toBe(content);

    const from = fake.calls.length;
    expect(await source.head()).toBe(oid);
    expect(decode(await source.readFile('cms/content/post/new.md'))).toBe(content);
    expect(decode(await source.readFile('cms/content/post/hello.md'))).toBe(HELLO);
    expect(fake.calls.slice(from).filter((c) => c.operation !== 'Blobs')).toEqual([]);
    expect(fake.calls.slice(from).filter((c) => c.operation === 'Blobs')).toHaveLength(1); // hello.md, never read
  });

  it('refuses base branch', async () => {
    const { make, fake } = setup();
    const main = make({ branch: 'main' });
    const change = [{ path: 'cms/content/post/new.md', content: WORLD }];
    expect(await main.commit(change, 'x')).toEqual({
      issues: [{ path: '', message: 'Commits must go to a branch named editlet/*, not "main"' }],
    });
    fake.commit('editlet/base', FILES);
    const base = make({ branch: 'editlet/base', baseBranch: 'editlet/base' });
    expect((await base.commit(change, 'x')).issues).toEqual([
      { path: '', message: 'Commits must go to a branch named editlet/*, not "editlet/base"' },
    ]);
    expect(commitOps(fake.calls)).toBe(0);
  });

  it('returns validation issues and writes nothing', async () => {
    const { source, fake } = setup();
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit([{ path: 'cms/content/post/bad.md', content: '---\nauthor: x\n---\n' }], '');
    expect(result.commit).toBeUndefined();
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: 'cms/content/post/bad.md', path: 'title' }),
        { path: '', message: 'Commit message is required' },
      ]),
    );
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    expect(commitOps(fake.calls)).toBe(0);
  });

  it('deleting a referenced author is refused', async () => {
    const { source, fake } = setup();
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit([{ path: 'cms/content/author/jane.md', content: null }], 'Remove Jane');
    expect(result.issues).toEqual([expect.objectContaining({ file: 'cms/content/post/hello.md', path: 'author' })]);
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    // deleting an unreferenced entry goes through
    const ok = await source.commit([{ path: 'cms/content/post/world.md', content: null }], 'Remove world');
    expect(ok.issues).toEqual([]);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBeUndefined();
  });

  it('conflict when the file changed on GitHub', async () => {
    const { source, fake } = setup();
    await source.listFiles();
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Theirs\n---\n' });
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit(
      [
        { path: 'cms/content/post/hello.md', content: '---\ntitle: Mine\n---\n' },
        { path: 'cms/content/post/world.md', content: '---\ntitle: World 2\n---\n' },
      ],
      'Edit',
    );
    expect(result).toEqual({ issues: [{ file: 'cms/content/post/hello.md', path: '', message: CONFLICT }] });
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBe(WORLD);
  });

  it('listFiles between a read and a save does not hide a foreign edit', async () => {
    const { source, fake } = setup();
    await source.readFile('cms/content/post/hello.md');
    fake.commit('editlet/edit', { 'cms/content/post/hello.md': '---\ntitle: Theirs\n---\n' });
    await source.listFiles(); // reloads the snapshot: it now holds the foreign sha
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit(
      [{ path: 'cms/content/post/hello.md', content: '---\ntitle: Mine\n---\n' }],
      'x',
    );
    expect(result).toEqual({ issues: [{ file: 'cms/content/post/hello.md', path: '', message: CONFLICT }] });
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    expect(commitOps(fake.calls)).toBe(0);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/hello.md')).toBe('---\ntitle: Theirs\n---\n');
    // after reading the new version, the same save goes through
    await source.readFile('cms/content/post/hello.md');
    expect(
      (await source.commit([{ path: 'cms/content/post/hello.md', content: '---\ntitle: Mine\n---\n' }], 'x')).issues,
    ).toEqual([]);
  });

  it('a commit updates the served sha, so the next save is based on it', async () => {
    const { source, fake } = setup();
    await source.readFile('cms/content/post/world.md');
    expect(
      (await source.commit([{ path: 'cms/content/post/world.md', content: '---\ntitle: W2\n---\n' }], 'a')).issues,
    ).toEqual([]);
    expect(
      (await source.commit([{ path: 'cms/content/post/world.md', content: '---\ntitle: W3\n---\n' }], 'b')).issues,
    ).toEqual([]);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBe('---\ntitle: W3\n---\n');
    // a delete forgets the path: re-adding it expects the file to be absent
    expect((await source.commit([{ path: 'cms/content/post/world.md', content: null }], 'c')).issues).toEqual([]);
    expect((await source.commit([{ path: 'cms/content/post/world.md', content: WORLD }], 'd')).issues).toEqual([]);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBe(WORLD);
  });

  it('explicit sha conflicts even with a fresh snapshot', async () => {
    const { source, fake } = setup();
    await source.listFiles();
    const stale = await gitBlobSha('---\ntitle: Older\n---\n');
    const result = await source.commit(
      [
        { path: 'cms/content/post/hello.md', content: '---\ntitle: Mine\n---\n', sha: stale },
        { path: 'cms/content/post/world.md', content: '---\ntitle: Taken\n---\n', sha: null },
      ],
      'Edit',
    );
    expect(result.issues).toEqual([
      { file: 'cms/content/post/hello.md', path: '', message: CONFLICT },
      { file: 'cms/content/post/world.md', path: '', message: CONFLICT },
    ]);
    expect(commitOps(fake.calls)).toBe(0);
    // the matching explicit sha passes
    const ok = await source.commit(
      [{ path: 'cms/content/post/hello.md', content: '---\ntitle: Mine\n---\n', sha: await gitBlobSha(HELLO) }],
      'Edit',
    );
    expect(ok.issues).toEqual([]);
  });

  it('unrelated concurrent commit retries', async () => {
    const { source, fake, make } = setup();
    await source.listFiles();
    const other = make();
    await other.listFiles();
    expect(
      (await other.commit([{ path: 'cms/content/author/ann.md', content: '---\nname: Ann\n---\n' }], 'Ann')).issues,
    ).toEqual([]);
    const result = await source.commit([{ path: 'cms/content/post/world.md', content: '---\ntitle: W2\n---\n' }], 'W2');
    expect(result.issues).toEqual([]);
    expect(commitOps(fake.calls)).toBe(3); // Ann, stale W2, W2
    expect(headFile(fake, 'editlet/edit', 'cms/content/author/ann.md')).toBe('---\nname: Ann\n---\n');
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBe('---\ntitle: W2\n---\n');
    expect(await source.head()).toBe(fake.state.refs.get('editlet/edit'));
    expect(decode(await source.readFile('cms/content/author/ann.md'))).toContain('Ann');
  });

  it('a stale retry re-validates on the reloaded snapshot', async () => {
    const unreferenced = { ...FILES, 'cms/content/post/hello.md': WORLD };
    const { source, fake, make } = setup({ branches: { main: unreferenced, 'editlet/edit': unreferenced } });
    await source.listFiles();
    // a foreign commit (another tab) adds a reference to jane; this source has not seen it
    const other = make();
    const linked = '---\ntitle: World\nauthor: author/jane\n---\n';
    expect((await other.commit([{ path: 'cms/content/post/world.md', content: linked }], 'Link')).issues).toEqual([]);
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit([{ path: 'cms/content/author/jane.md', content: null }], 'Remove Jane');
    expect(result.issues).toEqual([expect.objectContaining({ file: 'cms/content/post/world.md', path: 'author' })]);
    expect(result.commit).toBeUndefined();
    expect(commitOps(fake.calls)).toBe(2); // Link, then the stale attempt; nothing after the reload
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    expect(headFile(fake, 'editlet/edit', 'cms/content/author/jane.md')).toBe(JANE);
  });

  it('retry after applied commit is a no-op', async () => {
    const { source, fake } = setup();
    const stale = source.withBranch('editlet/edit');
    await stale.listFiles();
    const change = [
      { path: 'cms/content/post/hello.md', content: '---\ntitle: Hello 2\nauthor: author/jane\n---\n' },
      { path: 'cms/content/post/world.md', content: null },
    ];
    expect((await source.commit(change, 'Edit')).issues).toEqual([]);
    const head = fake.state.refs.get('editlet/edit');
    const ops = commitOps(fake.calls);
    expect(await stale.commit(change, 'Edit')).toEqual({ issues: [] });
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
    expect(commitOps(fake.calls)).toBe(ops + 1); // one stale attempt, then nothing left to commit
    expect(await stale.head()).toBe(head);
  });

  it('binary image commit round-trips base64', async () => {
    const { source, fake, client } = setup();
    const big = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    const result = await source.commit(
      [
        { path: 'cms/content/post/img/a.png', content: IMAGE },
        { path: 'cms/content/post/img/b.png', content: big },
      ],
      'Images',
    );
    expect(result.issues).toEqual([]);
    const files = fake.state.commits.get(fake.state.refs.get('editlet/edit')!)!.files;
    expect(fake.state.blobs.get(files.get('cms/content/post/img/a.png')!)).toEqual(IMAGE);
    expect(fake.state.blobs.get(files.get('cms/content/post/img/b.png')!)).toEqual(big);
    const fresh = createGitHubSource({
      owner: 'o',
      repo: 'r',
      branch: 'editlet/edit',
      client,
      cache: createMemoryCache(),
    });
    expect(await fresh.readFile('cms/content/post/img/a.png')).toEqual(IMAGE);
    expect(await fresh.readFile('cms/content/post/img/b.png')).toEqual(big);
  });

  it('too large batch is refused', async () => {
    const { source, fake } = setup();
    const half = new Uint8Array(10 * 1024 * 1024 + 1);
    const result = await source.commit(
      [
        { path: 'cms/content/post/img/a.png', content: half },
        { path: 'cms/content/post/img/b.png', content: half },
      ],
      'Big',
    );
    expect(result.issues).toEqual([{ path: '', message: 'Changes are too large for one commit (max 20 MB)' }]);
    expect(commitOps(fake.calls)).toBe(0);
  });

  it('deleting a missing file is an issue', async () => {
    const { source, fake } = setup();
    const result = await source.commit([{ path: 'cms/content/post/nope.md', content: null }], 'Delete');
    expect(result.issues).toEqual([{ file: 'cms/content/post/nope.md', path: '', message: 'File not found' }]);
    expect(commitOps(fake.calls)).toBe(0);
  });

  it('gives up after 3 stale attempts', async () => {
    const { source, fake } = setup();
    await source.listFiles();
    let n = 0;
    fake.state.options.beforeCommit = () => {
      fake.commit('editlet/edit', { [`cms/content/author/a${n++}.md`]: '---\nname: A\n---\n' });
    };
    const head = () => fake.state.refs.get('editlet/edit');
    const result = await source.commit([{ path: 'cms/content/post/world.md', content: '---\ntitle: W\n---\n' }], 'W');
    expect(result).toEqual({ issues: [{ path: '', message: 'Branch keeps changing; try again' }] });
    expect(commitOps(fake.calls)).toBe(3);
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/world.md')).toBe(WORLD);
    expect(head()).toBeDefined();
  });

  it('commit message headline and body', async () => {
    const { source, fake } = setup();
    const inputs: unknown[] = [];
    fake.state.options.beforeCommit = (input) => inputs.push(input);
    await source.commit([{ path: 'cms/content/post/a.md', content: WORLD }], '  Add a\n\nWhy:\n- because\n\n');
    await source.commit([{ path: 'cms/content/post/b.md', content: WORLD }], 'Add b');
    expect(inputs[0]).toMatchObject({
      branch: { repositoryNameWithOwner: 'o/r', branchName: 'editlet/edit' },
      message: { headline: 'Add a', body: 'Why:\n- because' },
      fileChanges: { additions: [{ path: 'cms/content/post/a.md' }] },
    });
    expect((inputs[1] as { message: unknown }).message).toEqual({ headline: 'Add b' });
    const head = fake.state.commits.get(fake.state.refs.get('editlet/edit')!)!;
    expect(head.message).toBe('Add b');
    expect(fake.state.commits.get(head.parent!)!.message).toBe('Add a\n\nWhy:\n- because');
  });

  it('a broken schema can be fixed on a cms branch', async () => {
    const { source, fake } = setup({ branches: { main: FILES, 'editlet/edit': { ...FILES, 'cms/schema.json': '{' } } });
    const entry = await source.commit([{ path: 'cms/content/post/a.md', content: WORLD }], 'Entry');
    expect(entry.issues).toEqual([
      { file: 'cms/content/post/a.md', path: '', message: 'The schema (cms/schema.json) is invalid; fix it first' },
    ]);
    const fixed = await source.commit([{ path: 'cms/schema.json', content: SCHEMA }], 'Fix schema');
    expect(fixed.issues).toEqual([]);
    expect(headFile(fake, 'editlet/edit', 'cms/schema.json')).toBe(SCHEMA);
    expect(await source.baseBranch()).toBe('main');
    expect((await source.commit([{ path: 'cms/content/post/a.md', content: WORLD }], 'Entry')).issues).toEqual([]);
  });

  it('a schema change re-checks every entry and updates the snapshot', async () => {
    const { source, fake } = setup();
    const strict = JSON.parse(SCHEMA);
    strict.collections.author.fields.bio = { type: 'string', label: 'Bio', required: true };
    const refused = await source.commit([{ path: 'cms/schema.json', content: JSON.stringify(strict) }], 'Strict');
    expect(refused.issues).toEqual([expect.objectContaining({ file: 'cms/content/author/jane.md', path: 'bio' })]);
    const renamed = JSON.parse(SCHEMA);
    renamed.collections.post.label = 'Article';
    const text = JSON.stringify(renamed);
    expect((await source.commit([{ path: 'cms/schema.json', content: text }], 'Rename')).issues).toEqual([]);
    const from = fake.calls.length;
    expect(decode(await source.readFile('cms/schema.json'))).toBe(text);
    expect(fake.calls.length).toBe(from);
  });

  describe('a batch that moves contentDir', () => {
    const THEIRS = '---\ntitle: Theirs\n---\n';
    const MINE = '---\ntitle: Mine\n---\n';
    const moved = (() => {
      const schema = JSON.parse(SCHEMA);
      schema.contentDir = 'site';
      return JSON.stringify(schema);
    })();
    // The old contentDir holds no entries (they could not be moved in the same batch); `site/` already has one.
    const branches = (extra: Record<string, FileInput> = {}) => {
      const files = { 'cms/schema.json': SCHEMA, 'site/post/hello.md': THEIRS, ...extra };
      return { main: files, 'editlet/edit': files };
    };

    it('conflicts on a path that already exists under the new directory', async () => {
      const { source, fake } = setup({ branches: branches() });
      await source.listFiles();
      const head = fake.state.refs.get('editlet/edit');
      const result = await source.commit(
        [
          { path: 'cms/schema.json', content: moved },
          { path: 'site/post/hello.md', content: MINE },
        ],
        'Move',
      );
      expect(result).toEqual({ issues: [{ file: 'site/post/hello.md', path: '', message: CONFLICT }] });
      expect(fake.state.refs.get('editlet/edit')).toBe(head);
      expect(headFile(fake, 'editlet/edit', 'site/post/hello.md')).toBe(THEIRS);
      expect(commitOps(fake.calls)).toBe(0);
    });

    it('commits when the expected sha of that path is given', async () => {
      const { source, fake } = setup({ branches: branches() });
      const result = await source.commit(
        [
          { path: 'cms/schema.json', content: moved },
          { path: 'site/post/hello.md', content: MINE, sha: await gitBlobSha(THEIRS) },
        ],
        'Move',
      );
      expect(result.issues).toEqual([]);
      expect(headFile(fake, 'editlet/edit', 'site/post/hello.md')).toBe(MINE);
      expect(headFile(fake, 'editlet/edit', 'cms/schema.json')).toBe(moved);
      // the snapshot is reloaded for the new directory
      expect(decode(await source.readFile('site/post/hello.md'))).toBe(MINE);
    });

    it('re-checks entries already in the new directory', async () => {
      const { source, fake } = setup({ branches: branches({ 'site/author/x.md': '---\n---\n' }) });
      const head = fake.state.refs.get('editlet/edit');
      const result = await source.commit([{ path: 'cms/schema.json', content: moved }], 'Move');
      expect(result.issues).toEqual([expect.objectContaining({ file: 'site/author/x.md', path: 'name' })]);
      expect(fake.state.refs.get('editlet/edit')).toBe(head);
    });
  });

  it('rejects on non-stale GitHub errors', async () => {
    const { source, fake } = setup();
    fake.state.options.beforeCommit = () => {
      fake.state.refs.delete('editlet/edit');
    };
    await expect(source.commit([{ path: 'cms/content/post/a.md', content: WORLD }], 'A')).rejects.toBeInstanceOf(
      GitHubError,
    );
  });
});

describe('GitHubSource.commit edge cases', () => {
  it('refuses a batch that names a path twice, before reading anything', async () => {
    const { source, fake } = setup();
    const head = fake.state.refs.get('editlet/edit');
    const result = await source.commit(
      [
        { path: 'cms/content/post/a.md', content: WORLD },
        { path: 'cms/content/post/a.md', content: null },
      ],
      'Twice',
    );
    expect(result).toEqual({
      issues: [{ file: 'cms/content/post/a.md', path: '', message: 'Duplicate path in changes' }],
    });
    expect(fake.state.refs.get('editlet/edit')).toBe(head);
  });

  it('returns the commit even when the blob cache cannot keep the new bytes', async () => {
    const { fake, make, cache } = setup();
    const text = '---\ntitle: Unique\n---\n';
    const sha = await gitBlobSha(text);
    const source = make({
      cache: {
        ...cache,
        putBlobs: (blobs) =>
          blobs.some((b) => b.sha === sha) ? Promise.reject(new Error('quota exceeded')) : cache.putBlobs(blobs),
      },
    });
    const result = await source.commit([{ path: 'cms/content/post/a.md', content: text }], 'Add a');
    expect(result.issues).toEqual([]);
    expect(result.commit?.oid).toBe(fake.state.refs.get('editlet/edit'));
    expect(headFile(fake, 'editlet/edit', 'cms/content/post/a.md')).toBe(text);
  });

  it('ignores a batch schema that is not UTF-8 or not valid when checking a moved contentDir', async () => {
    const { source } = setup();
    const bad = await source.commit([{ path: 'cms/schema.json', content: new Uint8Array([0xff, 0xfe]) }], 'Bad');
    expect(bad.issues.length).toBeGreaterThan(0);
    const broken = await source.commit([{ path: 'cms/schema.json', content: '{"contentDir": 1}' }], 'Broken');
    expect(broken.issues.length).toBeGreaterThan(0);
  });
});
