// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient, GitHubError } from './client.ts';
import { createGitHubSource, type GitHubSource, type GitHubSourceOptions } from './source.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

import { AuthError } from '../auth/client.ts';
import { EditletError } from '../core/issues.ts';
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

const HELLO = '---\ntitle: Hello\nauthor: author/jane\n---\nHi there é\n';
const WORLD = '---\ntitle: World\n---\n';
const JANE = '---\nname: Jane\n---\n';
const BOM = '﻿---\r\nname: Bom\r\n---\r\n';
const IMAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0xff, 0xfe]);

const FILES: Record<string, FileInput> = {
  'cms/schema.json': SCHEMA,
  'cms/content/post/hello.md': HELLO,
  'cms/content/post/world.md': WORLD,
  'cms/content/post/img/cover.png': IMAGE,
  'cms/content/author/jane.md': JANE,
  'cms/content/author/bom.md': BOM,
  'cms/content/.draft/x.md': '---\ntitle: Draft\n---\n',
  'cms/content/post/.hidden.md': 'hidden',
  'README.md': '# Site\n',
  'src/page.tsx': 'export {}\n',
};
const TEXT_PATHS = [
  'cms/content/author/bom.md',
  'cms/content/author/jane.md',
  'cms/content/post/hello.md',
  'cms/content/post/world.md',
];
const VISIBLE = ['cms/content/post/img/cover.png', 'cms/schema.json', ...TEXT_PATHS].toSorted();

const bytesOf = (c: FileInput) => (typeof c === 'string' ? new TextEncoder().encode(c) : c);

function setup(opts: { branches?: Record<string, Record<string, FileInput>>; token?: string } = {}) {
  const fake = createFakeGitHub({
    branches: opts.branches ?? { main: FILES, 'editlet/edit': { ...FILES, 'cms/content/post/new.md': WORLD } },
  });
  const client = createGitHubClient({ token: opts.token ?? 'tok', fetch: fake.fetch });
  const cache = createMemoryCache();
  const make = (extra: Partial<GitHubSourceOptions> = {}) =>
    createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache, ...extra });
  return { fake, client, cache, make, source: make() };
}

const blobOps = (calls: { operation?: string }[]) => calls.filter((c) => c.operation === 'Blobs').length;
const rawGets = (calls: { method: string; url: string }[]) =>
  calls.filter((c) => c.method === 'GET' && c.url.includes('/git/blobs/'));
async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('expected rejection');
    },
    (e: unknown) => e,
  );
}

describe('createGitHubSource (read side)', () => {
  it('is a github source with owner, repo, branch and a pending queue scoped to them', async () => {
    const { source, cache } = setup();
    expect(source.kind).toBe('github');
    expect([source.owner, source.repo, source.branch]).toEqual(['o', 'r', 'main']);
    await source.pending.put({ path: 'a.md', content: 'x', sha: null });
    expect(await cache.pending('o/r#main').get('a.md')).toMatchObject({ content: 'x' });
  });

  it('implements the optional ContentSource.readFiles, so a caller can batch through the contract', async () => {
    expectTypeOf<GitHubSource>().toExtend<ContentSource>();
    expectTypeOf<GitHubSource['readFiles']>().toExtend<NonNullable<ContentSource['readFiles']>>();
    const { source } = setup();
    const contract: ContentSource = source;
    const read = await contract.readFiles!(['cms/content/post/hello.md']);
    expect(new TextDecoder().decode(read.get('cms/content/post/hello.md'))).toBe(HELLO);
  });

  it('requires exactly one of token or client', () => {
    const { client } = setup();
    const base = { owner: 'o', repo: 'r', branch: 'main', cache: createMemoryCache() };
    expect(() => createGitHubSource(base)).toThrow(TypeError);
    expect(() => createGitHubSource({ ...base, token: 't', client })).toThrow(TypeError);
    expect(createGitHubSource({ ...base, token: 't' }).kind).toBe('github');
  });

  it('listFiles returns content and schema with git blob shas', async () => {
    const { source } = setup();
    const list = await source.listFiles();
    expect(list.map((f) => f.path)).toEqual(VISIBLE);
    for (const f of list) expect(f.sha).toBe(await gitBlobSha(bytesOf(FILES[f.path]!)));
  });

  it('readFiles batches text in one graphql query and binary over REST', async () => {
    const { source, fake } = setup();
    await source.listFiles();
    const from = fake.calls.length;
    const paths = ['cms/content/post/img/cover.png', ...TEXT_PATHS];
    const files = await source.readFiles(paths);
    expect([...files.keys()]).toEqual(paths);
    for (const p of paths) expect(files.get(p)).toEqual(bytesOf(FILES[p]!));
    const calls = fake.calls.slice(from);
    expect(blobOps(calls)).toBe(1);
    expect(rawGets(calls).map((c) => c.url)).toEqual([
      `https://api.github.com/repos/o/r/git/blobs/${await gitBlobSha(IMAGE)}`,
    ]);
  });

  it('chunks graphql blob reads at 50 per query', async () => {
    const many: Record<string, FileInput> = { 'cms/schema.json': SCHEMA };
    for (let i = 0; i < 120; i++) many[`cms/content/author/a${i}.md`] = `---\nname: A${i}\n---\n`;
    const { source, fake } = setup({ branches: { main: many } });
    const paths = (await source.listFiles()).map((f) => f.path).filter((p) => p !== 'cms/schema.json');
    const from = fake.calls.length;
    const files = await source.readFiles(paths);
    expect(files.size).toBe(120);
    expect(blobOps(fake.calls.slice(from))).toBe(3);
    expect(rawGets(fake.calls)).toHaveLength(0);
  });

  it('caches each graphql chunk as it lands: a failed chunk leaves the others cached', async () => {
    const many: Record<string, FileInput> = { 'cms/schema.json': SCHEMA };
    for (let i = 0; i < 120; i++) many[`cms/content/author/a${i}.md`] = `---\nname: A${i}\n---\n`;
    const fake = createFakeGitHub({ branches: { main: many } });
    let blobQueries = 0;
    const failing: typeof fetch = async (input, init) => {
      if (typeof init?.body === 'string' && init.body.includes('query Blobs') && ++blobQueries === 2)
        return new Response(JSON.stringify({ errors: [{ message: 'Something went wrong' }] }), { status: 200 });
      return fake.fetch(input, init);
    };
    const cache = createMemoryCache();
    const client = createGitHubClient({ token: 'tok', fetch: failing });
    const source = createGitHubSource({ owner: 'o', repo: 'r', branch: 'main', client, cache });
    const listed = (await source.listFiles()).filter((f) => f.path !== 'cms/schema.json');
    const error = await rejection(source.readFiles(listed.map((f) => f.path)));
    expect(error).toMatchObject({ code: 'graphql_error' });
    // The two other chunks land (they were in flight when the second failed) and stay cached by sha.
    await vi.waitFor(async () => expect((await cache.getBlobs(listed.map((f) => f.sha))).size).toBe(70));
  });

  it('second read is served from cache', async () => {
    const { source, fake, make } = setup();
    await source.readFiles(TEXT_PATHS);
    await source.readFile('cms/content/post/img/cover.png');
    const from = fake.calls.length;
    const fresh = make();
    const files = await fresh.readFiles([...TEXT_PATHS, 'cms/content/post/img/cover.png']);
    expect(files.get('cms/content/post/img/cover.png')).toEqual(IMAGE);
    const calls = fake.calls.slice(from);
    expect(calls.map((c) => c.operation).filter(Boolean)).toEqual(['Snapshot', 'Dir']);
    expect(blobOps(calls)).toBe(0);
    expect(rawGets(calls)).toHaveLength(0);
  });

  it('readFiles with keep: false returns the files and stores no blob, from GraphQL or REST', async () => {
    const { source, fake, cache } = setup();
    await source.listFiles();
    const put = vi.spyOn(cache, 'putBlobs');
    const paths = ['cms/content/post/img/cover.png', ...TEXT_PATHS];
    const shas = await Promise.all(paths.map((p) => gitBlobSha(bytesOf(FILES[p]!))));
    const from = fake.calls.length;
    const files = await source.readFiles(paths, { keep: false });
    for (const p of paths) expect(files.get(p)).toEqual(bytesOf(FILES[p]!));
    expect(put).not.toHaveBeenCalled();
    expect((await cache.getBlobs(shas)).size).toBe(0);
    // Nothing was kept, so the next read asks GitHub again.
    await source.readFiles(paths, { keep: false });
    expect(blobOps(fake.calls.slice(from))).toBe(2);
    expect(rawGets(fake.calls.slice(from))).toHaveLength(2);
  });

  it('readFiles with keep: false serves a cached blob from the cache, and a plain read keeps what it fetches', async () => {
    const { source, fake, cache } = setup();
    const image = 'cms/content/post/img/cover.png';
    const hello = 'cms/content/post/hello.md';
    // Plain reads keep entries and images, as before.
    await source.readFiles([hello, image]);
    const shas = [await gitBlobSha(HELLO), await gitBlobSha(IMAGE)];
    expect((await cache.getBlobs(shas)).size).toBe(2);
    const from = fake.calls.length;
    const files = await source.readFiles([hello, image], { keep: false });
    expect(files.get(hello)).toEqual(bytesOf(HELLO));
    expect(files.get(image)).toEqual(IMAGE);
    expect(blobOps(fake.calls.slice(from))).toBe(0);
    expect(rawGets(fake.calls.slice(from))).toHaveLength(0);
    // A file only read with keep: false is fetched again by the plain read, which keeps it.
    const world = 'cms/content/post/world.md';
    await source.readFiles([world], { keep: false });
    await source.readFile(world);
    await source.readFile(world);
    expect(blobOps(fake.calls.slice(from))).toBe(2);
  });

  it('falls back to raw on sha mismatch', async () => {
    const { source, fake } = setup();
    const sha = await gitBlobSha(BOM);
    fake.state.options.graphqlTextOverride.set(sha, BOM.slice(1).replace(/\r\n/g, '\n'));
    const bytes = await source.readFile('cms/content/author/bom.md');
    expect(bytes).toEqual(bytesOf(BOM));
    expect(rawGets(fake.calls).map((c) => c.url)).toEqual([`https://api.github.com/repos/o/r/git/blobs/${sha}`]);
  });

  it('falls back to raw for invalid UTF-8 and for text truncated at 512 KB', async () => {
    const latin1 = new Uint8Array([0x2d, 0x2d, 0x2d, 0x0a, 0x6e, 0x3a, 0x20, 0xe9, 0x0a]); // "---\nn: é\n" in latin-1
    const big = `---\nname: Big\n---\n${'x'.repeat(600_000)}\n`;
    const { source, fake } = setup({
      branches: {
        main: { 'cms/schema.json': SCHEMA, 'cms/content/author/l.md': latin1, 'cms/content/author/big.md': big },
      },
    });
    const files = await source.readFiles(['cms/content/author/l.md', 'cms/content/author/big.md']);
    expect(files.get('cms/content/author/l.md')).toEqual(latin1);
    expect(files.get('cms/content/author/big.md')).toEqual(bytesOf(big));
    expect(rawGets(fake.calls)).toHaveLength(2);
  });

  it('rejects a raw blob whose bytes do not match the sha', async () => {
    const { source, fake } = setup();
    const sha = await gitBlobSha(IMAGE);
    fake.state.blobs.set(sha, new Uint8Array([1, 2, 3]));
    const error = await rejection(source.readFile('cms/content/post/img/cover.png'));
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ code: 'http_error', message: 'Blob sha mismatch' });
  });

  it('walks subtrees when the tree is truncated', async () => {
    const { fake, make, source } = setup();
    const expected = await source.listFiles();
    // a source of its own: its first load reads the (truncated) trees; a reload of `source` would answer 304 for an
    // unchanged head (source.poll.test.ts)
    const truncated = make();
    fake.state.options.truncateTrees = true;
    const from = fake.calls.length;
    expect(await truncated.listFiles()).toEqual(expected);
    const treeGets = fake.calls.slice(from).filter((c) => c.url.includes('/git/trees/'));
    // one truncated recursive read, then content/, post/, post/img/, author/, .draft/ one level at a time
    expect(treeGets.filter((c) => c.url.includes('recursive'))).toHaveLength(1);
    expect(treeGets.filter((c) => !c.url.includes('recursive'))).toHaveLength(5);
  });

  it('keeps hidden files in the snapshot (readable) but out of listFiles', async () => {
    const { source } = setup();
    expect((await source.listFiles()).some((f) => f.path.includes('/.'))).toBe(false);
    expect(new TextDecoder().decode(await source.readFile('cms/content/.draft/x.md'))).toContain('Draft');
  });

  it('skips symlinks and submodules', async () => {
    const fake = createFakeGitHub({
      branches: {
        main: {
          'cms/schema.json': SCHEMA,
          'cms/content/author/jane.md': JANE,
          'cms/content/link.md': 'author/jane.md',
          'cms/content/sub': 'x',
        },
      },
      modes: { 'cms/content/link.md': '120000', 'cms/content/sub': '160000' },
    });
    const source = createGitHubSource({
      owner: 'o',
      repo: 'r',
      branch: 'main',
      client: createGitHubClient({ token: 't', fetch: fake.fetch }),
      cache: createMemoryCache(),
    });
    expect((await source.listFiles()).map((f) => f.path)).toEqual(['cms/content/author/jane.md', 'cms/schema.json']);
  });

  it('missing file rejects with EditletError', async () => {
    const { source } = setup();
    const one = await rejection(source.readFile('cms/content/post/nope.md'));
    expect(one).toBeInstanceOf(EditletError);
    expect((one as EditletError).message).toBe('File not found: cms/content/post/nope.md');
    const many = await rejection(source.readFiles(['cms/content/post/hello.md', 'a.md', 'b.md']));
    expect(many).toBeInstanceOf(EditletError);
    expect((many as EditletError).issues.map((i) => i.file)).toEqual(['a.md', 'b.md']);
  });

  it('missing branch rejects not_found', async () => {
    const { make } = setup();
    const error = await rejection(make({ branch: 'editlet/nope' }).listFiles());
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ code: 'not_found', message: 'Branch not found: editlet/nope' });
  });

  it('missing repository rejects not_found', async () => {
    const { make } = setup();
    const error = await rejection(make({ repo: 'other' }).listFiles());
    expect(error).toMatchObject({ code: 'not_found', message: 'Repository not found: o/other' });
  });

  it('broken schema lists only the schema file', async () => {
    for (const broken of ['{ not json', JSON.stringify({ contentDir: 'cms/content' })]) {
      const { source } = setup({ branches: { main: { ...FILES, 'cms/schema.json': broken } } });
      expect(await source.listFiles()).toEqual([{ path: 'cms/schema.json', sha: await gitBlobSha(broken) }]);
      const error = await rejection(source.baseBranch());
      expect(error).toMatchObject({ code: 'not_found', message: 'Base branch unknown: schema missing or invalid' });
    }
  });

  it('missing schema or content dir lists what exists', async () => {
    const noSchema = setup({ branches: { main: { 'cms/content/author/jane.md': JANE } } });
    expect(await noSchema.source.listFiles()).toEqual([]);
    const noContent = setup({ branches: { main: { 'cms/schema.json': SCHEMA, 'README.md': 'x' } } });
    expect((await noContent.source.listFiles()).map((f) => f.path)).toEqual(['cms/schema.json']);
  });

  it('baseBranch reads schema git.baseBranch; option wins', async () => {
    const { source, make, fake } = setup();
    expect(await source.baseBranch()).toBe('main');
    const from = fake.calls.length;
    expect(await make({ baseBranch: 'develop' }).baseBranch()).toBe('develop');
    expect(fake.calls.length).toBe(from);
  });

  it('head returns the branch head oid and readFile uses one snapshot', async () => {
    const { source, fake } = setup();
    const head = await source.head();
    expect(head).toBe(fake.state.refs.get('main'));
    fake.commit('main', { 'cms/content/post/hello.md': 'changed' });
    expect(await source.head()).toBe(head);
    expect(await source.readFile('cms/content/post/hello.md')).toEqual(bytesOf(HELLO));
    await source.listFiles();
    expect(await source.head()).toBe(fake.state.refs.get('main'));
    expect(new TextDecoder().decode(await source.readFile('cms/content/post/hello.md'))).toBe('changed');
  });

  it('concurrent first reads share one snapshot load', async () => {
    const { source, fake } = setup();
    await Promise.all([source.head(), source.readFile('cms/content/post/hello.md'), source.baseBranch()]);
    expect(fake.calls.filter((c) => c.operation === 'Snapshot')).toHaveLength(1);
  });

  it('readBlob reads any blob by sha', async () => {
    const { source } = setup();
    expect(await source.readBlob(await gitBlobSha(IMAGE))).toEqual(IMAGE);
    expect(new TextDecoder().decode(await source.readBlob(await gitBlobSha(JANE)))).toBe(JANE);
    expect(await rejection(source.readBlob('nope'))).toMatchObject({ code: 'not_found' });
  });

  it('withBranch shares client, cache and options', async () => {
    const { source, fake } = setup();
    await source.readFiles(TEXT_PATHS);
    const edit = source.withBranch('editlet/edit');
    expect(edit.branch).toBe('editlet/edit');
    expect(edit.pending).not.toBe(source.pending);
    expect((await edit.listFiles()).map((f) => f.path)).toContain('cms/content/post/new.md');
    const from = fake.calls.length;
    await edit.readFiles(TEXT_PATHS);
    expect(blobOps(fake.calls.slice(from))).toBe(0);
    expect(await edit.head()).toBe(fake.state.refs.get('editlet/edit'));
  });

  it('bad token rejects AuthError unauthorized', async () => {
    const { source } = setup({ token: 'bad' });
    const error = await rejection(source.listFiles());
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ code: 'unauthorized' });
  });
});

describe('history', () => {
  it('returns newest and oldest commit of a file and the count', async () => {
    const { source } = setup();
    expect(await source.history('cms/content/post/hello.md')).toMatchObject({
      commits: 1,
      updated: { actor: { name: 'Jane Doe', login: 'jane' } },
    });
  });

  it('is empty for a path no commit touched', async () => {
    const { source } = setup();
    expect(await source.history('cms/content/post/nope.md')).toEqual({ updated: null, created: null, commits: 0 });
  });
});

describe('history across several commits', () => {
  it('takes the oldest commit from the last page of the REST listing', async () => {
    const { source, fake } = setup();
    fake.commit('main', { 'cms/content/post/hello.md': '---\ntitle: Hello again\nauthor: author/jane\n---\n' });
    fake.commit('main', { 'cms/content/post/hello.md': '---\ntitle: Third\nauthor: author/jane\n---\n' });
    const history = await source.history('cms/content/post/hello.md');
    expect(history.commits).toBe(3);
    expect(history.updated).toMatchObject({ actor: { name: 'Jane Doe', login: 'jane' } });
    expect(history.created).toMatchObject({
      actor: { name: 'Old Timer', login: 'old', avatarUrl: 'https://avatars.test/old' },
      date: '2025-10-02T09:00:00Z',
    });
    const rest = fake.calls.filter((c) => c.url.includes('/commits?'));
    expect(new URL(rest[0]!.url).searchParams.get('page')).toBe('3');
  });
});

describe('listVersions and readVersion', () => {
  const HELLO_PATH = 'cms/content/post/hello.md';
  const AGAIN = '---\ntitle: Hello again\nauthor: author/jane\n---\n';

  it('lists the commits of the branch that touched a file, newest first, with its blob sha', async () => {
    const { source, fake } = setup();
    const second = fake.commit('main', { [HELLO_PATH]: AGAIN }, 'Say hello again');
    fake.commit('main', { 'cms/content/post/world.md': '---\ntitle: Other\n---\n' });
    const versions = await source.listVersions(HELLO_PATH);
    expect(versions.map((v) => v.message)).toEqual(['Say hello again', 'Initial main']);
    expect(versions[0]).toMatchObject({
      commit: second,
      sha: await gitBlobSha(bytesOf(AGAIN)),
      actor: { name: 'Jane Doe', login: 'jane', avatarUrl: 'https://avatars.test/jane' },
      url: `https://github.test/${second}`,
    });
    expect(await source.listVersions(HELLO_PATH, 1)).toHaveLength(1);
  });

  it('is empty for a path no commit touched', async () => {
    const { source } = setup();
    expect(await source.listVersions('cms/content/post/nope.md')).toEqual([]);
  });

  it('gives a null sha for the commit that deleted the file', async () => {
    const { source, fake } = setup();
    fake.commit('main', { [HELLO_PATH]: null }, 'Remove hello');
    fake.commit('main', { [HELLO_PATH]: HELLO }, 'Bring hello back');
    const versions = await source.listVersions(HELLO_PATH);
    expect(versions.map((v) => [v.message, v.sha === null])).toEqual([
      ['Bring hello back', false],
      ['Remove hello', true],
      ['Initial main', false],
    ]);
  });

  it('reads the file as a commit left it, and rejects where it was not a file', async () => {
    const { source, fake } = setup();
    const first = fake.state.refs.get('main')!;
    fake.commit('main', { [HELLO_PATH]: AGAIN });
    expect(new TextDecoder().decode(await source.readVersion(HELLO_PATH, first))).toBe(HELLO);
    expect(await rejection(source.readVersion('cms/content/post/nope.md', first))).toBeInstanceOf(EditletError);
    expect(await rejection(source.readVersion('cms/content/post', first))).toBeInstanceOf(EditletError);
    expect(await rejection(source.readVersion(HELLO_PATH, 'f'.repeat(40)))).toBeInstanceOf(GitHubError);
  });
});

describe('a branch without a readable schema', () => {
  it.each([
    ['invalid JSON', '{'],
    ['invalid UTF-8', new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])],
  ])('lists only the schema file when the schema is %s', async (_, schema) => {
    const { source } = setup({ branches: { main: { ...FILES, 'cms/schema.json': schema } } });
    expect((await source.listFiles()).map((f) => f.path)).toEqual(['cms/schema.json']);
  });

  it('lists nothing without a schema file', async () => {
    const { 'cms/schema.json': _, ...rest } = FILES;
    const { source } = setup({ branches: { main: rest } });
    expect(await source.listFiles()).toEqual([]);
  });
});
