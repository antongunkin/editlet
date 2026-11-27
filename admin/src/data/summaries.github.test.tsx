import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { useMemo, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { entryFileQuery, entryRefs, useEntries, useFiles, useSchema } from './queries';
import { useSummaries, type SummaryRef } from './summaries';

import { parseEntryFile } from '../../../core/entryFile';
import { EditletError } from '../../../core/issues';
import { gitBlobSha } from '../../../core/sha';
import { createGitHubClient } from '../../../github';
import { openGitHubCache, type GitHubCache } from '../../../github/cache';
import type { GitHubSource, GitHubSourceOptions } from '../../../github/source';
import { WorkspaceProvider } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { createTestQueryClient } from '../test/render';

// Entry summaries over a GitHub source (a fake GitHub behind it) with a real IndexedDB cache (docs/core/summary.md): a
// large list reads each blob once, ever, and keeps neither a parsed file nor the blob.

/** The IndexedDB of the test's browser profile (it stays over a "reload"), and what its caches were asked. */
const disk = vi.hoisted(() => ({
  indexedDB: undefined as IDBFactory | undefined,
  opened: [] as GitHubCache[],
  /** The keys of each `getSummaries` call, the rows of each `putSummaries` call, the blobs asked by sha. */
  gets: [] as number[],
  puts: [] as number[],
  blobs: [] as string[],
  sources: [] as GitHubSource[],
}));

// The workspace makes its source without a cache option, and jsdom has no IndexedDB: each source gets its own
// connection to the one fake database, with its calls counted.
vi.mock('../../../github', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../github')>();
  return {
    ...original,
    createGitHubSource: (options: GitHubSourceOptions) => {
      const cache = openGitHubCache({ indexedDB: disk.indexedDB, IDBKeyRange });
      const { getSummaries, putSummaries, getBlobs } = cache;
      cache.getSummaries = (keys) => {
        disk.gets.push(keys.length);
        return getSummaries(keys);
      };
      cache.putSummaries = (rows) => {
        disk.puts.push(rows.length);
        return putSummaries(rows);
      };
      cache.getBlobs = (shas) => {
        disk.blobs.push(...shas);
        return getBlobs(shas);
      };
      disk.opened.push(cache);
      const source = original.createGitHubSource({ ...options, cache });
      disk.sources.push(source);
      return source;
    },
  };
});

const COUNT = 2000;
/** Under a full run (coverage, a busy machine) the cold load takes longer than `waitFor`'s default. */
const LOAD_MS = 30_000;

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', titleField: 'title', fields: { title: { type: 'string', label: 'Title' } } } },
});

const pathOf = (name: string) => `cms/content/post/${name}.md`;
const numbered = (i: number) => `post-${String(i).padStart(4, '0')}`;
const post = (title: string, body = '') => `---\ntitle: ${title}\n---\n${body}`;

/** The fake with these posts, and the shas its `Blobs` queries were asked (the network reads). */
function site(posts: Record<string, string>) {
  const files: Record<string, string> = { 'cms/schema.json': SCHEMA };
  for (const [name, text] of Object.entries(posts)) files[pathOf(name)] = text;
  const fake = createAdminFakeGitHub({ files });
  const fetched: string[] = [];
  const answer = fake.graphqlOps.Blobs!;
  fake.graphqlOps.Blobs = (variables, query) => {
    for (const match of query.matchAll(/object\(oid: "([0-9a-f]+)"\)/g)) fetched.push(match[1]!);
    return answer(variables, query);
  };
  return { fake, fetched };
}

const largeSite = () =>
  site(Object.fromEntries(Array.from({ length: COUNT }, (_, i) => [numbered(i), post(`Title ${numbered(i)}`)])));

const toRef = (ref: { path: string; sha: string; slug: string }): SummaryRef => ({ ...ref, collection: 'post' });

/** The admin's providers on `fake` with `client`: a new workspace, so a new source and cache connection. */
function providers(fake: AdminFakeGitHub, client: QueryClient) {
  const github = createGitHubClient({ token: 'pat_1', fetch: fake.fetch });
  const config = { owner: 'o', repo: 'r', baseBranch: 'main' };
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <WorkspaceProvider config={config} client={github} storage={window.localStorage}>
        {children}
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

/** One page load: a new workspace (source, cache connection) and the summaries of the `post` entries, or of `refs`. */
function load(fake: AdminFakeGitHub, options: { client?: QueryClient; refs?: SummaryRef[] } = {}) {
  const client = options.client ?? createTestQueryClient();
  const wrapper = providers(fake, client);
  const view = renderHook(
    () => {
      const files = useFiles().data;
      const schema = useSchema().data?.schema;
      const listed = useMemo(
        () => (files && schema ? entryRefs(schema, files, 'post').map(toRef) : []),
        [files, schema],
      );
      const refs = options.refs ?? listed;
      return { refs, summaries: useSummaries(refs) };
    },
    { wrapper },
  );
  const settled = (total: number) =>
    waitFor(
      () => {
        expect(view.result.current.summaries.total).toBe(total);
        expect(view.result.current.summaries.loaded).toBe(total);
      },
      { timeout: LOAD_MS },
    );
  const close = async () => {
    view.unmount();
    client.clear();
    await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  };
  return { client, view, settled, close, summaries: () => view.result.current.summaries };
}

/** The `[sha, fp]` keys of the summaries IndexedDB keeps. */
async function stored(): Promise<[string, string][]> {
  const db = new Dexie('editlet-github', { indexedDB: disk.indexedDB, IDBKeyRange });
  await db.open();
  const keys = (await db.table('summaries').toCollection().primaryKeys()) as [string, string][];
  db.close();
  return keys;
}

/** The shas of the entry blobs IndexedDB keeps (the schema is not one). */
async function keptEntries(): Promise<string[]> {
  const db = new Dexie('editlet-github', { indexedDB: disk.indexedDB, IDBKeyRange });
  await db.open();
  const keys = (await db.table('blobs').toCollection().primaryKeys()) as string[];
  db.close();
  const schema = await gitBlobSha(SCHEMA);
  return keys.filter((sha) => sha !== schema);
}

const written = (rows: number) => waitFor(async () => expect((await stored()).length).toBe(rows), { timeout: LOAD_MS });

const fileQueries = (client: QueryClient) => client.getQueryCache().findAll({ queryKey: ['file'] });

/** The entry blobs the caches were asked, and those fetched from GitHub (the schema is not an entry). */
async function reads(fetched: string[]) {
  const schema = await gitBlobSha(SCHEMA);
  return { cache: disk.blobs.filter((s) => s !== schema), network: fetched.filter((s) => s !== schema) };
}

function forget(fetched: string[]) {
  fetched.length = 0;
  disk.gets.length = disk.puts.length = disk.blobs.length = 0;
}

afterEach(async () => {
  await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
  disk.gets.length = disk.puts.length = disk.blobs.length = disk.sources.length = 0;
  window.localStorage.clear();
});

describe('useSummaries over a GitHub source', () => {
  it('reads 2,000 blobs once: none after a reload, one for the one changed file', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, fetched } = largeSite();

    // Cold: an empty cache.
    const cold = load(fake);
    await cold.settled(COUNT);
    expect(cold.summaries().failed).toBe(0);
    expect(cold.summaries().rows[1234]).toMatchObject({ title: 'Title post-1234', draft: false, issues: 0 });
    await written(COUNT);
    const first = await reads(fetched);
    expect(new Set(first.network).size).toBe(COUNT);
    expect(first.network).toHaveLength(COUNT);
    expect(first.cache).toHaveLength(COUNT);
    expect(disk.gets).toEqual([COUNT]);
    // One write per batched read (200 files), not one per entry.
    expect(disk.puts).toHaveLength(10);
    expect(fileQueries(cold.client)).toEqual([]);
    expect(await keptEntries()).toEqual([]);
    // One query per batch of 200, not one per entry: react-query's work grows with the square of their number.
    expect(cold.client.getQueryCache().findAll({ queryKey: ['summaries'] })).toHaveLength(10);
    const coldRows = cold.summaries().rows;
    await cold.close();

    // A reload: the same IndexedDB, a new query client.
    forget(fetched);
    const warm = load(fake);
    await warm.settled(COUNT);
    expect(await reads(fetched)).toEqual({ cache: [], network: [] });
    expect(disk.gets).toEqual([COUNT]);
    expect(disk.puts).toEqual([]);
    expect(warm.summaries().rows).toEqual(coldRows);
    expect(fileQueries(warm.client)).toEqual([]);
    await warm.close();

    // One file changes on `main`: only its sha is new.
    const changedText = post('Changed');
    fake.commit('main', { [pathOf(numbered(501))]: changedText }, 'Edit');
    forget(fetched);
    const changed = load(fake);
    await changed.settled(COUNT);
    await written(COUNT + 1);
    const sha = await gitBlobSha(changedText);
    expect(await reads(fetched)).toEqual({ cache: [sha], network: [sha] });
    expect(disk.gets).toEqual([COUNT]);
    expect(disk.puts).toEqual([1]);
    expect(changed.summaries().rows[501]?.title).toBe('Changed');
    expect(await keptEntries()).toEqual([]);

    // Opening one entry reads its blob once and keeps it.
    const opened = changed.view.result.current.refs[1234]!;
    forget(fetched);
    await changed.client.fetchQuery(entryFileQuery(disk.sources.at(-1)!, opened));
    expect(await reads(fetched)).toEqual({ cache: [opened.sha], network: [opened.sha] });
    expect(await keptEntries()).toEqual([opened.sha]);
    await changed.close();

    // A reload: the summaries are kept, so no blob is read or asked of the cache.
    forget(fetched);
    const again = load(fake);
    await again.settled(COUNT);
    expect(await reads(fetched)).toEqual({ cache: [], network: [] });
    expect(await keptEntries()).toEqual([opened.sha]);
    await again.close();
  }, 120_000);

  it('summarizes an entry whose file is already parsed without reading it', async () => {
    disk.indexedDB = new IDBFactory();
    const text = post('Saved title');
    const { fake, fetched } = site({ open: text });
    const sha = await gitBlobSha(text);
    const client = createTestQueryClient();
    const ref = { path: pathOf('open'), sha };
    const file = parseEntryFile(post('Parsed title'));
    client.setQueryData(entryFileQuery(null!, ref).queryKey, { file, sha, keyOrder: ['title'] });

    const page = load(fake, { client });
    await page.settled(1);
    expect(page.summaries().rows[0]?.title).toBe('Parsed title');
    expect(await reads(fetched)).toEqual({ cache: [], network: [] });
    expect(disk.gets).toEqual([]);
    expect(fileQueries(client)).toHaveLength(1);
    await page.close();
  });

  it('rejects a file that does not parse with its issues and keeps nothing for it', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake } = site({ a: post('A'), broken: '---\ntitle: [\n---\n', z: post('Z') });

    const page = load(fake);
    await page.settled(3);
    await written(2);
    const { rows, errors, failed, loaded } = page.summaries();
    expect({ failed, loaded }).toEqual({ failed: 1, loaded: 3 });
    expect(rows.map((row) => row?.title)).toEqual(['A', undefined, 'Z']);
    expect(errors[0]).toBeNull();
    expect(errors[1]).toBeInstanceOf(EditletError);
    expect((errors[1] as EditletError).issues[0]?.file).toBe(pathOf('broken'));
    expect((await stored()).map(([sha]) => sha)).not.toContain(await gitBlobSha('---\ntitle: [\n---\n'));
    expect(fileQueries(page.client)).toEqual([]);
    await page.close();
  });

  it('reads two files with the same content once, as one query', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, fetched } = site({ one: post('Same'), two: post('Same') });
    const warn = vi.spyOn(console, 'warn');

    const page = load(fake);
    await page.settled(2);
    await written(1);
    expect(page.summaries().rows.map((row) => row?.title)).toEqual(['Same', 'Same']);
    expect((await reads(fetched)).network).toHaveLength(1);
    expect(disk.gets).toEqual([1]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    await page.close();
  });

  it('does not keep a summary made from other content than the listed sha', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake } = site({ moved: post('Now') });
    // Listed under a sha the file no longer has.
    const refs = [toRef({ path: pathOf('moved'), sha: await gitBlobSha(post('Before')), slug: 'moved' })];

    const page = load(fake, { refs });
    await page.settled(1);
    expect(page.summaries().rows[0]?.title).toBe('Now');
    await waitFor(() => expect(disk.puts).toEqual([0]));
    expect(await stored()).toEqual([]);
    await page.close();
  });

  it('serves a collection list after a reload without reading a blob or keeping a parsed file', async () => {
    disk.indexedDB = new IDBFactory();
    const { fake, fetched } = site({ a: post('A'), b: post('B'), c: post('C') });
    /** One page load of the `post` list, until it is there. */
    const list = async () => {
      const client = createTestQueryClient();
      const view = renderHook(() => useEntries('post', 'all'), { wrapper: providers(fake, client) });
      await waitFor(() => expect(view.result.current).toMatchObject({ loaded: 3, total: 3 }));
      const titles = view.result.current.data!.map((e) => e.title);
      const files = fileQueries(client);
      const close = async () => {
        view.unmount();
        client.clear();
        await Promise.all(disk.opened.splice(0).map((cache) => cache.close?.()));
      };
      return { titles, files, close };
    };

    const cold = await list();
    expect(cold.titles).toEqual(['A', 'B', 'C']);
    expect(cold.files).toEqual([]);
    await written(3);
    await cold.close();

    forget(fetched);
    const warm = await list();
    expect(warm.titles).toEqual(['A', 'B', 'C']);
    expect(await reads(fetched)).toEqual({ cache: [], network: [] });
    expect(warm.files).toEqual([]);
    await warm.close();
  });
});
