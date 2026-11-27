// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { createFakeGitHub, type FakeHistoryCommit, type FileInput } from './fakeGitHub.ts';

import { createMemoryCache } from '../cache.ts';
import { createGitHubClient } from '../client.ts';
import { createGitHubSource } from '../source.ts';

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title' } } } },
});
const ONE = 'cms/content/post/one.md';
const TWO = 'cms/content/post/two.md';
const STILL = 'cms/content/post/still.md';
const post = (title: string) => `---\ntitle: ${title}\n---\n`;

const ANN = { name: 'Ann Author', email: 'ann@example.test' };
const BEN = { name: 'Ben Builder', email: 'ben@example.test' };
const HISTORY: FakeHistoryCommit[] = [
  {
    message: 'Add posts',
    author: ANN,
    date: '2024-01-10T08:00:00Z',
    files: { [ONE]: post('One é'), [TWO]: post('Two'), [STILL]: post('Still') },
  },
  { message: 'Edit one', author: BEN, date: '2024-06-11T09:30:00Z', files: { [ONE]: post('One again') } },
  {
    message: 'Edit both',
    author: ANN,
    date: '2025-02-12T10:45:00Z',
    files: { [ONE]: post('One last'), [TWO]: post('Two last') },
  },
];

function setup(history?: FakeHistoryCommit[]) {
  const files: Record<string, FileInput> = { 'cms/schema.json': SCHEMA };
  if (!history) files[ONE] = post('One é');
  const fake = createFakeGitHub({ branches: { main: files }, history });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  const source = createGitHubSource({
    owner: 'o',
    repo: 'r',
    branch: 'main',
    client,
    cache: createMemoryCache(),
  });
  return { fake, source };
}

const AUTH = { authorization: 'Bearer tok' };

describe('createFakeGitHub with a history', () => {
  it('gives each path the dates and authors of the commits that touched it, newest first', async () => {
    const { source } = setup(HISTORY);

    const one = await source.history(ONE);
    expect(one.commits).toBe(3);
    expect(one.updated).toMatchObject({
      actor: { name: 'Ann Author' },
      date: '2025-02-12T10:45:00Z',
      message: 'Edit both',
    });
    expect(one.updated!.actor.login).toBeUndefined();
    expect(one.created).toMatchObject({
      actor: { name: 'Ann Author' },
      date: '2024-01-10T08:00:00Z',
      message: 'Add posts',
    });
    expect(one.created!.actor.login).toBeUndefined();

    const two = await source.history(TWO);
    expect(two.commits).toBe(2);
    expect(two.updated).toMatchObject({ date: '2025-02-12T10:45:00Z' });
    expect(two.created).toMatchObject({ date: '2024-01-10T08:00:00Z' });

    const versions = await source.listVersions(ONE);
    expect(versions.map((v) => [v.message, v.actor.name, v.date])).toEqual([
      ['Edit both', 'Ann Author', '2025-02-12T10:45:00Z'],
      ['Edit one', 'Ben Builder', '2024-06-11T09:30:00Z'],
      ['Add posts', 'Ann Author', '2024-01-10T08:00:00Z'],
    ]);
  });

  it('keeps one commit for a path untouched after the first one', async () => {
    const { source } = setup(HISTORY);
    const still = await source.history(STILL);
    expect(still.commits).toBe(1);
    expect(still.updated).toMatchObject({ actor: { name: 'Ann Author' }, date: '2024-01-10T08:00:00Z' });
    expect(still.created).toEqual(still.updated);
    expect(await source.listVersions(STILL)).toHaveLength(1);
  });

  it('leaves the head of main with the last contents', async () => {
    const { source } = setup(HISTORY);
    const files = await source.readFiles([ONE, STILL]);
    expect([ONE, STILL].map((p) => new TextDecoder().decode(files.get(p)))).toEqual([post('One last'), post('Still')]);
  });

  it('answers the fixed date and author without a history', async () => {
    const { source, fake } = setup();
    expect(fake.state.commits.size).toBe(1);
    expect(await source.history(ONE)).toMatchObject({
      commits: 1,
      updated: { actor: { name: 'Jane Doe', login: 'jane' }, date: '2025-11-19T14:48:00Z' },
    });
    fake.commit('main', { [ONE]: post('Changed') });
    expect((await source.history(ONE)).created).toMatchObject({
      actor: { name: 'Old Timer', login: 'old' },
      date: '2025-10-02T09:00:00Z',
    });
  });
});

describe('FakeCall.bytes', () => {
  it('is the length of the response body, REST and GraphQL', async () => {
    const { fake } = setup(HISTORY);
    const rest = await fake.fetch('https://api.github.com/repos/o/r/git/ref/heads/main', { headers: AUTH });
    const graphql = await fake.fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: AUTH,
      body: JSON.stringify({
        query: 'query History { x }',
        variables: { owner: 'o', name: 'r', ref: 'refs/heads/main', path: ONE },
      }),
    });
    const lengths = [(await rest.arrayBuffer()).byteLength, (await graphql.arrayBuffer()).byteLength];
    expect(lengths.every((n) => n > 0)).toBe(true);
    expect(fake.calls.map((c) => c.bytes)).toEqual(lengths);
  });

  it('is the raw length of a blob, counting bytes rather than characters', async () => {
    const { fake } = setup();
    const sha = fake.state.commits.get(fake.state.refs.get('main')!)!.files.get(ONE)!;
    await fake.fetch(`https://api.github.com/repos/o/r/git/blobs/${sha}`, {
      headers: { ...AUTH, accept: 'application/vnd.github.raw+json' },
    });
    expect(fake.calls[0]!.bytes).toBe(Buffer.byteLength(post('One é')));
    expect(fake.calls[0]!.bytes).toBe(post('One é').length + 1);
  });

  it('counts the body of a route a test adds, and 0 for an empty one', async () => {
    const { fake } = setup();
    fake.restRoutes.unshift({ method: 'GET', pattern: /^\/custom$/, handle: () => new Response('héllo') });
    const custom = await fake.fetch('https://api.github.com/repos/o/r/custom', { headers: AUTH });
    expect(await custom.text()).toBe('héllo');
    await fake.fetch('https://api.github.com/repos/o/r/git/refs/heads/main', { method: 'DELETE', headers: AUTH });
    expect(fake.calls.map((c) => c.bytes)).toEqual([6, 0]);
  });
});
