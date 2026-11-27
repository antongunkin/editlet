import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useSummaries, type SummaryRef } from './summaries';

import { gitBlobSha } from '../../../core/sha';
import { createMemorySource } from '../../../core/source';
import { SourceProvider } from '../source/context';
import { createTestQueryClient } from '../test/render';

// `useSummaries` in dev mode (a local source, no workspace and so no IndexedDB), and the stability of its result.

const SCHEMA = JSON.stringify({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      titleField: 'title',
      fields: { title: { type: 'string', label: 'Title' } },
    },
  },
});

const post = (title: string, extra = '') => `---\ntitle: ${title}\n${extra}---\n`;
const pathOf = (slug: string) => `cms/content/post/${slug}.md`;

async function refOf(slug: string, text: string): Promise<SummaryRef> {
  return { collection: 'post', slug, path: pathOf(slug), sha: await gitBlobSha(text) };
}

/** `before` runs before a read answers: what it returns holds or fails the read. */
function render(
  files: Record<string, string>,
  refs: SummaryRef[],
  before?: (path: string) => Promise<void> | undefined,
) {
  const source = createMemorySource({ 'cms/schema.json': SCHEMA, ...files });
  const answer = source.readFile.bind(source);
  const readFile = vi.spyOn(source, 'readFile').mockImplementation(async (path) => {
    await before?.(path);
    return answer(path);
  });
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SourceProvider source={source}>{children}</SourceProvider>
    </QueryClientProvider>
  );
  const view = renderHook((props: SummaryRef[]) => useSummaries(props), { wrapper, initialProps: refs });
  const settled = () => waitFor(() => expect(view.result.current.loaded).toBe(view.result.current.total));
  /** The entry paths read from the source. */
  const read = () => readFile.mock.calls.map(([path]) => path).filter((path) => path.endsWith('.md'));
  return { source, client, view, settled, read };
}

describe('useSummaries', () => {
  it('reads and summarizes the files of a local source, in the order of the refs', async () => {
    const b = post('B', 'draft: true\n');
    const a = post('A');
    const refs = [await refOf('b', b), await refOf('a', a)];
    const { view, settled, read, client } = render({ [pathOf('a')]: a, [pathOf('b')]: b }, refs);

    expect(view.result.current).toMatchObject({ rows: [undefined, undefined], loaded: 0, total: 2, failed: 0 });
    await settled();
    expect(view.result.current.rows.map((row) => [row?.title, row?.draft])).toEqual([
      ['B', true],
      ['A', false],
    ]);
    expect(view.result.current.errors).toEqual([null, null]);
    expect(read().toSorted()).toEqual([pathOf('a'), pathOf('b')]);
    expect(client.getQueryCache().findAll({ queryKey: ['file'] })).toEqual([]);
  });

  it('keeps its result and arrays until a summary changes', async () => {
    const [a, b, edited] = [post('A'), post('B'), post('B edited')];
    const refs = [await refOf('a', a), await refOf('b', b)];
    const { source, view, settled, read } = render({ [pathOf('a')]: a, [pathOf('b')]: b }, refs);
    await settled();
    const first = view.result.current;

    view.rerender(refs);
    expect(view.result.current).toBe(first);
    // Another array of the same refs: still the same result.
    view.rerender(refs.map((ref) => ({ ...ref })));
    expect(view.result.current).toBe(first);

    await source.commit([{ path: pathOf('b'), content: edited }], 'Edit');
    view.rerender([refs[0]!, await refOf('b', edited)]);
    await waitFor(() => expect(view.result.current.rows[1]?.title).toBe('B edited'));
    expect(view.result.current).not.toBe(first);
    expect(view.result.current.rows[0]).toBe(first.rows[0]);
    // Only the new sha was read again.
    expect(read().filter((path) => path === pathOf('a'))).toHaveLength(1);
  });

  it('shows each row as it arrives, with one query for the batch', async () => {
    const [a, b] = [post('A'), post('B')];
    const refs = [await refOf('a', a), await refOf('b', b)];
    let release = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    const { view, settled, client } = render({ [pathOf('a')]: a, [pathOf('b')]: b }, refs, (path) =>
      path === pathOf('b') ? held : undefined,
    );

    await waitFor(() => expect(view.result.current.rows[0]?.title).toBe('A'));
    expect(view.result.current).toMatchObject({ loaded: 1, total: 2 });
    release();
    await settled();
    expect(client.getQueryCache().findAll({ queryKey: ['summaries'] })).toHaveLength(1);
  });

  it('reads a failed file once more, and again at the next use when it still fails', async () => {
    const [a, b] = [post('A'), post('B')];
    const refs = [await refOf('a', a), await refOf('b', b)];
    let failures = 3;
    const { view, settled, read } = render({ [pathOf('a')]: a, [pathOf('b')]: b }, refs, (path) =>
      path === pathOf('b') && failures-- > 0 ? Promise.reject(new Error('offline')) : undefined,
    );

    await settled();
    expect(view.result.current).toMatchObject({ failed: 1, errors: [null, expect.any(Error)] });
    expect(read().filter((path) => path === pathOf('b'))).toHaveLength(2);

    view.rerender([]);
    view.rerender(refs);
    await waitFor(() => expect(view.result.current.rows[1]?.title).toBe('B'));
    expect(read().filter((path) => path === pathOf('a'))).toHaveLength(1);
  });

  it('forgets its summaries when the query client is cleared (sign-out)', async () => {
    const a = post('A');
    const refs = [await refOf('a', a)];
    const { view, settled, read, client } = render({ [pathOf('a')]: a }, refs);
    await settled();

    client.clear();
    view.rerender([]);
    view.rerender(refs.map((ref) => ({ ...ref })));
    await waitFor(() => expect(read()).toHaveLength(2));
  });
});
