// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { exportPackage } from './export-repo.mjs';
import {
  bumpRelease,
  checkBump,
  classifyNpmView,
  defaultPrompt,
  defaultRunner,
  formatCommand,
  highestAlphaTag,
  isAlphaVersion,
  isYes,
  majorOf,
  majorWarning,
  parseReleaseArgs,
  publishRelease,
  release,
  releaseVersion,
} from './release.mjs';

type Result = { status: number; stdout: string; stderr: string };
type Call = { command: string; args: string[]; cwd?: string };
type Fake = (call: Call) => Result | undefined;

const ok = (stdout = ''): Result => ({ status: 0, stdout, stderr: '' });
const fail = (stderr: string, status = 1): Result => ({ status, stdout: '', stderr });
const E404 = fail('npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/editlet');
const PUBLIC_URL = 'git@github.com:antongunkin/editlet.git';

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function configure(dir: string) {
  git(dir, 'config', 'user.name', 'editlet release test');
  git(dir, 'config', 'user.email', 'release-test@example.com');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'tag.gpgsign', 'false');
  git(dir, 'config', 'core.hooksPath', '/dev/null');
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * A cms-shaped repo (root + packages/editlet) and, next to it, `editlet`: a clone of an empty public repo (unborn
 * `main`) whose origin really is a bare local repo. The stub runner answers the origin URL lookups in the target
 * with the github.com URL, so the checks pass and every fetch/push goes to the bare repo.
 */
function repos() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'editlet-release-test-')));
  made.push(base);
  const root = join(base, 'cms');
  const pkg = join(root, 'packages/editlet');
  mkdirSync(pkg, { recursive: true });
  git(root, 'init', '-q', '-b', 'main');
  configure(root);
  writeFileSync(join(root, 'package.json'), json({ name: 'cms', private: true, workspaces: ['packages/*'] }));
  writeFileSync(join(pkg, 'package.json'), json({ name: 'editlet', version: '0.1.0-alpha.0' }));
  writeFileSync(join(pkg, '.gitignore'), '/dist/\n/node_modules/\n*.tgz\n');
  writeFileSync(join(pkg, 'index.js'), 'export {};\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'initial');

  const target = join(base, 'editlet');
  const origin = join(base, 'editlet-origin.git');
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', origin]);
  mkdirSync(target);
  git(target, 'init', '-q', '-b', 'main');
  configure(target);
  git(target, 'remote', 'add', 'origin', origin);
  return { base, root, pkg, target, origin };
}

function changeSource(root: string, text: string) {
  writeFileSync(join(root, 'packages/editlet/index.js'), `export const v = ${JSON.stringify(text)};\n`);
  git(root, 'commit', '-q', '-am', `change ${text}`);
}

/** Real git and tar (against the temp repos + bare origin); npm and gh are stubbed and recorded. */
function stubRunner(fake: Fake = () => undefined) {
  const calls: Call[] = [];
  const run = (command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) => {
    const call = { command, args, cwd: options.cwd };
    calls.push(call);
    const faked = fake(call);
    if (faked) return faked;
    const line = args.join(' ');
    if (command === 'git' && line.startsWith('remote get-url') && options.cwd?.endsWith('/editlet')) {
      return ok(`${PUBLIC_URL}\n`);
    }
    if (command === 'git' || command === 'tar') return defaultRunner(command, args, { ...options, capture: true });
    if (command === 'npm' && args[0] === 'view') return E404;
    if (command === 'npm' && args[0] === 'version') {
      // Like `npm version <v> --no-git-tag-version --allow-same-version`: package.json only.
      const path = join(options.cwd!, 'package.json');
      writeFileSync(path, json({ ...JSON.parse(readFileSync(path, 'utf8')), version: args[1] }));
      return ok(`v${args[1]}\n`);
    }
    return ok();
  };
  const lines = () => calls.map((c) => [c.command, ...c.args].join(' '));
  const outward = () => lines().filter((l) => OUTWARD.test(l));
  return { run, calls, lines, outward };
}

const OUTWARD = /^(git push|npm publish|gh release|npm version|git commit |git tag -a)/;
const quiet = () => {};
const noPrompt = async (): Promise<string> => {
  throw new Error('must not prompt');
};

function snapshot(root: string) {
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    status: git(root, 'status', '--porcelain', '-unormal'),
    tags: git(root, 'tag', '-l'),
    branches: git(root, 'for-each-ref', 'refs/heads'),
  };
}

const remote = (origin: string) => execFileSync('git', ['ls-remote', origin], { encoding: 'utf8' }).trim();
const remoteRef = (origin: string, ref: string) =>
  execFileSync('git', ['--git-dir', origin, 'for-each-ref', '--format=%(objectname) %(objecttype)', ref], {
    encoding: 'utf8',
  }).trim();
const remoteFile = (origin: string, rev: string) =>
  execFileSync('git', ['--git-dir', origin, 'show', rev], { encoding: 'utf8' });
const subject = (dir: string, rev = 'HEAD') => git(dir, 'log', '-1', '--format=%s', rev);

/** export + bump against the stubs: the state after a finished release of `version`. */
async function released(r: ReturnType<typeof repos>, run = stubRunner().run) {
  exportPackage({ sourceRoot: r.root, target: r.target, run });
  return bumpRelease({ target: r.target, run, log: quiet });
}

describe('versions from the public repo tags', () => {
  it('reads x.y.z-alpha.N only', () => {
    expect(isAlphaVersion('0.1.0-alpha.0')).toBe(true);
    expect(isAlphaVersion('0.1.0-alpha')).toBe(false);
    expect(isAlphaVersion('0.1.0')).toBe(false);
    expect(isAlphaVersion('0.1.0-beta.1')).toBe(false);
    for (const zero of ['01.0.0-alpha.0', '0.01.0-alpha.0', '0.1.00-alpha.0', '0.1.0-alpha.01']) {
      expect(isAlphaVersion(zero)).toBe(false);
    }
    expect(isAlphaVersion('10.20.30-alpha.40')).toBe(true);
  });

  it('ignores tags with leading zeros and rejects them as --version', () => {
    expect(highestAlphaTag(['v0.1.0-alpha.1', 'v0.1.0-alpha.09'])).toBe('0.1.0-alpha.1');
    expect(() => releaseVersion([], { requested: '0.1.0-alpha.01', fallback: '0.1.0-alpha.0' })).toThrow(
      'must look like',
    );
  });

  it('takes the highest v<x.y.z>-alpha.<N> tag, numerically, and ignores other tags', () => {
    const tags = [
      'v0.1.0-alpha.2',
      'v0.1.0-alpha.10',
      'v0.1.0-alpha.9',
      'v0.2.0',
      'v0.1.0-alpha',
      'junk',
      '0.9.0-alpha.1',
    ];
    expect(highestAlphaTag(tags)).toBe('0.1.0-alpha.10');
    expect(highestAlphaTag(['v0.1.0-alpha.9', 'v0.2.0-alpha.0'])).toBe('0.2.0-alpha.0');
    expect(highestAlphaTag(['v1.0.0', 'nope'])).toBeNull();
    expect(highestAlphaTag([])).toBeNull();
  });

  it('the next version is the highest tag with N + 1; with no tag, the package.json version', () => {
    expect(releaseVersion(['v0.1.0-alpha.0'], { fallback: '0.1.0-alpha.0' })).toBe('0.1.0-alpha.1');
    expect(releaseVersion(['v0.1.0-alpha.0', 'v0.1.0-alpha.1'], { fallback: '0.1.0-alpha.0' })).toBe('0.1.0-alpha.2');
    expect(releaseVersion([], { fallback: '0.1.0-alpha.0' })).toBe('0.1.0-alpha.0');
    expect(() => releaseVersion([], { fallback: '0.1.0' })).toThrow('package.json has 0.1.0, not x.y.z-alpha.N');
  });

  it('--version must be x.y.z-alpha.N and above the highest tag', () => {
    const tags = ['v0.1.0-alpha.3'];
    expect(releaseVersion(tags, { requested: '0.1.0-alpha.7' })).toBe('0.1.0-alpha.7');
    expect(releaseVersion(tags, { requested: '0.2.0-alpha.0' })).toBe('0.2.0-alpha.0');
    expect(releaseVersion([], { requested: '0.3.0-alpha.0', fallback: '0.1.0-alpha.0' })).toBe('0.3.0-alpha.0');
    expect(() => releaseVersion(tags, { requested: '0.1.0-alpha.3' })).toThrow(
      'must be above the last tag v0.1.0-alpha.3',
    );
    expect(() => releaseVersion(tags, { requested: '0.1.0-alpha.2' })).toThrow('must be above the last tag');
    expect(() => releaseVersion(tags, { requested: '0.1.0-alpha' })).toThrow('must look like 0.1.0-alpha.1');
    expect(() => releaseVersion(tags, { requested: '0.2.0' })).toThrow('must look like');
  });

  it('warns loudly on a major version change only', () => {
    expect(majorOf('1.0.0-alpha.0')).toBe(1);
    expect(majorWarning('0.1.0-alpha.3', '0.2.0-alpha.0')).toBeNull();
    expect(majorWarning(null, '0.1.0-alpha.0')).toBeNull();
    expect(majorWarning('0.1.0-alpha.3', '1.0.0-alpha.0')).toMatch(
      /^!! MAJOR VERSION CHANGE: 0\.1\.0-alpha\.3 → 1\.0\.0-alpha\.0/,
    );
  });
});

describe('parseReleaseArgs', () => {
  it('defaults to the full release with the default target', () => {
    expect(parseReleaseArgs([])).toEqual({
      command: 'release',
      target: undefined,
      version: undefined,
      yes: false,
      dryRun: false,
    });
  });

  it('reads the command, a target and the flags in any order', () => {
    expect(parseReleaseArgs(['--version', '0.1.0-alpha.3', '../public', '--yes', '--dry-run'])).toEqual({
      command: 'release',
      target: '../public',
      version: '0.1.0-alpha.3',
      yes: true,
      dryRun: true,
    });
    expect(parseReleaseArgs(['bump', '--version', '0.1.0-alpha.3'])).toMatchObject({
      command: 'bump',
      version: '0.1.0-alpha.3',
    });
    expect(parseReleaseArgs(['publish', '/x/editlet'])).toMatchObject({ command: 'publish', target: '/x/editlet' });
  });

  it('treats `npm run release --dry-run` (npm_config_dry_run, no --) as a dry run', () => {
    expect(parseReleaseArgs([], { npm_config_dry_run: 'true' }).dryRun).toBe(true);
    expect(parseReleaseArgs(['bump'], { npm_config_dry_run: 'true' }).dryRun).toBe(true);
  });

  it('rejects missing values, unknown flags, flags of another command, and two targets', () => {
    expect(() => parseReleaseArgs(['--version'])).toThrow('--version needs a value');
    expect(() => parseReleaseArgs(['--version', '--yes'])).toThrow('--version needs a value');
    expect(() => parseReleaseArgs(['--bogus'])).toThrow('Unknown argument for release: --bogus');
    expect(() => parseReleaseArgs(['bump', '--yes'])).toThrow('Unknown argument for bump: --yes');
    expect(() => parseReleaseArgs(['publish', '--version', '0.1.0-alpha.1'])).toThrow('Unknown argument for publish');
    expect(() => parseReleaseArgs(['a', 'b'])).toThrow('One target directory only');
  });
});

describe('small helpers', () => {
  it('maps npm view: exit 0 → taken, E404 → free, anything else → error', () => {
    expect(classifyNpmView(ok('0.1.0-alpha.0\n'))).toBe('taken');
    expect(classifyNpmView(E404)).toBe('free');
    expect(classifyNpmView(fail('npm error code ENOTFOUND'))).toBe('error');
    expect(classifyNpmView(fail('npm error code E401'))).toBe('error');
  });

  it('accepts only y as yes', () => {
    for (const answer of ['y', 'Y', ' y\n']) expect(isYes(answer)).toBe(true);
    for (const answer of ['', 'n', 'yes', 'yy', undefined]) expect(isYes(answer)).toBe(false);
  });

  it('formats a command with its directory, quoted', () => {
    expect(formatCommand({ command: 'git', args: ['commit', '-m', 'chore(release): 1'], cwd: '/t' })).toBe(
      "(cd /t && git commit -m 'chore(release): 1')",
    );
  });

  it('asks through readline/promises and answers no when the input closes or the prompt is aborted', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const asked = defaultPrompt('Go?', { input, output });
    input.write('y\n');
    expect(await asked).toBe('y');

    const closed = new PassThrough();
    const pending = defaultPrompt('Go?', { input: closed, output: new PassThrough() });
    closed.end();
    expect(await pending).toBe('');

    const abort = new AbortController();
    const aborted = defaultPrompt('Go?', { input: new PassThrough(), output: new PassThrough(), signal: abort.signal });
    abort.abort();
    expect(await aborted).toBe('');
  });
});

describe('release:bump', () => {
  it('first release on an empty remote: tags the export with v0.1.0-alpha.0 and pushes main with the tag', async () => {
    const r = repos();
    const { run, lines } = stubRunner();
    const exported = exportPackage({ sourceRoot: r.root, target: r.target, run });
    const result = await bumpRelease({ target: r.target, run, log: quiet });

    expect(result).toMatchObject({ status: 'bumped', version: '0.1.0-alpha.0', tag: 'v0.1.0-alpha.0' });
    expect(subject(r.target)).toBe('chore(release): 0.1.0-alpha.0');
    expect(git(r.target, 'rev-parse', 'HEAD~1')).toBe(exported.commit);
    expect(remoteRef(r.origin, 'refs/heads/main')).toBe(`${git(r.target, 'rev-parse', 'HEAD')} commit`);
    expect(remoteRef(r.origin, 'refs/tags/v0.1.0-alpha.0')).toMatch(/ tag$/); // annotated
    expect(lines()).toContain('git push --atomic origin main --follow-tags');
    expect(git(r.target, 'status', '--porcelain', '-unormal')).toBe('');
  });

  it('the next release is N + 1 from the tags, and package.json gets that version', async () => {
    const r = repos();
    await released(r);
    changeSource(r.root, 'two');
    const { run } = stubRunner();
    const exported = exportPackage({ sourceRoot: r.root, target: r.target, run });
    expect(JSON.parse(readFileSync(join(r.target, 'package.json'), 'utf8')).version).toBe('0.1.0-alpha.0');

    const result = await bumpRelease({ target: r.target, run, log: quiet });
    expect(result.version).toBe('0.1.0-alpha.1');
    expect(git(r.target, 'rev-parse', 'HEAD~1')).toBe(exported.commit);
    expect(JSON.parse(remoteFile(r.origin, 'main:package.json')).version).toBe('0.1.0-alpha.1');
    expect(remoteRef(r.origin, 'refs/tags/v0.1.0-alpha.1')).toMatch(/ tag$/);

    changeSource(r.root, 'three');
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    expect((await bumpRelease({ target: r.target, run, log: quiet })).version).toBe('0.1.0-alpha.2');
  });

  it('takes --version when it is above the last tag', async () => {
    const r = repos();
    await released(r);
    changeSource(r.root, 'two');
    const { run } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    const head = git(r.target, 'rev-parse', 'HEAD');
    await expect(bumpRelease({ target: r.target, version: '0.1.0-alpha.0', run, log: quiet })).rejects.toThrow(
      'must be above the last tag v0.1.0-alpha.0',
    );
    expect(git(r.target, 'rev-parse', 'HEAD')).toBe(head);
    const result = await bumpRelease({ target: r.target, version: '0.2.0-alpha.0', run, log: quiet });
    expect(result.version).toBe('0.2.0-alpha.0');
  });

  it('needs exactly one export commit ahead of origin/main', async () => {
    const r = repos();
    await released(r);
    const { run } = stubRunner();
    // Nothing exported since the release: 0 ahead.
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow(
      'expected exactly one local export commit ahead of origin/main, found 0',
    );
    changeSource(r.root, 'two');
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    git(r.target, 'commit', '-q', '--allow-empty', '-m', 'extra');
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow('found 2');
    git(r.target, 'reset', '-q', '--keep', 'HEAD~1');
    git(r.target, 'commit', '-q', '--amend', '--allow-empty', '-m', 'not an export');
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow('HEAD is not an export commit');
  });

  it('on an empty remote, main must be the single export commit', async () => {
    const r = repos();
    const { run } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    git(r.target, 'commit', '-q', '--allow-empty', '-m', 'extra');
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow(
      'origin has no main yet, so main must be the single export commit, found 2 commits',
    );
    expect(remote(r.origin)).toBe('');
  });

  it('stops when main is behind origin/main (a release made from another checkout), before any change', async () => {
    const r = repos();
    await released(r);
    changeSource(r.root, 'two');
    const { run } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    // Released from another checkout after this export.
    const other = join(r.base, 'other');
    execFileSync('git', ['clone', '-q', r.origin, other]);
    configure(other);
    git(other, 'commit', '-q', '--allow-empty', '-m', 'chore(release): 0.1.0-alpha.1');
    git(other, 'tag', '-a', 'v0.1.0-alpha.1', '-m', 'v0.1.0-alpha.1');
    git(other, 'push', '-q', '--follow-tags', 'origin', 'main');
    const head = git(r.target, 'rev-parse', 'HEAD');

    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow(
      'main is 1 behind origin/main (released elsewhere?); reset it to origin/main',
    );
    expect(git(r.target, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(r.target, 'tag', '--list', 'v0.1.0-alpha.2')).toBe('');
  });

  it('sees tags pushed from elsewhere: the next version is above them', async () => {
    const r = repos();
    await released(r);
    const other = join(r.base, 'other');
    execFileSync('git', ['clone', '-q', r.origin, other]);
    git(other, 'tag', 'v0.1.0-alpha.4');
    git(other, 'push', '-q', 'origin', 'v0.1.0-alpha.4');
    changeSource(r.root, 'two');
    const { run } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    expect(checkBump({ target: r.target, run }).version).toBe('0.1.0-alpha.5');
  });

  it('stops when HEAD is already tagged', async () => {
    const r = repos();
    const { run } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    git(r.target, 'tag', 'keep-me');
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow('is already tagged (keep-me)');
  });

  it('stops when the version is on npm, or npm cannot be checked, before any change', async () => {
    const r = repos();
    const taken = stubRunner(({ command, args }) =>
      command === 'npm' && args[0] === 'view' ? ok('0.1.0-alpha.0') : undefined,
    );
    exportPackage({ sourceRoot: r.root, target: r.target, run: taken.run });
    const before = snapshot(r.target);
    await expect(bumpRelease({ target: r.target, run: taken.run, log: quiet })).rejects.toThrow(
      'editlet@0.1.0-alpha.0 is already on npm',
    );
    const offline = stubRunner(({ command, args }) =>
      command === 'npm' && args[0] === 'view' ? fail('npm error code ENOTFOUND') : undefined,
    );
    await expect(bumpRelease({ target: r.target, run: offline.run, log: quiet })).rejects.toThrow(
      'Could not check npm for editlet@0.1.0-alpha.0:\nnpm error code ENOTFOUND',
    );
    expect(snapshot(r.target)).toEqual(before);
    expect([...taken.outward(), ...offline.outward()]).toEqual([]);
  });

  it('a failed push undoes its own commit and tag, so the export commit is HEAD again', async () => {
    const r = repos();
    const { run } = stubRunner(({ command, args }) =>
      command === 'git' && args[0] === 'push' ? fail('remote: denied') : undefined,
    );
    const exported = exportPackage({ sourceRoot: r.root, target: r.target, run });
    await expect(bumpRelease({ target: r.target, run, log: quiet })).rejects.toThrow(
      `git push failed (exit 1); nothing was pushed\n${r.target} is back to the export commit ${exported.commit.slice(0, 7)}`,
    );
    expect(git(r.target, 'rev-parse', 'HEAD')).toBe(exported.commit);
    expect(git(r.target, 'tag', '-l')).toBe('');
    expect(git(r.target, 'status', '--porcelain', '-unormal')).toBe('');
    expect(remote(r.origin)).toBe('');
  });

  it('a failed push that origin did take (a lost reply) goes on', async () => {
    const r = repos();
    const { run } = stubRunner(({ command, args, cwd }) => {
      if (command !== 'git' || args[0] !== 'push') return undefined;
      defaultRunner(command, args, { cwd, capture: true });
      return fail('Connection reset by peer');
    });
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    const lines: string[] = [];
    const result = await bumpRelease({ target: r.target, run, log: (l) => lines.push(l) });
    expect(result.status).toBe('bumped');
    expect(lines).toContain('git push reported a failure, but origin/main has the release commit; going on');
    expect(remoteRef(r.origin, 'refs/tags/v0.1.0-alpha.0')).toMatch(/ tag$/);
    expect(git(r.target, 'tag', '-l')).toBe('v0.1.0-alpha.0');
  });

  it('a failed push whose outcome cannot be checked keeps the commit and tag, and prints finish and undo', async () => {
    const r = repos();
    let pushed = false;
    const { run, lines } = stubRunner(({ command, args }) => {
      if (command === 'git' && args[0] === 'push') {
        pushed = true;
        return fail('Connection reset by peer');
      }
      if (pushed && command === 'git' && args[0] === 'ls-remote') return fail('Could not resolve host: github.com');
      return undefined;
    });
    const exported = exportPackage({ sourceRoot: r.root, target: r.target, run });
    const error = await bumpRelease({ target: r.target, run, log: quiet }).catch((e: Error) => e);
    const releaseCommit = git(r.target, 'rev-parse', 'HEAD');
    expect(String(error)).toContain(
      [
        'git push failed (exit 1) and origin could not be checked (git ls-remote --heads origin refs/heads/main ' +
          'failed (exit 1)).',
        `Push outcome unknown; check git -C ${r.target} ls-remote origin. The local commit and v0.1.0-alpha.0 are kept.`,
        `If origin has main at ${releaseCommit.slice(0, 7)} and v0.1.0-alpha.0, the push went through; finish with:`,
        `  (cd ${r.target} && npm publish --tag alpha)`,
        `Otherwise undo with: git -C ${r.target} tag -d v0.1.0-alpha.0 && git -C ${r.target} reset --keep ` +
          exported.commit,
      ].join('\n'),
    );
    expect(git(r.target, 'rev-parse', 'HEAD~1')).toBe(exported.commit);
    expect(git(r.target, 'tag', '-l')).toBe('v0.1.0-alpha.0');
    expect(lines().filter((l) => l.startsWith('git reset') || l.startsWith('git tag -d'))).toEqual([]);
  });

  it('--dry-run checks and prints the steps, changes nothing', async () => {
    const r = repos();
    const { run, outward } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    const before = snapshot(r.target);
    const lines: string[] = [];
    const result = await bumpRelease({ target: r.target, run, log: (l) => lines.push(l), dryRun: true });
    expect(result.status).toBe('dry-run');
    expect(lines).toContain(`  (cd ${r.target} && git push --atomic origin main --follow-tags)`);
    expect(outward()).toEqual([]);
    expect(snapshot(r.target)).toEqual(before);
  });
});

describe('release:publish', () => {
  it('runs npm publish --tag alpha in the target after the bump', async () => {
    const r = repos();
    await released(r);
    const { run, calls } = stubRunner();
    const result = publishRelease({ target: r.target, run, log: quiet });
    expect(result).toMatchObject({ status: 'published', version: '0.1.0-alpha.0' });
    expect(calls.filter((c) => c.command === 'npm' && c.args[0] === 'publish')).toEqual([
      { command: 'npm', args: ['publish', '--tag', 'alpha'], cwd: r.target },
    ]);
  });

  it('refuses when HEAD is not the tagged release, or the tag is not on origin', () => {
    const r = repos();
    const { run, outward } = stubRunner();
    exportPackage({ sourceRoot: r.root, target: r.target, run });
    expect(() => publishRelease({ target: r.target, run, log: quiet })).toThrow(
      'is not tagged v0.1.0-alpha.0; run npm run release:bump first',
    );
    git(r.target, 'tag', '-a', 'v0.1.0-alpha.0', '-m', 'v0.1.0-alpha.0');
    expect(() => publishRelease({ target: r.target, run, log: quiet })).toThrow('v0.1.0-alpha.0 is not on origin yet');
    expect(outward()).toEqual([]);
  });
});

const pushes = (lines: string[]) => lines.filter((l) => /^(git push|npm publish|gh release)/.test(l));

describe('release', () => {
  it('--dry-run: copy, version, npm check, prints the outward commands; no prompt, push or publish', async () => {
    const r = repos();
    const before = snapshot(r.root);
    const { run, lines, outward } = stubRunner();
    const log: string[] = [];
    const result = await release({ dryRun: true, packageDir: r.pkg, run, prompt: noPrompt, log: (l) => log.push(l) });

    // No target given: editlet next to the cms checkout.
    expect(result).toMatchObject({ status: 'dry-run', version: '0.1.0-alpha.0', target: r.target });
    const npm = lines().filter((l) => /^(npm|gh)/.test(l));
    expect(npm).toEqual([
      'npm install --no-package-lock --no-audit --no-fund',
      'npm run release:check',
      'npm view editlet@0.1.0-alpha.0 version',
    ]);
    expect(outward()).toEqual([]);
    expect(log).toEqual(
      expect.arrayContaining([
        'dry run: would run',
        `  (cd ${r.target} && npm version 0.1.0-alpha.0 --no-git-tag-version --allow-same-version)`,
        `  (cd ${r.target} && git commit --quiet --allow-empty -m 'chore(release): 0.1.0-alpha.0')`,
        `  (cd ${r.target} && git tag -a v0.1.0-alpha.0 -m v0.1.0-alpha.0)`,
        `  (cd ${r.target} && git push --atomic origin main --follow-tags)`,
        `  (cd ${r.target} && npm publish --tag alpha)`,
        `  (cd ${r.target} && gh release create v0.1.0-alpha.0 --repo antongunkin/editlet --verify-tag --prerelease ` +
          '--title 0.1.0-alpha.0 --generate-notes)',
      ]),
    );
    // Leaves only the local export commit; nothing on the remote; cms untouched.
    expect(git(r.target, 'rev-list', '--count', 'HEAD')).toBe('1');
    expect(subject(r.target)).toMatch(/^chore: sync editlet from antongunkin\/cms@[0-9a-f]{7}$/);
    expect(git(r.target, 'tag', '-l')).toBe('');
    expect(remote(r.origin)).toBe('');
    expect(snapshot(r.root)).toEqual(before);

    // A second dry run amends the export instead of stacking a second commit.
    changeSource(r.root, 'two');
    await release({ dryRun: true, packageDir: r.pkg, run, prompt: noPrompt, log: quiet });
    expect(git(r.target, 'rev-list', '--count', 'HEAD')).toBe('1');
  });

  it('stops on any answer but y: nothing pushed or published, the export commit stays local', async () => {
    for (const answer of ['', 'n', 'yes']) {
      const r = repos();
      const before = snapshot(r.root);
      const { run, outward } = stubRunner();
      const questions: string[] = [];
      const result = await release({
        packageDir: r.pkg,
        target: r.target,
        run,
        log: quiet,
        prompt: async (question) => {
          questions.push(question);
          return answer;
        },
      });
      expect(result.status).toBe('stopped');
      expect(questions).toEqual([
        'Tag v0.1.0-alpha.0, push it to antongunkin/editlet, publish editlet@0.1.0-alpha.0 to npm with --tag alpha ' +
          'and create a GitHub prerelease?',
      ]);
      expect(outward()).toEqual([]);
      expect(git(r.target, 'rev-list', '--count', 'HEAD')).toBe('1');
      expect(remote(r.origin)).toBe('');
      expect(snapshot(r.root)).toEqual(before);
    }
  });

  it('on y: copy → checks → prompt → bump (push) → npm publish → gh release, in that order', async () => {
    const r = repos();
    const before = snapshot(r.root);
    const order: string[] = [];
    const { run, lines } = stubRunner((call) => {
      const [a, b] = call.args;
      const gitStep = a === 'push' || a === 'commit' || (a === 'tag' && b === '-a');
      if (call.command === 'npm' || call.command === 'gh' || (call.command === 'git' && gitStep)) {
        order.push([call.command, ...call.args.slice(0, 2)].join(' '));
      }
      return undefined;
    });
    const result = await release({
      packageDir: r.pkg,
      run,
      log: quiet,
      prompt: async () => {
        order.push('[y/N]');
        return 'y';
      },
    });

    expect(result).toMatchObject({ status: 'released', version: '0.1.0-alpha.0' });
    expect(order).toEqual([
      'npm install --no-package-lock',
      'npm run release:check',
      'npm view editlet@0.1.0-alpha.0',
      'npm whoami',
      'gh auth status',
      '[y/N]',
      'npm view editlet@0.1.0-alpha.0',
      'npm version 0.1.0-alpha.0',
      'git commit --quiet',
      'git tag -a',
      'git push --atomic',
      'npm view editlet@0.1.0-alpha.0',
      'npm publish --tag',
      'gh release create',
    ]);
    expect(pushes(lines())).toEqual([
      'git push --atomic origin main --follow-tags',
      'npm publish --tag alpha',
      'gh release create v0.1.0-alpha.0 --repo antongunkin/editlet --verify-tag --prerelease --title 0.1.0-alpha.0 ' +
        '--generate-notes',
    ]);
    expect(remoteRef(r.origin, 'refs/tags/v0.1.0-alpha.0')).toMatch(/ tag$/);
    expect(snapshot(r.root)).toEqual(before);

    // The next release from cms: 0.1.0-alpha.1.
    changeSource(r.root, 'two');
    const next = await release({ packageDir: r.pkg, run, log: quiet, yes: true });
    expect(next).toMatchObject({ status: 'released', version: '0.1.0-alpha.1' });
    expect(JSON.parse(remoteFile(r.origin, 'main:package.json')).version).toBe('0.1.0-alpha.1');
    expect(git(r.root, 'tag', '-l')).toBe('');
  });

  it('--yes skips the prompt', async () => {
    const r = repos();
    const { run, lines } = stubRunner();
    const result = await release({ packageDir: r.pkg, target: r.target, run, log: quiet, yes: true, prompt: noPrompt });
    expect(result.status).toBe('released');
    expect(pushes(lines())).toHaveLength(3);
  });

  it('stops before the prompt when npm or gh is not logged in', async () => {
    for (const [cmd, hint] of [
      ['whoami', 'log in to npm first'],
      ['auth', 'log in with gh auth login first'],
    ]) {
      const r = repos();
      const { run, outward } = stubRunner(({ args }) => (args[0] === cmd ? fail('not logged in') : undefined));
      await expect(release({ packageDir: r.pkg, target: r.target, run, log: quiet, prompt: noPrompt })).rejects.toThrow(
        hint,
      );
      expect(outward()).toEqual([]);
    }
  });

  it('Ctrl-C during the push stops before npm publish and the GitHub release, prints them, exits 130', async () => {
    const r = repos();
    const signals = new EventEmitter();
    const { run, lines } = stubRunner(({ command, args, cwd }) => {
      if (command !== 'git' || args[0] !== 'push') return undefined;
      const result = defaultRunner(command, args, { cwd, capture: true });
      signals.emit('SIGINT'); // arrives while the push runs; the push itself goes through
      return result;
    });
    const error = await release({ packageDir: r.pkg, target: r.target, run, log: quiet, yes: true, signals }).catch(
      (e: Error & { exitCode?: number }) => e,
    );
    expect(error).toMatchObject({ exitCode: 130 });
    expect(String(error)).toContain(
      [
        'interrupted by SIGINT. Interrupted by SIGINT',
        'Pushed v0.1.0-alpha.0 to antongunkin/editlet. Finish by hand with:',
        `  (cd ${r.target} && npm publish --tag alpha)`,
        `  (cd ${r.target} && gh release create v0.1.0-alpha.0 --repo antongunkin/editlet --verify-tag --prerelease ` +
          '--title 0.1.0-alpha.0 --generate-notes)',
      ].join('\n'),
    );
    expect(lines().filter((l) => /^(npm publish|gh release)/.test(l))).toEqual([]);
    expect(remoteRef(r.origin, 'refs/tags/v0.1.0-alpha.0')).toMatch(/ tag$/);
    expect(signals.listenerCount('SIGINT')).toBe(0);
  });

  it('SIGTERM during npm publish stops before the GitHub release and prints it, exits 143', async () => {
    const r = repos();
    const signals = new EventEmitter();
    const { run, lines } = stubRunner(({ command, args }) => {
      if (command === 'npm' && args[0] === 'publish') signals.emit('SIGTERM');
      return undefined;
    });
    const error = await release({ packageDir: r.pkg, target: r.target, run, log: quiet, yes: true, signals }).catch(
      (e: Error & { exitCode?: number }) => e,
    );
    expect(error).toMatchObject({ exitCode: 143 });
    expect(String(error)).toMatch(/Finish by hand with:\n {2}\(cd .* && gh release create v0\.1\.0-alpha\.0 [^\n]*\)$/);
    expect(String(error)).not.toContain('&& npm publish');
    expect(lines().filter((l) => l.startsWith('gh release'))).toEqual([]);
  });

  it('a failure after the push says what is done and how to finish', async () => {
    const r = repos();
    const failing = stubRunner(({ command, args }) =>
      command === 'npm' && args[0] === 'publish' ? fail('npm error code E403') : undefined,
    );
    await expect(
      release({ packageDir: r.pkg, target: r.target, run: failing.run, log: quiet, yes: true }),
    ).rejects.toThrow(
      [
        'npm publish --tag alpha failed (exit 1)\nnpm error code E403',
        'Pushed v0.1.0-alpha.0 to antongunkin/editlet. Finish by hand with:',
        `  (cd ${r.target} && npm publish --tag alpha)`,
        `  (cd ${r.target} && gh release create v0.1.0-alpha.0 --repo antongunkin/editlet --verify-tag --prerelease ` +
          '--title 0.1.0-alpha.0 --generate-notes)',
      ].join('\n'),
    );

    const r2 = repos();
    const noGh = stubRunner(({ command, args }) =>
      command === 'gh' && args[0] === 'release' ? fail('HTTP 401') : undefined,
    );
    await expect(
      release({ packageDir: r2.pkg, target: r2.target, run: noGh.run, log: quiet, yes: true }),
    ).rejects.toThrow(
      /gh release create .* failed \(exit 1\)\nHTTP 401\nPushed v0\.1\.0-alpha\.0 .*\n {2}\(cd .* && gh release create/,
    );
  });
});

describe('release interrupted by a signal (Ctrl-C)', () => {
  const releaseUrl = pathToFileURL(join(import.meta.dirname, 'release.mjs')).href;
  /**
   * A child process running release() with stubbed npm/gh. `npm run release:check` is the long step (before the
   * prompt); every outward command, and the prompt, append to `outward` instead of running.
   */
  const script = (sleepMs: number) => `
import { appendFileSync, writeFileSync } from 'node:fs';
import { defaultRunner, release } from ${JSON.stringify(releaseUrl)};
const [pkg, target, marker, outward, mode] = process.argv.slice(2);
const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
const run = (command, args, options = {}) => {
  const line = [command, ...args].join(' ');
  if (command === 'git' && options.cwd === target && args.join(' ').startsWith('remote get-url')) {
    return ok('git@github.com:antongunkin/editlet.git\\n');
  }
  if (/^(git push|git tag -a|git commit |npm version|npm publish|gh release|npm whoami|gh auth)/.test(line)) {
    appendFileSync(outward, line + '\\n');
    return ok();
  }
  if (command === 'git' || command === 'tar') return defaultRunner(command, args, { ...options, capture: true });
  if (command === 'npm' && args[0] === 'view') return { status: 1, stdout: '', stderr: 'npm error code E404' };
  if (command === 'npm' && args[0] === 'run') {
    writeFileSync(marker, 'long step');
    return defaultRunner(process.execPath, ['-e', 'setTimeout(() => {}, ${sleepMs})'], {});
  }
  return ok();
};
try {
  const result = await release({ dryRun: mode === 'dry', yes: mode === 'yes', target, packageDir: pkg, run,
    log: () => {}, prompt: async () => { appendFileSync(outward, '[y/N]\\n'); return 'y'; } });
  process.stdout.write('finished ' + result.status + '\\n');
} catch (error) {
  process.stderr.write(error.message + '\\n');
  process.exitCode = error.exitCode ?? 1;
}
`;

  async function interrupt({
    mode,
    sleepMs,
    kill,
  }: {
    mode: 'dry' | 'real' | 'yes';
    sleepMs: number;
    kill: (pid: number) => void;
  }) {
    const r = repos();
    const dir = join(r.base, 'signal');
    mkdirSync(dir);
    const file = join(dir, 'run.mjs');
    const marker = join(dir, 'marker');
    const outward = join(dir, 'outward');
    writeFileSync(file, script(sleepMs));
    const before = snapshot(r.root);
    // detached: its own process group, like a terminal job, so a group kill reaches the long child too
    const child = spawn(process.execPath, [file, r.pkg, r.target, marker, outward, mode], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    const exited = new Promise<number | null>((done) => child.on('close', (code) => done(code)));
    const deadline = Date.now() + 20_000;
    while (!existsSync(marker)) {
      if (Date.now() > deadline) throw new Error(`no long step:\n${stdout}\n${stderr}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    kill(child.pid!);
    const code = await exited;
    const reached = existsSync(outward) ? readFileSync(outward, 'utf8') : '';
    return { code, stdout, stderr, reached, r, before };
  }

  it('Ctrl-C (SIGINT to the whole process group) in a dry run exits 130; cms unchanged', async () => {
    const x = await interrupt({ mode: 'dry', sleepMs: 30_000, kill: (pid) => process.kill(-pid, 'SIGINT') });
    expect(x.code).toBe(130);
    expect(x.stderr).toContain('interrupted by SIGINT. npm run release:check failed (killed by SIGINT)');
    expect(x.reached).toBe('');
    expect(snapshot(x.r.root)).toEqual(x.before);
    expect(remote(x.r.origin)).toBe('');
  }, 30_000);

  it('Ctrl-C in a real run with --yes never reaches the bump, the publish or the GitHub release', async () => {
    const x = await interrupt({ mode: 'yes', sleepMs: 30_000, kill: (pid) => process.kill(-pid, 'SIGINT') });
    expect(x.code).toBe(130);
    expect(x.reached).toBe('');
    expect(remote(x.r.origin)).toBe('');
  }, 30_000);

  it('SIGTERM to the script alone stops at the next checkpoint (exit 143), before the prompt', async () => {
    const x = await interrupt({ mode: 'real', sleepMs: 1500, kill: (pid) => process.kill(pid, 'SIGTERM') });
    expect(x.code).toBe(143);
    expect(x.stderr).toContain('interrupted by SIGTERM. Interrupted by SIGTERM');
    expect(x.stdout).not.toContain('finished');
    expect(x.reached).toBe('');
    expect(snapshot(x.r.root)).toEqual(x.before);
    expect(remote(x.r.origin)).toBe('');
  }, 30_000);
});
