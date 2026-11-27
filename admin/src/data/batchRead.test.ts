import { describe, expect, it, vi } from 'vitest';

import { BATCH_LIMIT, batchedReader } from './batchRead';

import { AuthError } from '../../../auth/client';
import { EditletError } from '../../../core/issues';
import { createMemorySource, type ContentSource } from '../../../core/source';
import { GitHubError } from '../../../github';

// Batched entry reads (docs/admin/search.md#data-and-limits): paths asked in one task go out as `readFiles` calls of at
// most 200; a rejected batch is retried or rejected by the error's kind.

const paths = (n: number) => Array.from({ length: n }, (_, i) => `cms/content/post/p${i}.md`);
const files = (list: string[]) => Object.fromEntries(list.map((p) => [p, `---\ntitle: ${p}\n---\n`]));
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const settle = (list: Promise<unknown>[]) => Promise.allSettled(list);

/** A batching memory source whose `readFiles` a test can watch or replace. */
function batching(list: string[]) {
  const source = createMemorySource(files(list), undefined, { batch: true });
  const real = source.readFiles.bind(source);
  const readFiles = vi.spyOn(source, 'readFiles');
  return { source, readFiles, real };
}

describe('batchedReader', () => {
  it('reads 2,000 paths asked in one task in 10 readFiles calls of at most 200', async () => {
    const all = paths(2000);
    const { source, readFiles } = batching(all);
    const read = await Promise.all(all.map((p) => batchedReader(source).read(p)));
    expect(readFiles).toHaveBeenCalledTimes(2000 / BATCH_LIMIT);
    expect(readFiles.mock.calls.every(([batch]) => batch.length <= BATCH_LIMIT)).toBe(true);
    expect(text(read[1234]!)).toContain('p1234.md');
  });

  it('is one reader per source: the queries of a render share its queue', () => {
    const { source } = batching(paths(1));
    expect(batchedReader(source)).toBe(batchedReader(source));
  });

  it('flushes once per task: paths asked in two turns are two batches', async () => {
    const { source, readFiles } = batching(paths(4));
    const reader = batchedReader(source);
    const first = [reader.read(paths(4)[0]!), reader.read(paths(4)[1]!)];
    await Promise.all(first);
    await Promise.all([reader.read(paths(4)[2]!), reader.read(paths(4)[3]!)]);
    expect(readFiles.mock.calls.map(([batch]) => batch.length)).toEqual([2, 2]);
  });

  it('a missing path rejects alone with its issue; the others resolve in one more batch', async () => {
    const all = paths(5);
    const { source, readFiles } = batching(all);
    const reader = batchedReader(source);
    const asked = [...all, 'cms/content/post/gone.md'].map((p) => reader.read(p));
    const results = await settle(asked);
    expect(results.slice(0, 5).every((r) => r.status === 'fulfilled')).toBe(true);
    const gone = results[5] as PromiseRejectedResult;
    expect(gone.reason).toBeInstanceOf(EditletError);
    expect((gone.reason as EditletError).issues).toEqual([
      { file: 'cms/content/post/gone.md', path: '', message: 'File not found: cms/content/post/gone.md' },
    ]);
    expect(readFiles.mock.calls.map(([batch]) => batch.length)).toEqual([6, 5]);
  });

  it('a graphql_error batch is split in halves until the bad file is alone', async () => {
    const all = paths(8);
    const bad = all[5]!;
    const { source, readFiles, real } = batching(all);
    readFiles.mockImplementation(async (batch) => {
      if (batch.includes(bad)) throw new GitHubError('graphql_error', 'Something went wrong');
      return real(batch);
    });
    const results = await settle(all.map((p) => batchedReader(source).read(p)));
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((results[5] as PromiseRejectedResult).reason).toMatchObject({ code: 'graphql_error' });
    // 8 → 4 + 4 → (the bad half) 2 + 2 → 1 + 1: a few requests, not eight single ones.
    expect(readFiles.mock.calls.map(([batch]) => batch.length)).toEqual([8, 4, 4, 2, 2, 1, 1]);
  });

  it.each([
    ['rate_limited', new GitHubError('rate_limited', 'Rate limited')],
    ['network_error', new GitHubError('network_error', 'Failed to fetch')],
    ['an expired session', new AuthError('expired', 'Session expired')],
  ])('%s rejects every path of the batch, with no single reads', async (_, error) => {
    const all = paths(6);
    const { source, readFiles } = batching(all);
    const readFile = vi.spyOn(source, 'readFile');
    readFiles.mockRejectedValue(error);
    const results = await settle(all.map((p) => batchedReader(source).read(p)));
    expect(results.every((r) => r.status === 'rejected' && r.reason === error)).toBe(true);
    expect(readFiles).toHaveBeenCalledTimes(1);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('reads one by one from a source without readFiles (the local source)', async () => {
    const all = paths(2000);
    const source: ContentSource = createMemorySource(files(all));
    const readFile = vi.spyOn(source, 'readFile');
    await Promise.all(all.map((p) => batchedReader(source).read(p)));
    expect(readFile).toHaveBeenCalledTimes(2000);
  });

  it('has one reader for a source that is not GitHub, whatever keep is', () => {
    const { source } = batching(paths(1));
    expect(batchedReader(source, { keep: false })).toBe(batchedReader(source));
  });

  it('asks once for a path asked twice in the same task, and gives both the file', async () => {
    const { source, readFiles } = batching(paths(1));
    const reader = batchedReader(source);
    const [a, b] = await Promise.all([reader.read(paths(1)[0]!), reader.read(paths(1)[0]!)]);
    expect(text(a)).toBe(text(b));
    expect(readFiles.mock.calls).toEqual([[[paths(1)[0]]]]);
  });
});
