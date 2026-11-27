// @vitest-environment node
// `POST /__editlet/history` gives what `GET /__editlet/history` gives for each path, on a copy of the survey fixture.
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDevHandler } from './devHandler';
import { listFiles } from './fs';

import { DEV_API_BASE, type DevHistoryResponse, MAX_HISTORY_PATHS } from '../core/devApi';
import type { FileHistory } from '../core/source';

const survey = join(import.meta.dirname, '../__fixtures__/survey');
const URL_BASE = `http://localhost:3000${DEV_API_BASE}/history`;
const NONE: FileHistory = { updated: null, created: null, commits: 0 };

const AGE = 'cms/content/question/age.md';
const ROLE = 'cms/content/question/role.md';
const RATING = 'cms/content/question/rating.md';
const LANDING = 'cms/content/page/landing.md';
const YOUNG = 'cms/content/option/age-young.md';
const ADULT = 'cms/content/option/age-adult.md';

const temps: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-history-'));
  temps.push(dir);
  return dir;
}

/** A copy of the survey fixture at `<repo>/<folder>`, its dev handler and the two history requests. */
async function setup(folder = '') {
  const repo = await tempDir();
  const root = join(repo, folder);
  await cp(survey, root, { recursive: true });
  const handler = createDevHandler({ root });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    handler(
      new Request(URL_BASE, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers }),
    );
  const one = async (path: string) =>
    (await (await handler(new Request(`${URL_BASE}?path=${encodeURIComponent(path)}`))).json()) as FileHistory;
  const batch = async (paths: string[]) => {
    const res = await post({ paths });
    expect(res.status).toBe(200);
    return ((await res.json()) as DevHistoryResponse).histories;
  };
  /** Every path's `GET` answer, by path. */
  const each = async (paths: string[]) =>
    Object.fromEntries(await Promise.all(paths.map(async (path) => [path, await one(path)] as const)));
  return { repo, root, post, one, batch, each };
}

/** Git in `cwd` as `author` on day `day` of May 2026 (the author and the committer date). */
function gitIn(cwd: string) {
  return (day: number, author: string, ...args: string[]) => {
    const date = `2026-05-${String(day).padStart(2, '0')}T10:00:00+02:00`;
    execFileSync('git', ['-c', `user.name=${author}`, '-c', 'user.email=a@example.test', ...args], {
      cwd,
      stdio: 'pipe',
      env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  };
}

/**
 * Merges are where one `git log` of many paths differs from one per path, so the history has: a side branch whose change
 * the merge drops, a merge with changes of both sides to one file, a delete and a re-add, and a rename.
 */
async function withHistory(folder = '') {
  const ctx = await setup(folder);
  // `init` at the top of the repository; every other command in the project, whose paths it takes.
  gitIn(ctx.repo)(1, 'Ann', 'init', '-b', 'main');
  const git = gitIn(ctx.root);
  const append = async (path: string, text: string) =>
    writeFile(join(ctx.root, path), `${await readFile(join(ctx.root, path), 'utf8').catch(() => '')}${text}\n`);
  const commit = (day: number, author: string, message: string) => {
    git(day, author, 'add', '-A');
    git(day, author, 'commit', '-m', message);
  };

  commit(1, 'Ann', 'init');

  git(2, 'Bob', 'checkout', '-b', 'dropped');
  await append(AGE, 'dropped');
  await append(ROLE, 'kept');
  commit(2, 'Bob', 'side: age and role');
  git(3, 'Ann', 'checkout', 'main');
  await append(RATING, 'main');
  await append(LANDING, 'main');
  commit(3, 'Ann', 'main: rating and landing');
  // The merge keeps main's age: the side commit is not in age's history, but it is in role's.
  git(4, 'Ann', 'merge', '--no-ff', '--no-commit', 'dropped');
  git(4, 'Ann', 'checkout', 'HEAD', '--', AGE);
  commit(4, 'Ann', 'merge dropped');

  git(5, 'Cleo', 'checkout', '-b', 'both');
  await writeFile(join(ctx.root, LANDING), `top\n${await readFile(join(ctx.root, LANDING), 'utf8')}`);
  commit(6, 'Cleo', 'side: landing top');
  git(5, 'Ann', 'checkout', 'main');
  await append(LANDING, 'bottom');
  commit(5, 'Ann', 'main: landing bottom');
  git(7, 'Dan', 'merge', '--no-ff', '-m', 'merge both', 'both');

  await rm(join(ctx.root, YOUNG));
  commit(8, 'Ann', 'delete young');
  await append(YOUNG, 'again');
  commit(9, 'Bob', 're-add young');
  git(10, 'Cleo', 'mv', ADULT, 'cms/content/option/age-older.md');
  commit(10, 'Cleo', 'rename adult');

  const paths = [
    ...(await listFiles(ctx.root, 'cms/content')),
    'cms/schema.json',
    ADULT,
    'cms/content/question/never.md',
  ];
  return { ...ctx, git, paths };
}

describe('POST history', () => {
  it('gives the GET answer of every path, from one git log', async () => {
    const { batch, each, paths } = await withHistory();
    const trace = join(await tempDir(), 'trace');
    vi.stubEnv('GIT_TRACE', trace);
    const histories = await batch(paths);
    expect((await readFile(trace, 'utf8')).match(/built-in: git log /g)).toHaveLength(1);
    vi.unstubAllEnvs();

    expect(histories).toEqual(await each(paths));
    expect(histories[AGE]).toMatchObject({ commits: 1, updated: { message: 'init' } });
    expect(histories[ROLE]).toMatchObject({
      commits: 2,
      updated: { actor: { name: 'Bob' }, date: '2026-05-02T10:00:00+02:00', message: 'side: age and role' },
      created: { actor: { name: 'Ann' }, message: 'init' },
    });
    expect(histories[LANDING]!.updated).toMatchObject({ actor: { name: 'Dan' }, message: 'merge both' });
    expect(histories[YOUNG]).toMatchObject({ commits: 3, updated: { message: 're-add young' } });
    expect(histories[ADULT]).toMatchObject({ commits: 2, updated: { message: 'rename adult' } });
    expect(histories['cms/content/question/never.md']).toEqual(NONE);
  });

  it('does the same for a project in a folder of its repository', async () => {
    const { batch, each, paths } = await withHistory('apps/site');
    const histories = await batch(paths);
    expect(histories).toEqual(await each(paths));
    expect(histories[ROLE]!.commits).toBe(2);
  });

  it('does the same for a folder, a glob and a path asked twice', async () => {
    const { batch, each } = await withHistory();
    const paths = ['cms/content/question', 'cms/content/question/*.md', AGE, AGE];
    const histories = await batch(paths);
    expect(Object.keys(histories)).toEqual(paths.slice(0, 3));
    expect(histories).toEqual(await each(paths));
    expect(histories['cms/content/question']!.commits).toBeGreaterThan(histories[AGE]!.commits);
  });

  it('follows renames when git is configured to, as GET does', async () => {
    const { batch, each, git } = await withHistory();
    git(11, 'Ann', 'config', 'log.follow', 'true');
    const paths = ['cms/content/option/age-older.md', AGE];
    const histories = await batch(paths);
    expect(histories).toEqual(await each(paths));
    expect(histories[paths[0]!]!.commits).toBe(2);
  });

  it('is empty outside a git checkout and before the first commit', async () => {
    const { batch, repo } = await setup();
    expect(await batch([AGE, ROLE])).toEqual({ [AGE]: NONE, [ROLE]: NONE });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    expect(await batch([AGE])).toEqual({ [AGE]: NONE });
  });

  it('takes 500 paths', async () => {
    const { batch } = await withHistory();
    const many = Array.from({ length: MAX_HISTORY_PATHS - 1 }, (_, i) => `cms/content/option/missing-${i}.md`);
    const histories = await batch([...many, AGE]);
    expect(Object.keys(histories)).toHaveLength(MAX_HISTORY_PATHS);
    expect(histories[AGE]!.commits).toBe(1);
  });

  it('refuses a bad body, no paths, too many and a path that is not canonical', async () => {
    const { post } = await setup();
    const status = async (body: unknown) => (await post(body)).status;
    expect(await status('not json')).toBe(400);
    expect(await status({})).toBe(400);
    expect(await status({ paths: AGE })).toBe(400);
    expect(await status({ paths: [AGE], more: true })).toBe(400);
    expect(await status({ paths: [] })).toBe(400);
    expect(await status({ paths: Array.from({ length: MAX_HISTORY_PATHS + 1 }, () => AGE) })).toBe(400);
    for (const bad of ['', '/etc/passwd', '../x', 'cms/../x', './a.md', 'a//b', 'a/', ':(top)a', 'a\\b', 'a\nHEAD']) {
      const res = await post({ paths: [AGE, bad] });
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(await res.json()).toEqual({ issues: [{ file: bad, path: '', message: 'Path not readable' }] });
    }
  });

  it('has the guards of the other routes', async () => {
    const { post } = await setup();
    expect((await post({ paths: [AGE] }, { origin: 'http://evil.test' })).status).toBe(403);
    vi.stubEnv('NODE_ENV', 'production');
    expect((await post({ paths: [AGE] })).status).toBe(403);
  });
});
