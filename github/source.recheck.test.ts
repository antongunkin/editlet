// @vitest-environment node
// The delete-only re-check from kept summaries (docs/github/commit.md): it must give the issues the full re-check gives.
// An empty summary cache is the full path: every entry has no summary, so every entry is read.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createMemoryCache, type GitHubCache } from './cache.ts';
import { createGitHubClient } from './client.ts';
import { createGitHubSource, type GitHubFileChange } from './source.ts';
import { createFakeGitHub, type FileInput } from './test/fakeGitHub.ts';

import { parseEntryFile } from '../core/entryFile.ts';
import { parseEntryPath } from '../core/paths.ts';
import { parseSchemaText } from '../core/schema.ts';
import { gitBlobSha } from '../core/sha.ts';
import { SUMMARY_VERSION, summarizeEntry, summaryFingerprint } from '../core/summary.ts';

const survey = join(import.meta.dirname, '../__fixtures__/survey');
const BRANCH = 'editlet/edit';
const SCHEMA = 'cms/schema.json';
const content = (path: string) => `cms/content/${path}`;
const decoder = new TextDecoder();

/** The survey fixture, plus one image that only a body shows (`question/age`). */
function surveyFiles(): Record<string, FileInput> {
  const files: Record<string, FileInput> = {};
  for (const entry of readdirSync(join(survey, 'cms'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath, entry.name);
    files[relative(survey, full)] = new Uint8Array(readFileSync(full));
  }
  const age = decoder.decode(files[content('question/age.md')] as Uint8Array);
  files[content('question/age.md')] = `${age}\n![Only here](age/only.webp)\n`;
  files[content('question/age/only.webp')] = new Uint8Array([1, 2, 3]);
  return files;
}

/** The summaries the admin's lists would have kept for every entry of `files`, but for `skip`. */
async function keepSummaries(cache: GitHubCache, files: Record<string, FileInput>, skip: string[] = []) {
  const text = (path: string) => {
    const value = files[path]!;
    return typeof value === 'string' ? value : decoder.decode(value);
  };
  const schema = parseSchemaText(text(SCHEMA), SCHEMA);
  const rows = Object.keys(files).flatMap((path) => {
    const entry = skip.includes(path) ? null : parseEntryPath(schema, path);
    return entry ? [{ path, ...entry }] : [];
  });
  await cache.putSummaries(
    await Promise.all(
      rows.map(async ({ path, collection }) => ({
        sha: await gitBlobSha(text(path)),
        fp: await summaryFingerprint(schema, collection),
        summary: summarizeEntry(schema, collection, parseEntryFile(text(path))),
      })),
    ),
  );
}

/** A source on a fake GitHub with a memory cache; `asked` records every blob sha the commit asks the cache for. */
async function setup(files: Record<string, FileInput>) {
  const fake = createFakeGitHub({ branches: { main: files, [BRANCH]: files } });
  const client = createGitHubClient({ token: 'tok', fetch: fake.fetch });
  const memory = createMemoryCache();
  const asked: string[] = [];
  const cache: GitHubCache = {
    ...memory,
    getBlobs: (shas) => {
      asked.push(...shas);
      return memory.getBlobs(shas);
    },
  };
  const source = createGitHubSource({ owner: 'o', repo: 'r', branch: BRANCH, client, cache });
  await source.listFiles();
  asked.length = 0;
  const shas = fake.state.commits.get(fake.state.refs.get(BRANCH)!)!.files;
  const askedPaths = () => [...shas].filter(([, sha]) => asked.includes(sha)).map(([path]) => path);
  return { fake, cache, source, asked, askedPaths };
}

type Kept = 'all' | 'none' | { but: string[] };

async function commitOn(files: Record<string, FileInput>, changes: GitHubFileChange[], kept: Kept) {
  const context = await setup(files);
  if (kept !== 'none') await keepSummaries(context.cache, files, kept === 'all' ? [] : kept.but);
  const { issues, commit } = await context.source.commit(changes, 'Change');
  return { ...context, issues, committed: commit !== undefined, read: context.askedPaths() };
}

const remove = (...paths: string[]): GitHubFileChange[] => paths.map((p) => ({ path: content(p), content: null }));
const entryCount = Object.keys(surveyFiles()).filter((p) => p.endsWith('.md')).length;

/** Commits `changes` both ways; both must refuse or accept alike, with the same issues in the same order. */
async function bothWays(changes: GitHubFileChange[], files = surveyFiles()) {
  const full = await commitOn(files, changes, 'none');
  const summaries = await commitOn(files, changes, 'all');
  expect(summaries.issues).toEqual(full.issues);
  expect(summaries.committed).toBe(full.committed);
  return { full, summaries, issues: full.issues.map((i) => `${i.file?.replace('cms/content/', '')} ${i.path}`) };
}

const suspectsRead = (read: string[]) => read.map((p) => p.replace('cms/content/', '')).toSorted();

describe('the delete re-check from kept summaries', () => {
  it('deleting a referenced entry', async () => {
    const { full, summaries, issues } = await bothWays(remove('question/rating.md'));
    expect(issues).toEqual(['question/role.md next', 'section/feedback.md questions.0']);
    expect(full.read).toHaveLength(entryCount - 1);
    expect(suspectsRead(summaries.read)).toEqual(['question/role.md', 'section/feedback.md']);
  });

  it('deleting an unreferenced entry reads nothing', async () => {
    const { full, summaries, issues } = await bothWays(remove('survey/pulse.md'));
    expect(issues).toEqual([]);
    expect(summaries.committed).toBe(true);
    expect(full.read).toHaveLength(entryCount - 1);
    expect(summaries.read).toEqual([]);
  });

  it.each([
    ['brand/logo.webp', 'brand/index.md logo.src', 'brand/index.md'],
    ['question/role/diagram.webp', 'question/role.md image.src', 'question/role.md'],
    ['page/landing/hero.webp', 'page/landing.md content.0.image.src', 'page/landing.md'],
    ['page/landing/fast.webp', 'page/landing.md content.1.items.0.icon.src', 'page/landing.md'],
  ])('deleting an image an image field uses: %s', async (image, issue, user) => {
    const { summaries, issues } = await bothWays(remove(image));
    expect(issues).toEqual([issue]);
    expect(suspectsRead(summaries.read)).toEqual([user]);
  });

  it('deleting an image only a body shows reads nothing', async () => {
    const { summaries, issues } = await bothWays(remove('question/age/only.webp'));
    expect(issues).toEqual([]);
    expect(summaries.committed).toBe(true);
    expect(summaries.read).toEqual([]);
  });

  it('deleting an image of a nested Markdown string is no issue', async () => {
    const { summaries, issues } = await bothWays(remove('page/landing/chart.webp'));
    expect(issues).toEqual([]);
    // Read all the same: `deleteSuspects` does not yet tell a nested Markdown image from a nested image field.
    expect(suspectsRead(summaries.read)).toEqual(['page/landing.md']);
  });

  it('deleting an entry a blocks item references', async () => {
    const { summaries, issues } = await bothWays(remove('survey/onboarding.md'));
    expect(issues).toEqual(['page/landing.md content.3.survey']);
    expect(suspectsRead(summaries.read)).toEqual(['page/landing.md']);
  });

  it('leaves out the entries the batch itself writes or deletes', async () => {
    const files = surveyFiles();
    const feedback = '---\ntitle: Feedback\norder: 2\n---\n';
    const { summaries, issues } = await bothWays(
      [
        ...remove('question/rating.md', 'question/role.md'),
        { path: content('section/feedback.md'), content: feedback },
      ],
      files,
    );
    expect(issues).toContain('section/about-you.md questions.1');
    expect(suspectsRead(summaries.read)).not.toContain('section/feedback.md');
    expect(suspectsRead(summaries.read)).not.toContain('question/role.md');
  });

  it('reads an entry with no kept summary, with the suspects, and keeps no blob of them', async () => {
    const files = surveyFiles();
    const changes = remove('survey/onboarding.md');
    const partial = await commitOn(files, changes, { but: [content('survey/pulse.md')] });
    expect(partial.issues).toEqual((await commitOn(files, changes, 'none')).issues);
    expect(suspectsRead(partial.read)).toEqual(['page/landing.md', 'survey/pulse.md']);
    expect((await partial.cache.getBlobs(partial.asked)).size).toBe(0);
  });

  it('falls back to reading every entry when no summary is kept, or the cache fails', async () => {
    const files = surveyFiles();
    const changes = remove('survey/onboarding.md');
    const none = await commitOn(files, changes, 'none');
    expect(none.read).toHaveLength(entryCount - 1);
    expect((await none.cache.getBlobs(none.asked)).size).toBe(0);

    const failing = await setup(files);
    failing.cache.getSummaries = () => Promise.reject(new Error('no database'));
    expect((await failing.source.commit(changes, 'Change')).issues).toEqual(none.issues);
    expect(failing.askedPaths()).toEqual(none.read);
  });

  it('keeps the summaries the admin would make of what it read, and decides the next delete from them', async () => {
    const files = surveyFiles();
    const context = await commitOn(files, remove('survey/pulse.md'), 'none');
    const schema = parseSchemaText(decoder.decode(files[SCHEMA] as Uint8Array), SCHEMA);
    const entries = Object.keys(files).filter((p) => p.endsWith('.md') && p !== content('survey/pulse.md'));
    expect(entries).toHaveLength(entryCount - 1);
    for (const path of entries) {
      const text = typeof files[path] === 'string' ? files[path] : decoder.decode(files[path]);
      const { collection } = parseEntryPath(schema, path)!;
      const key = { sha: await gitBlobSha(text), fp: await summaryFingerprint(schema, collection) };
      const stored = (await context.cache.getSummaries([key])).get(`${key.sha}:${key.fp}`);
      expect(stored, path).toStrictEqual(summarizeEntry(schema, collection, parseEntryFile(text)));
      expect(stored?.v, path).toBe(SUMMARY_VERSION);
    }

    context.asked.length = 0;
    const changes = remove('question/rating.md');
    const second = await context.source.commit(changes, 'Next');
    const full = await commitOn(files, changes, 'none');
    expect(second.issues).toEqual(full.issues);
    expect(suspectsRead(context.askedPaths())).toEqual(['question/role.md', 'section/feedback.md']);
  });

  it('commits when an entry does not parse or the summaries cannot be written', async () => {
    const broken = content('option/broken.md');
    const files = { ...surveyFiles(), [broken]: '---\nlabel: [\n---\n' };
    const context = await setup(files);
    expect((await context.source.commit(remove('survey/pulse.md'), 'First')).issues).toEqual([]);
    context.asked.length = 0;
    // No summary of a file that does not parse: it is read again, alone.
    expect((await context.source.commit(remove('option/age-draft.md'), 'Second')).issues).not.toEqual([]);
    expect(suspectsRead(context.askedPaths())).toEqual(['option/broken.md', 'question/age.md']);

    const failing = await setup(files);
    failing.cache.putSummaries = () => Promise.reject(new Error('quota exceeded'));
    const result = await failing.source.commit(remove('survey/pulse.md'), 'Delete');
    expect(result.issues).toEqual([]);
    expect(result.commit).toBeDefined();
  });

  it('a schema change with a delete re-checks every entry', async () => {
    const files = surveyFiles();
    const schema = JSON.parse(decoder.decode(files[SCHEMA] as Uint8Array));
    schema.collections.option.fields.hint = { type: 'string', label: 'Hint', required: true };
    const changes = [...remove('survey/pulse.md'), { path: SCHEMA, content: JSON.stringify(schema) }];
    const { full, summaries, issues } = await bothWays(changes, files);
    expect(issues).toContain('option/age-young.md hint');
    expect(summaries.read).toEqual(full.read);
    // Every entry, the deleted one too, as before this check; and the blobs are kept.
    expect(summaries.read.filter((p) => p.endsWith('.md'))).toHaveLength(entryCount);
    expect((await summaries.cache.getBlobs(summaries.asked)).size).toBeGreaterThan(0);
  });
});

describe('the delete re-check over 2,000 posts', () => {
  const POSTS = 2000;
  const slug = (i: number) => `post-${String(i).padStart(4, '0')}`;
  const files: Record<string, FileInput> = {
    [SCHEMA]: JSON.stringify({
      contentDir: 'cms/content',
      git: { baseBranch: 'main' },
      collections: {
        post: {
          label: 'Post',
          fields: {
            title: { type: 'string', label: 'Title', required: true },
            cover: { type: 'image', label: 'Cover' },
            related: { type: 'reference', label: 'Related', collections: ['post'] },
            body: { type: 'markdown', label: 'Body' },
          },
        },
      },
    }),
  };
  // Three posts point at post 1; nothing points at post 2.
  for (let i = 0; i < POSTS; i++) {
    const related = i >= 10 && i < 13 ? `related: post/${slug(1)}\n` : '';
    files[content(`post/${slug(i)}.md`)] = `---\ntitle: Post ${i}\n${related}---\n![body](${slug(i)}.webp)\n`;
  }
  const blobRequests = (calls: { operation?: string; url: string }[]) =>
    calls.filter((c) => c.operation === 'Blobs' || c.url.includes('/git/blobs/')).length;

  it('deleting an unreferenced post reads no entry blob', async () => {
    const context = await setup(files);
    await keepSummaries(context.cache, files);
    const from = context.fake.calls.length;
    const result = await context.source.commit(remove(`post/${slug(2)}.md`), 'Delete');
    expect(result.issues).toEqual([]);
    expect(context.asked).toEqual([]);
    expect(blobRequests(context.fake.calls.slice(from))).toBe(0);
  });

  it('with no summaries, the first delete reads every post and keeps its summary; the next reads none', async () => {
    const context = await setup(files);
    expect((await context.source.commit(remove(`post/${slug(2)}.md`), 'Delete')).issues).toEqual([]);
    expect(context.asked).toHaveLength(POSTS - 1);
    expect((await context.cache.getBlobs(context.asked)).size).toBe(0);

    context.asked.length = 0;
    const from = context.fake.calls.length;
    const result = await context.source.commit(remove(`post/${slug(3)}.md`), 'Delete another');
    expect(result.issues).toEqual([]);
    expect(result.commit).toBeDefined();
    expect(context.asked).toEqual([]);
    expect(blobRequests(context.fake.calls.slice(from))).toBe(0);
  });

  it('deleting a referenced post reads only its referrers', async () => {
    const context = await setup(files);
    await keepSummaries(context.cache, files);
    const from = context.fake.calls.length;
    const result = await context.source.commit(remove(`post/${slug(1)}.md`), 'Delete');
    const referrers = [10, 11, 12].map((i) => content(`post/${slug(i)}.md`));
    expect(result.issues.map((i) => i.file)).toEqual(referrers);
    expect(context.askedPaths()).toEqual(referrers);
    expect(blobRequests(context.fake.calls.slice(from))).toBe(1);
  });
});
