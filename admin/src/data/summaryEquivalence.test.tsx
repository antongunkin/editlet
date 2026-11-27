import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  useEntriesFromFiles,
  useEntryOptionsFromFiles,
  useEntryTitlesFromFiles,
  useReferrersFromFiles,
  useSearchEntriesFromFiles,
} from './fullFileFacts.test-helper';
import {
  useEntries,
  useEntryOptions,
  useEntryTitles,
  useReferrers,
  type EntryList,
  type EntryOptions,
} from './queries';

import type { EditletError } from '../../../core/issues';
import { createDevHandler } from '../../../node/devHandler';
import { useSearchEntries, type SearchEntries } from '../search/useSearchEntries';
import { SourceProvider } from '../source/context';
import { createLocalSource } from '../source/local';
import { createTestQueryClient } from '../test/render';

// The list hooks over entry summaries give exactly the rows their phase 1 versions gave from full files
// (`fullFileFacts.test-helper.ts`), on the survey fixture. Each side has its own query cache.

const survey = join(import.meta.dirname, '../../../__fixtures__/survey');

const COLLECTIONS = ['brand', 'survey', 'section', 'question', 'option', 'page'];
const TARGETS = [
  'brand/index',
  'survey/onboarding',
  'section/about-you',
  'question/age',
  'question/role',
  'option/age-adult',
  'option/untitled',
  'page/landing',
  'question/gone',
];

const temps: string[] = [];

/** A temp copy of the survey fixture with `files` added. */
async function site(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'editlet-equal-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  for (const [path, text] of Object.entries(files)) await writeFile(join(root, 'cms/content', path), text);
  const handler = createDevHandler({ root });
  const fetch = ((url: string, init?: RequestInit) =>
    handler(new Request(new URL(url, 'http://localhost'), init))) as unknown as typeof globalThis.fetch;
  return createLocalSource({ fetch });
}

afterAll(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

type Source = Awaited<ReturnType<typeof site>>;

/**
 * `hook` on a new query cache, once `done` holds for its result. `seen` is every result it rendered, `files` the entry
 * paths it holds parsed files of.
 */
async function settle<T>(source: Source, hook: () => T, done: (result: T, client: QueryClient) => void) {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SourceProvider source={source}>{children}</SourceProvider>
    </QueryClientProvider>
  );
  const seen: T[] = [];
  const view = renderHook(
    () => {
      const result = hook();
      seen.push(result);
      return result;
    },
    { wrapper },
  );
  await waitFor(() => done(view.result.current, client), { timeout: 10_000 });
  const result = view.result.current;
  const files = client
    .getQueryCache()
    .findAll({ queryKey: ['file'] })
    .map((q) => q.queryKey[1] as string)
    .toSorted();
  view.unmount();
  client.clear();
  return { result, seen, files };
}

const loaded = (r: { isPending: boolean }) => expect(r.isPending).toBe(false);
/** `useEntries` lists at once: it is there once the summaries it was asked for are. */
const summarized = (r: EntryList) => {
  expect(r.isPending).toBe(false);
  expect(r.loaded).toBe(r.total);
};
const everyEntry = (collection: string) => () => useEntries(collection, 'all');
/** What the full-file version of the options gave too. */
const listed = ({ options, pending }: EntryOptions) => ({ options, pending });
/** What the full-file version gave too: the list, without the counts. */
const listOf = ({ data, error, isPending }: EntryList) => ({ data, error, isPending });
const titled = (r: { pending: boolean }) => expect(r.pending).toBe(false);
const searched = (r: SearchEntries) => {
  expect(r.total).toBeGreaterThan(0);
  expect(r.loaded).toBe(r.total);
};

describe('list hooks over summaries and over full files', () => {
  let source: Source;
  beforeAll(async () => {
    source = await site({
      // No title (the address stands in), and two entries with one title (sorted by address).
      'option/untitled.md': '---\nscore: 2\nfollowUp: question/age\n---\n',
      'option/twin-b.md': '---\nlabel: Twin\nfollowUp: question/role\n---\n',
      'option/twin-a.md': '---\nlabel: Twin\ndraft: true\nfollowUp: question/role\n---\n',
      // A title of spaces only counts as none.
      'section/blank.md': '---\ntitle: "  "\norder: 9\nquestions:\n  - question/age\n  - question/age\n---\n',
    });
  });

  it.each(COLLECTIONS)('useEntries: %s', async (collection) => {
    const before = await settle(source, () => useEntriesFromFiles(collection), loaded);
    const after = await settle(source, everyEntry(collection), summarized);

    expect(before.result.data?.length).toBeGreaterThan(0);
    expect(listOf(after.result)).toEqual(before.result);
    for (const r of after.seen.filter((s) => !s.isPending && s.data!.every((e) => e.title !== null))) {
      expect(listOf(r)).toEqual(before.result);
    }
    // Until then: the same entries, each with its own title or none yet.
    for (const r of after.seen.filter((s) => !s.isPending)) {
      expect(r.data!.map((e) => e.path).toSorted()).toEqual(before.result.data!.map((e) => e.path).toSorted());
      for (const e of r.data!.filter((row) => row.title !== null)) expect(before.result.data).toContainEqual(e);
    }
    expect(after.files).toEqual([]);
  });

  it.each([COLLECTIONS, ['option', 'brand'], ['question', 'nothing'], []])(
    'useEntryOptions: %j',
    async (...collections) => {
      // `it.each` spreads an array row into arguments.
      const asked = collections.filter((c) => typeof c === 'string');
      const before = await settle(source, () => useEntryOptionsFromFiles(asked), titled);
      const after = await settle(source, () => useEntryOptions(asked, 'all'), titled);

      expect(listed(after.result)).toEqual(before.result);
      for (const r of after.seen.filter((s) => !s.pending && s.options.length > 0)) {
        expect(listed(r)).toEqual(before.result);
      }
      expect(after.files).toEqual([]);
    },
  );

  it('useEntryTitles', async () => {
    const values = [
      'option/age-adult',
      'option/untitled',
      'option/twin-a',
      'section/blank',
      'brand/index',
      'page/landing',
      'question/age',
      'question/age',
      'option/gone',
      'nothing/at-all',
    ];
    const before = await settle(
      source,
      () => useEntryTitlesFromFiles(values),
      (titles, client) => {
        expect(titles.size).toBe(7);
        expect(client.isFetching()).toBe(0);
        expect(titles.get('brand/index')).not.toBe('index');
      },
    );
    const after = await settle(
      source,
      () => useEntryTitles(values),
      (titles) => expect(titles).toEqual(before.result),
    );

    expect(after.files).toEqual([]);
  });

  it.each(TARGETS)('useReferrers: %s', async (target) => {
    const before = await settle(source, () => useReferrersFromFiles(target), loaded);
    const after = await settle(source, () => useReferrers(target), loaded);

    expect(after.result).toEqual(before.result);
    // No answer before the last one: neither an empty list nor a part of it while summaries or files load.
    for (const r of after.seen.filter((s) => !s.isPending)) expect(r).toEqual(before.result);
    // Only the entries that point are read in full.
    expect(after.files).toEqual(before.result.data!.map((item) => item.entry.path).toSorted());
  });

  it('useReferrers finds referrers for the targets above', async () => {
    const found = await settle(source, () => useReferrers('question/age'), loaded);
    expect(found.result.data!.map((item) => item.ref)).toContain('section/blank');
    expect(found.result.data!.length).toBeGreaterThan(1);
  });

  it('useSearchEntries, with uses', async () => {
    const before = await settle(source, () => useSearchEntriesFromFiles(true), searched);
    const after = await settle(source, () => useSearchEntries(true, true), searched);

    expect(after.result).toEqual(before.result);
    expect(before.result.entries.some((e) => (e.uses?.size ?? 0) > 0)).toBe(true);
    // A count shows only when it is the whole count.
    for (const { entries } of after.seen) {
      for (const entry of entries.filter((e) => e.uses !== undefined)) {
        const whole = before.result.entries.find((e) => e.collection === entry.collection && e.slug === entry.slug);
        expect(entry.uses).toEqual(whole!.uses);
      }
    }
    expect(after.files).toEqual([]);
  });
});

describe('list hooks over summaries and over full files, with a file that does not parse', () => {
  let source: Source;
  beforeAll(async () => {
    source = await site({ 'question/broken.md': '---\nprompt: [\n---\n' });
  });

  it('useEntries and useEntryOptions keep its row under its address', async () => {
    const before = await settle(source, () => useEntriesFromFiles('question'), loaded);
    const after = await settle(source, everyEntry('question'), summarized);
    expect(listOf(after.result)).toEqual(before.result);
    expect(after.result.data!.find((e) => e.slug === 'broken')).toMatchObject({ title: 'broken', draft: false });

    const options = await settle(source, () => useEntryOptionsFromFiles(['question']), titled);
    const after2 = await settle(source, () => useEntryOptions(['question'], 'all'), titled);
    expect(listed(after2.result)).toEqual(options.result);
  });

  it('useReferrers fails with the same error', async () => {
    const before = await settle(source, () => useReferrersFromFiles('question/age'), loaded);
    const after = await settle(source, () => useReferrers('question/age'), loaded);

    const issues = (r: { error: Error | null }) => (r.error as EditletError).issues;
    expect(issues(before.result)[0]?.file).toBe('cms/content/question/broken.md');
    expect(issues(after.result)).toEqual(issues(before.result));
    expect(after.result).toEqual(before.result);
  });

  it('useSearchEntries counts it and the other uses', async () => {
    const before = await settle(source, () => useSearchEntriesFromFiles(true), searched);
    const after = await settle(source, () => useSearchEntries(true, true), searched);

    expect(before.result.failed).toBe(1);
    expect(after.result).toEqual(before.result);
  });
});
