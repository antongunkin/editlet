// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createMemoryCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { readCommit } from './commitReader.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

import { EditletError } from '../core/issues.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title', required: true } } } },
});

const FILES: Record<string, FileInput> = {
  'cms/schema.json': SCHEMA,
  'cms/content/post/hello.md': '---\ntitle: Hello\n---\n',
  'cms/content/post/img/cover.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]),
  'cms/content/.draft/x.md': '---\ntitle: Draft\n---\n',
  'src/page.tsx': 'export {}\n',
};

const text = (b: Uint8Array | undefined) => new TextDecoder().decode(b);

function setup(files: Record<string, FileInput> = FILES) {
  const fake = createFakeGitHub({ branches: { main: files } });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  return { fake, client, cache: createMemoryCache(), sha: fake.state.refs.get('main')! };
}

describe('readCommit', () => {
  it('reads schema and entry files at a commit', async () => {
    const { client, cache, sha } = setup();
    const out = await readCommit({ owner: 'o', repo: 'r', sha, client, cache });
    expect(out.schema.contentDir).toBe('cms/content');
    expect([...out.files.keys()].toSorted()).toEqual(['cms/content/post/hello.md', 'cms/schema.json']);
    expect(text(out.files.get('cms/content/post/hello.md'))).toContain('Hello');
  });

  it('pins to the given sha even after the branch moves', async () => {
    const { fake, client, cache, sha } = setup();
    fake.commit('main', { 'cms/content/post/hello.md': '---\ntitle: Changed\n---\n' });
    const out = await readCommit({ owner: 'o', repo: 'r', sha, client, cache });
    expect(text(out.files.get('cms/content/post/hello.md'))).toContain('Hello');
  });

  it('second read of the same sha makes no blob requests', async () => {
    const { fake, client, cache, sha } = setup();
    await readCommit({ owner: 'o', repo: 'r', sha, client, cache });
    const before = fake.calls.length;
    await readCommit({ owner: 'o', repo: 'r', sha, client, cache });
    const blobCalls = fake.calls.slice(before).filter((c) => c.operation === 'Blobs' || c.url.includes('/git/blobs/'));
    expect(blobCalls).toHaveLength(0);
  });

  it('rejects without a schema', async () => {
    const { client, cache, sha } = setup({ 'README.md': 'x' });
    await expect(readCommit({ owner: 'o', repo: 'r', sha, client, cache })).rejects.toBeInstanceOf(EditletError);
  });

  it('rejects with an invalid schema', async () => {
    const { client, cache, sha } = setup({ 'cms/schema.json': '{ nope' });
    await expect(readCommit({ owner: 'o', repo: 'r', sha, client, cache })).rejects.toBeInstanceOf(EditletError);
  });
});
