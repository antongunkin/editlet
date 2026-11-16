// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  childEnv,
  copyPackage,
  defaultRunner,
  defaultTarget,
  exportMessage,
  exportPackage,
  exportSource,
  isPublicRepoUrl,
  parseExportArgs,
  preflightTarget,
} from './export-repo.mjs';

const PUBLIC_URL = 'git@github.com:antongunkin/editlet.git';

const made: string[] = [];
/** A temp dir removed after the file's tests. */
function temp(prefix: string) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(dir: string) {
  git(dir, 'config', 'user.name', 'editlet export test');
  git(dir, 'config', 'user.email', 'export-test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', '/dev/null');
}

function write(root: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

/** A cms-shaped source repo: root files + packages/editlet with a .gitignore, an executable script and a nested file. */
function source() {
  const root = temp('editlet-export-src-');
  git(root, 'init', '-q', '-b', 'main');
  configure(root);
  write(root, {
    'package.json': '{ "name": "cms", "private": true }\n',
    'README.md': '# cms\n',
    'packages/editlet/package.json': `${JSON.stringify({ name: 'editlet', version: '0.1.0-alpha.0' })}\n`,
    'packages/editlet/.gitignore': '/dist/\n/node_modules/\n*.tgz\n',
    'packages/editlet/admin/.gitignore': 'dist/\n',
    'packages/editlet/admin/main.ts': 'export {};\n',
    'packages/editlet/scripts/run.mjs': '#!/usr/bin/env node\n',
    'packages/editlet/core/index.ts': 'export const a = 1;\n',
    'packages/editlet/old.md': 'removed in a later release\n',
  });
  chmodSync(join(root, 'packages/editlet/scripts/run.mjs'), 0o755);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'source\n\nCo-Authored-By: someone <x@example.com>');
  return root;
}

function commitSource(src: string, files: Record<string, string>, message = 'next') {
  write(src, files);
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', message);
}

/**
 * A clone of an empty public repo: unborn `main`. By default origin really is a bare local repo, and `run` answers
 * the origin URL lookups with the github.com URL (so the checks pass and ls-remote/push stay local). With `origin`,
 * that URL is set as is (for the preflight checks, which never contact it).
 */
function target({ origin }: { origin?: string } = {}) {
  const root = temp('editlet-export-target-');
  git(root, 'init', '-q', '-b', 'main');
  configure(root);
  let url = origin;
  if (!url) {
    url = temp('editlet-export-origin-');
    execFileSync('git', ['init', '--bare', '-q', '-b', 'main', url]);
  }
  git(root, 'remote', 'add', 'origin', url);
  return root;
}

type Options = { cwd?: string; capture?: boolean };
/** Real git, except the origin URL lookups, which answer like a clone of the public repo. */
const run = (command: string, args: string[], options: Options = {}) =>
  command === 'git' && args[0] === 'remote' && args[1] === 'get-url'
    ? { status: 0, stdout: `${PUBLIC_URL}\n`, stderr: '' }
    : defaultRunner(command, args, { ...options, capture: true });

/** Pushes `main` to the bare origin. */
const markPushed = (dir: string) => git(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/main');

const files = (root: string) =>
  git(root, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter(Boolean).toSorted();
const subject = (root: string) => git(root, 'log', '-1', '--format=%s');
const short = (root: string) => git(root, 'rev-parse', '--short=7', 'HEAD');

describe('isPublicRepoUrl', () => {
  it.each([
    'git@github.com:antongunkin/editlet.git',
    'git@github.com:antongunkin/editlet',
    'https://github.com/antongunkin/editlet.git',
    'https://github.com/antongunkin/editlet',
    'https://x-access-token@github.com/AntonGunkin/Editlet.git',
    'ssh://git@github.com/antongunkin/editlet.git',
    ' git@github.com:antongunkin/editlet.git\n',
  ])('accepts %s', (url) => expect(isPublicRepoUrl(url)).toBe(true));

  it.each([
    'git@github.com:antongunkin/cms.git',
    'git@github.com:someone/editlet.git',
    'https://github.com/antongunkin/editlet-fork.git',
    'https://gitlab.com/antongunkin/editlet.git',
    '/tmp/origin.git',
    '',
    undefined,
  ])('rejects %s', (url) => expect(isPublicRepoUrl(url)).toBe(false));
});

describe('small helpers', () => {
  it('formats and reads the one-line export message', () => {
    expect(exportMessage('1abe7985b429b54d')).toBe('chore: sync editlet from antongunkin/cms@1abe798');
    expect(exportSource('chore: sync editlet from antongunkin/cms@1abe798')).toBe('1abe798');
    expect(exportSource('chore(release): 0.1.0-alpha.0')).toBeNull();
    expect(exportSource('chore: sync uiify from antongunkin/ui@1abe798')).toBeNull();
  });

  it('takes an optional target directory and nothing else', () => {
    expect(parseExportArgs([])).toEqual({ target: undefined });
    expect(parseExportArgs(['../editlet'])).toEqual({ target: '../editlet' });
    expect(() => parseExportArgs(['--push'])).toThrow('Unknown argument: --push');
    expect(() => parseExportArgs(['a', 'b'])).toThrow('One target directory only');
  });

  it('drops the npm run settings from the child environment, but keeps registry and auth config', () => {
    const env = childEnv({
      PATH: '/bin',
      npm_config_dry_run: 'true',
      npm_lifecycle_event: 'release',
      npm_config_registry: 'https://r.example',
      npm_config_userconfig: '/home/u/.npmrc',
    });
    expect(env).toEqual({
      PATH: '/bin',
      npm_config_registry: 'https://r.example',
      npm_config_userconfig: '/home/u/.npmrc',
    });
  });

  it('defaults the target to editlet next to the main checkout, also from a git worktree', () => {
    const src = source();
    const tree = join(temp('editlet-export-wt-'), 'wt');
    git(src, 'worktree', 'add', '-q', tree);
    expect(defaultTarget(src)).toBe(join(src, '..', 'editlet'));
    expect(defaultTarget(tree)).toBe(join(src, '..', 'editlet'));
  });
});

describe('preflightTarget', () => {
  it('rejects a target whose origin is not antongunkin/editlet', () => {
    const dir = target({ origin: 'git@github.com:antongunkin/cms.git' });
    expect(() => preflightTarget({ target: dir })).toThrow('origin must be github.com/antongunkin/editlet');
    git(dir, 'remote', 'remove', 'origin');
    expect(() => preflightTarget({ target: dir })).toThrow('got none');
  });

  it('needs the push URL of origin to be the public repo too', () => {
    const dir = target({ origin: PUBLIC_URL });
    git(dir, 'remote', 'set-url', '--push', 'origin', '/nonexistent/push-disabled');
    expect(() => preflightTarget({ target: dir })).toThrow(
      'the push URL of origin must be github.com/antongunkin/editlet, got /nonexistent/push-disabled',
    );
    git(dir, 'remote', 'set-url', '--push', 'origin', 'https://github.com/antongunkin/editlet.git');
    expect(preflightTarget({ target: dir })).toMatchObject({ unborn: true, head: null, ref: 'refs/heads/main' });
  });

  it('says how to fix an empty clone whose default branch is not main', () => {
    const dir = temp('editlet-export-master-');
    git(dir, 'init', '-q', '-b', 'master');
    git(dir, 'remote', 'add', 'origin', PUBLIC_URL);
    expect(() => preflightTarget({ target: dir })).toThrow(
      'must be on main, not master (an empty clone with another default branch: ' +
        'run git symbolic-ref HEAD refs/heads/main there)',
    );
    git(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
    expect(preflightTarget({ target: dir })).toMatchObject({ unborn: true });
  });

  it('rejects a missing dir, a subdirectory of a repo, and another branch', () => {
    const dir = target({ origin: PUBLIC_URL });
    expect(() => preflightTarget({ target: join(dir, 'nope') })).toThrow('does not exist; clone it first');
    mkdirSync(join(dir, 'sub'));
    expect(() => preflightTarget({ target: join(dir, 'sub') })).toThrow('must be the root of a git checkout');
    git(dir, 'checkout', '-q', '-b', 'other');
    expect(() => preflightTarget({ target: dir })).toThrow('must be on main, not other');
  });

  it('rejects a dirty target, untracked files included', () => {
    const dir = target({ origin: PUBLIC_URL });
    git(dir, 'config', 'status.showUntrackedFiles', 'no');
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    expect(() => preflightTarget({ target: dir })).toThrow(
      'must be clean (the export replaces its tree):\n?? notes.txt',
    );
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('mine');
  });
});

describe('exportPackage', () => {
  it('makes the root commit of an unborn target: exactly the package tree, one line, no trailers', () => {
    const src = source();
    const dir = target();
    const result = exportPackage({ sourceRoot: src, target: dir, run });

    const sha = git(src, 'rev-parse', 'HEAD');
    expect(result).toMatchObject({ amended: false, changed: true, sourceSha: sha });
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(git(dir, 'log', '-1', '--format=%B')).toBe(`chore: sync editlet from antongunkin/cms@${sha.slice(0, 7)}`);
    expect(git(dir, 'log', '-1', '--format=%(trailers)')).toBe('');
    expect(git(dir, 'rev-parse', 'HEAD^{tree}')).toBe(git(src, 'rev-parse', 'HEAD:packages/editlet'));
    expect(files(dir)).toEqual([
      '.gitignore',
      'admin/.gitignore',
      'admin/main.ts',
      'core/index.ts',
      'old.md',
      'package.json',
      'scripts/run.mjs',
    ]);
    expect(statSync(join(dir, 'scripts/run.mjs')).mode & 0o111).not.toBe(0);
    expect(git(dir, 'status', '--porcelain', '-unormal')).toBe('');
    expect(git(dir, 'tag', '-l')).toBe('');
  });

  it('amends an unpushed root export: still one commit, the new tree and the new cms sha', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });

    const second = exportPackage({ sourceRoot: src, target: dir, run });
    expect(second).toMatchObject({ amended: true, changed: true });
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(subject(dir)).toBe(`chore: sync editlet from antongunkin/cms@${short(src)}`);
    expect(readFileSync(join(dir, 'core/index.ts'), 'utf8')).toBe('export const a = 2;\n');
    expect(git(dir, 'rev-parse', 'HEAD^{tree}')).toBe(git(src, 'rev-parse', 'HEAD:packages/editlet'));
  });

  it('amends an unpushed export on top of origin/main, and adds a new one on top of a pushed release', () => {
    const src = source();
    const dir = target();
    const first = exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    const second = exportPackage({ sourceRoot: src, target: dir, run });
    expect(second.amended).toBe(false);
    expect(git(dir, 'rev-parse', 'HEAD~1')).toBe(first.commit);

    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 3;\n' });
    const third = exportPackage({ sourceRoot: src, target: dir, run });
    expect(third.amended).toBe(true);
    expect(git(dir, 'rev-list', '--count', 'origin/main..HEAD')).toBe('1');
    expect(git(dir, 'rev-parse', 'HEAD~1')).toBe(first.commit);
    expect(subject(dir)).toBe(`chore: sync editlet from antongunkin/cms@${short(src)}`);
  });

  it('never amends a pushed export, even when the local origin/main is missing or stale', () => {
    const src = source();
    const dir = target();
    const first = exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    git(dir, 'update-ref', '-d', 'refs/remotes/origin/main'); // pushed from here without updating the tracking ref
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    const second = exportPackage({ sourceRoot: src, target: dir, run });
    expect(second.amended).toBe(false);
    expect(git(dir, 'rev-parse', 'HEAD~1')).toBe(first.commit);
  });

  it('fetches a main pushed from elsewhere, and stops because main is behind it', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    const origin = git(dir, 'config', 'remote.origin.url');
    const other = temp('editlet-export-other-');
    execFileSync('git', ['clone', '-q', origin, other]);
    configure(other);
    git(other, 'commit', '-q', '--allow-empty', '-m', 'released elsewhere');
    git(other, 'push', '-q', 'origin', 'main');
    const head = git(dir, 'rev-parse', 'HEAD');
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow(
      `reset --keep ${git(other, 'rev-parse', 'HEAD')}`,
    );
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('makes no commit when the package did not change', () => {
    const src = source();
    const dir = target();
    const first = exportPackage({ sourceRoot: src, target: dir, run });
    const again = exportPackage({ sourceRoot: src, target: dir, run });
    expect(again).toMatchObject({ changed: false, commit: first.commit });
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('refuses local work that is not one unpushed export, and leaves it alone', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    exportPackage({ sourceRoot: src, target: dir, run }); // unchanged: no commit
    writeFileSync(join(dir, 'notes.md'), 'mine\n');
    git(dir, 'add', 'notes.md');
    git(dir, 'commit', '-q', '-m', 'my own commit');
    const head = git(dir, 'rev-parse', 'HEAD');
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow(
      'has commits that are not on origin/main and are not one unpushed export',
    );
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(dir, 'notes.md'), 'utf8')).toBe('mine\n');
  });

  it('refuses to amend an export commit that was edited after the export', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    writeFileSync(join(dir, 'core/index.ts'), 'edited in the public repo\n');
    git(dir, 'commit', '-q', '--amend', '--no-edit', '-a');
    const head = git(dir, 'rev-parse', 'HEAD');
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow('are not one unpushed export');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
  });

  it('refuses when main is behind origin/main (released elsewhere)', () => {
    const src = source();
    const dir = target();
    const first = exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    git(dir, 'reset', '-q', '--keep', first.commit);
    expect(git(dir, 'rev-list', '--count', 'HEAD..origin/main')).toBe('1');
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow(/reset --keep [0-9a-f]{40}$/);
  });

  it('replaces the tree: deleted files go, .git and node_modules stay, dist/ is deleted for the rebuild', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    markPushed(dir);
    mkdirSync(join(dir, 'node_modules/dep'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/dep/index.js'), 'installed');
    write(dir, { 'dist/old.js': 'built' });

    git(src, 'rm', '-q', 'packages/editlet/old.md');
    commitSource(src, { 'packages/editlet/core/new.ts': 'export const b = 2;\n' });
    const second = exportPackage({ sourceRoot: src, target: dir, run });

    expect(files(dir)).toEqual([
      '.gitignore',
      'admin/.gitignore',
      'admin/main.ts',
      'core/index.ts',
      'core/new.ts',
      'package.json',
      'scripts/run.mjs',
    ]);
    expect(existsSync(join(dir, 'old.md'))).toBe(false);
    expect(readFileSync(join(dir, 'node_modules/dep/index.js'), 'utf8')).toBe('installed');
    expect(existsSync(join(dir, 'dist'))).toBe(false);
    expect(second.buildOutputsRemoved).toEqual(['dist/']);
  });

  it('deletes stale build outputs before the build, keeps the other ignored files of the target', () => {
    const src = source();
    commitSource(src, {
      'packages/editlet/skills/.gitignore': '*/scripts/*.mjs\n',
      'packages/editlet/skills/editlet/scripts/validate.ts': 'export {};\n',
    });
    write(src, { 'packages/editlet/skills/editlet/scripts/keep.mjs': 'tracked on purpose\n' });
    git(src, 'add', '-f', 'packages/editlet/skills/editlet/scripts/keep.mjs');
    git(src, 'commit', '-q', '-m', 'skill');
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    // Left by an earlier build: old.mjs is the output of a script that no longer exists.
    write(dir, {
      'skills/editlet/scripts/old.mjs': 'stale',
      'skills/editlet/scripts/validate.mjs': 'built',
      'skills/editlet-setup/scripts/doctor.mjs': 'built',
      'dist/core/index.js': 'built',
      'admin/dist/index.html': 'built',
      '.DS_Store': 'finder',
      '.env': 'SECRET=mine',
      'admin/.DS_Store': 'finder',
    });
    writeFileSync(join(dir, '.git/info/exclude'), '.DS_Store\n.env\n');
    expect(git(dir, 'status', '--porcelain', '-unormal')).toBe('');

    commitSource(src, { 'packages/editlet/core/index.ts': 'export const a = 2;\n' });
    const result = exportPackage({ sourceRoot: src, target: dir, run });

    expect(result.buildOutputsRemoved).toEqual([
      'dist/',
      'admin/dist/',
      'skills/editlet/scripts/old.mjs',
      'skills/editlet/scripts/validate.mjs',
      'skills/editlet-setup/scripts/doctor.mjs',
    ]);
    expect(readdirSync(join(dir, 'skills/editlet/scripts')).toSorted()).toEqual(['keep.mjs', 'validate.ts']);
    expect(readFileSync(join(dir, '.env'), 'utf8')).toBe('SECRET=mine');
    expect(readFileSync(join(dir, '.DS_Store'), 'utf8')).toBe('finder');
    expect(readFileSync(join(dir, 'admin/.DS_Store'), 'utf8')).toBe('finder');
    expect(git(dir, 'status', '--porcelain', '-unormal')).toBe('');
  });

  it('exports HEAD, not the working tree', () => {
    const src = source();
    const dir = target();
    writeFileSync(join(src, 'packages/editlet/core/index.ts'), 'uncommitted edit\n');
    exportPackage({ sourceRoot: src, target: dir, run });
    expect(readFileSync(join(dir, 'core/index.ts'), 'utf8')).toBe('export const a = 1;\n');
  });

  it('stops on a dirty target before touching it', () => {
    const src = source();
    const dir = target();
    exportPackage({ sourceRoot: src, target: dir, run });
    writeFileSync(join(dir, 'core/index.ts'), 'edited');
    const head = git(dir, 'rev-parse', 'HEAD');
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow('must be clean');
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(head);
    expect(readFileSync(join(dir, 'core/index.ts'), 'utf8')).toBe('edited');
  });

  it('refuses to overwrite an ignored file at a path the export brings in', () => {
    const src = source();
    const dir = target();
    // A file the user keeps out of git through .git/info/exclude, at a path the export brings in.
    writeFileSync(join(dir, '.git/info/exclude'), 'old.md\n');
    writeFileSync(join(dir, 'old.md'), 'private');
    expect(() => exportPackage({ sourceRoot: src, target: dir, run })).toThrow(
      'has untracked (ignored) files where the export puts files:\nold.md',
    );
    expect(readFileSync(join(dir, 'old.md'), 'utf8')).toBe('private');
    expect(() => git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD')).toThrow();
  });
});

const snapshot = (root: string) => ({
  head: git(root, 'rev-parse', 'HEAD'),
  status: git(root, 'status', '--porcelain', '-unormal'),
  tags: git(root, 'tag', '-l'),
  branches: git(root, 'for-each-ref', 'refs/heads'),
});

/** Real git; npm succeeds, except `npm run release:check`. */
const checkFails = (command: string, args: string[], options: { cwd?: string } = {}) => {
  if (command === 'npm' && args[0] === 'run') return { status: 1, stdout: '', stderr: 'size limit exceeded' };
  if (command === 'npm') return { status: 0, stdout: '', stderr: '' };
  return run(command, args, options);
};

describe('copyPackage (release:copy)', () => {
  type Call = { command: string; args: string[]; cwd?: string };
  function recorder() {
    const calls: Call[] = [];
    const record = (command: string, args: string[], options: { cwd?: string } = {}) => {
      calls.push({ command, args, cwd: options.cwd });
      if (command === 'npm') return { status: 0, stdout: '', stderr: '' };
      return run(command, args, options);
    };
    return { run: record, calls };
  }

  it('exports, then runs npm install --no-package-lock and npm run release:check in the target; cms unchanged', () => {
    const src = source();
    const dir = target();
    const before = snapshot(src);
    const { run: record, calls } = recorder();
    const lines: string[] = [];
    const result = copyPackage({
      packageDir: join(src, 'packages/editlet'),
      target: dir,
      run: record,
      log: (l) => lines.push(l),
    });

    expect(result.root).toBe(dir);
    expect(calls.filter((c) => c.command === 'npm')).toEqual([
      { command: 'npm', args: ['install', '--no-package-lock', '--no-audit', '--no-fund'], cwd: dir },
      { command: 'npm', args: ['run', 'release:check'], cwd: dir },
    ]);
    expect(calls.some((c) => c.command === 'git' && ['push', 'tag', 'fetch'].includes(c.args[0]))).toBe(false);
    expect(lines[0]).toMatch(
      /: [0-9a-f]{7} chore: sync editlet from antongunkin\/cms@[0-9a-f]{7} \(committed; nothing pushed\)$/,
    );
    expect(snapshot(src)).toEqual(before);
  });

  it('refuses a dirty packages/editlet in cms before touching the target', () => {
    const src = source();
    const dir = target();
    writeFileSync(join(src, 'packages/editlet/new.ts'), 'untracked\n');
    const { run: record, calls } = recorder();
    expect(() => copyPackage({ packageDir: join(src, 'packages/editlet'), target: dir, run: record })).toThrow(
      'packages/editlet must be clean',
    );
    expect(calls.some((c) => c.command === 'npm')).toBe(false);
    expect(readdirSync(dir)).toEqual(['.git']);
  });

  it('stops when release:check fails, and keeps the local export commit', () => {
    const src = source();
    const dir = target();
    expect(() =>
      copyPackage({ packageDir: join(src, 'packages/editlet'), target: dir, run: checkFails, log: () => {} }),
    ).toThrow('npm run release:check failed (exit 1)\nsize limit exceeded');
    expect(git(dir, 'rev-list', '--count', 'HEAD')).toBe('1');
  });
});

describe('export-repo.mjs (CLI)', () => {
  it('exits 1 with a message for a bad target', () => {
    const script = join(import.meta.dirname, 'export-repo.mjs');
    const missing = join(temp('editlet-export-cli-'), 'missing');
    const result = spawnSync(process.execPath, [script, missing], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`release:copy: Target ${missing} does not exist; clone it first`);
  });

  it('exits 1 for an unknown flag', () => {
    const result = spawnSync(process.execPath, [join(import.meta.dirname, 'export-repo.mjs'), '--push'], {
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown argument: --push');
  });
});
