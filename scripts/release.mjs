// Release commands of `editlet` (spec: P13 §10), the same setup as ~/apps/ui. All of them work in the local checkout
// of the public repo `antongunkin/editlet` (default: `editlet` next to the main cms checkout; a path argument
// overrides it). cms is never changed: no commit, tag or push there.
//
//   npm run release:copy              export-repo.mjs: export + npm install + release:check, nothing pushed
//   npm run release:bump              release.mjs bump: npm version, commit, tag v<v>, push --atomic --follow-tags
//   npm run release:publish           release.mjs publish: npm publish --tag latest
//   npm run release [-- --dry-run]    release.mjs: copy → version → npm check → [y/N] → bump → publish → gh release
//
// Versions come from the public repo's tags: the highest v<x.y.z>-alpha.<N> with N + 1, or the version in
// package.json when there is no tag yet (0.1.0-alpha.0). Flags: --dry-run, --yes (release only), --version
// x.y.z-alpha.N (release and bump).
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

import {
  copyPackage,
  defaultRunner,
  defaultTarget,
  exportSource,
  gitIn,
  must,
  PUBLIC_BRANCH,
  PUBLIC_REPO,
  preflightTarget,
  revParse,
  sourceRootOf,
} from './export-repo.mjs';

export { defaultRunner };

const PACKAGE_DIR = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const PACKAGE = 'editlet';
/** The prerelease id of every version (`0.1.0-alpha.N`). */
const PRERELEASE = 'alpha';
/** The npm dist-tag of every release: `latest`, as in uiify, so `npm install editlet` gets the newest alpha. */
const DIST_TAG = 'latest';
/** No leading zeros (semver): `0.1.0-alpha.01` and `01.0.0-alpha.0` are not versions. */
const ALPHA = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/;

/**
 * @typedef {import('./export-repo.mjs').Runner} Runner
 * @typedef {(line: string) => void} Log
 * @typedef {{ command: string, args: string[], cwd: string }} Step
 */

/** `[0, 1, 0, 2]` for `0.1.0-alpha.2`, null for anything that is not `x.y.z-alpha.N`. */
export function parseAlpha(version) {
  const match = ALPHA.exec(String(version ?? ''));
  return match ? match.slice(1).map(Number) : null;
}

export const isAlphaVersion = (version) => parseAlpha(version) !== null;

function compareAlpha(left, right) {
  for (let i = 0; i < 4; i += 1) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** The highest `v<x.y.z>-alpha.<N>` among `tags` (without the `v`), or null when there is none. */
export function highestAlphaTag(tags) {
  let best = null;
  for (const tag of tags) {
    const version = tag.startsWith('v') ? parseAlpha(tag.slice(1)) : null;
    if (version && (!best || compareAlpha(version, best) > 0)) best = version;
  }
  return best && `${best[0]}.${best[1]}.${best[2]}-alpha.${best[3]}`;
}

/**
 * The release version: `requested` (must be `x.y.z-alpha.N` above the highest tag), else the highest tag with
 * N + 1, else `fallback` (the version in package.json, for the first release).
 */
export function releaseVersion(tags, { requested, fallback } = {}) {
  const highest = highestAlphaTag(tags);
  if (requested !== undefined) {
    const version = parseAlpha(requested);
    if (!version) throw new Error(`--version must look like 0.1.0-${PRERELEASE}.1, got ${requested}`);
    if (highest && compareAlpha(version, parseAlpha(highest)) <= 0) {
      throw new Error(`--version ${requested} must be above the last tag v${highest}`);
    }
    return requested;
  }
  if (highest) {
    const [major, minor, patch, n] = parseAlpha(highest);
    return `${major}.${minor}.${patch}-${PRERELEASE}.${n + 1}`;
  }
  if (!isAlphaVersion(fallback)) {
    throw new Error(`No v*-${PRERELEASE}.N tag yet, and package.json has ${fallback}, not x.y.z-${PRERELEASE}.N`);
  }
  return fallback;
}

/** The major version number (`1` for `1.0.0-alpha.0`). */
export function majorOf(version) {
  return Number(String(version).split('.')[0]);
}

/** `npm view editlet@<v> version`: exit 0 → taken, E404 → free, anything else → error (stop). */
export function classifyNpmView({ status, stderr = '' }) {
  if (status === 0) return 'taken';
  if (/\bE404\b/.test(stderr)) return 'free';
  return 'error';
}

function assertFreeOnNpm(run, version, cwd) {
  const spec = `${PACKAGE}@${version}`;
  const view = run('npm', ['view', spec, 'version'], { cwd, capture: true });
  const state = classifyNpmView(view);
  if (state === 'taken') throw new Error(`${spec} is already on npm; choose another version (--version)`);
  if (state === 'error') throw new Error(`Could not check npm for ${spec}:\n${(view.stderr || view.stdout).trim()}`);
}

/**
 * `[bump|publish] [target] [--dry-run] [--yes] [--version x.y.z-alpha.N]`. No command = the full release.
 * `npm run release --dry-run` (no `--`) sets npm_config_dry_run, which counts as `--dry-run` too.
 */
export function parseReleaseArgs(argv, env = {}) {
  const args = [...argv];
  const command = args[0] === 'bump' || args[0] === 'publish' ? args.shift() : 'release';
  const options = {
    command,
    target: undefined,
    version: undefined,
    yes: false,
    dryRun: env.npm_config_dry_run === 'true',
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--yes' && command === 'release') options.yes = true;
    else if (arg === '--version' && command !== 'publish') {
      const value = args[i + 1];
      if (!value || value.startsWith('-'))
        throw new Error(`--version needs a value, e.g. --version 0.1.0-${PRERELEASE}.1`);
      options.version = value;
      i += 1;
    } else if (arg.startsWith('-')) throw new Error(`Unknown argument for ${command}: ${arg}`);
    else if (options.target) throw new Error(`One target directory only, got ${options.target} and ${arg}`);
    else options.target = arg;
  }
  return options;
}

export function isYes(answer) {
  return /^y$/i.test(String(answer ?? '').trim());
}

/**
 * Asks `[y/N]`. A closed input, Ctrl-C in the prompt, or an aborted `signal` answers '' (= N).
 * @param {string} question
 * @param {{ input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream, signal?: AbortSignal }} [options]
 * @returns {Promise<string>}
 */
export function defaultPrompt(question, { input = process.stdin, output = process.stdout, signal } = {}) {
  const rl = createInterface({ input, output });
  const { promise, resolve: answer } = Promise.withResolvers();
  const no = () => {
    answer('');
    rl.close();
  };
  rl.on('close', () => answer(''));
  rl.on('SIGINT', no);
  if (signal?.aborted) no();
  signal?.addEventListener('abort', no, { once: true });
  rl.question(`${question} [y/N] `).then(answer, () => answer(''));
  return promise.finally(() => {
    signal?.removeEventListener('abort', no);
    rl.close();
  });
}

function quote(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** @param {Step} step */
export function formatCommand({ command, args, cwd }) {
  return `(cd ${quote(cwd)} && ${[command, ...args].map(quote).join(' ')})`;
}

/**
 * Keeps SIGINT/SIGTERM from killing the process mid-step: records the first signal instead. A child killed by the
 * same Ctrl-C fails its step; `checkpoint()` turns a signal that arrived meanwhile into an error at a safe point, so
 * a signal before the prompt can never reach an outward step.
 * @param {NodeJS.EventEmitter} [target]
 */
export function interruptGuard(target = process) {
  let signal = null;
  const { promise: interrupted, resolve: wake } = Promise.withResolvers();
  const note = (name) => {
    if (signal) return;
    signal = name;
    wake(name);
  };
  const onInt = () => note('SIGINT');
  const onTerm = () => note('SIGTERM');
  target.on('SIGINT', onInt);
  target.on('SIGTERM', onTerm);
  return {
    get signal() {
      return signal;
    },
    /** Resolves with the signal name once one arrives. */
    interrupted,
    /** `run` that also notes a child killed by SIGINT/SIGTERM. */
    wrap(run) {
      return (command, args, options) => {
        const result = run(command, args, options);
        if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') note(result.signal);
        return result;
      };
    },
    /** Lets pending signal events run, then throws when one arrived. */
    async checkpoint() {
      await new Promise((done) => setImmediate(done));
      if (signal) throw new Error(`Interrupted by ${signal}`);
    },
    dispose() {
      target.off('SIGINT', onInt);
      target.off('SIGTERM', onTerm);
    },
  };
}

/** Exit code for a run that ended because of a signal (128 + 2 for SIGINT, 128 + 15 for SIGTERM). */
export const signalExitCode = (signal) => (signal === 'SIGTERM' ? 143 : 130);

function readManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== PACKAGE) throw new Error(`Expected package ${PACKAGE} in ${root}, found ${manifest.name}`);
  return manifest;
}

/** Tag names on origin (`ls-remote --tags --refs`). */
function remoteTags(run, root) {
  return gitIn(
    run,
    root,
  )(['ls-remote', '--tags', '--refs', 'origin'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t')[1].replace(/^refs\/tags\//, ''));
}

/** The sha of `main` on origin, or '' when the remote has none yet (an empty repo). */
const remoteMain = (run, root) =>
  gitIn(run, root)(['ls-remote', '--heads', 'origin', `refs/heads/${PUBLIC_BRANCH}`]).split('\t')[0] ?? '';

/** @returns {Step[]} what `bumpRelease` runs after its checks */
export function bumpSteps(root, version) {
  const tag = `v${version}`;
  return [
    { command: 'npm', args: ['version', version, '--no-git-tag-version', '--allow-same-version'], cwd: root },
    { command: 'git', args: ['add', '--', 'package.json'], cwd: root },
    { command: 'git', args: ['commit', '--quiet', '--allow-empty', '-m', `chore(release): ${version}`], cwd: root },
    { command: 'git', args: ['tag', '-a', tag, '-m', tag], cwd: root },
    { command: 'git', args: ['push', '--atomic', 'origin', PUBLIC_BRANCH, '--follow-tags'], cwd: root },
  ];
}

/** @returns {Step} */
export const publishStep = (root) => ({ command: 'npm', args: ['publish', '--tag', DIST_TAG], cwd: root });

/** @returns {Step} */
export const ghReleaseStep = (root, version) => ({
  command: 'gh',
  args: [
    'release',
    'create',
    `v${version}`,
    '--repo',
    PUBLIC_REPO,
    '--verify-tag',
    '--prerelease',
    '--title',
    version,
    '--generate-notes',
  ],
  cwd: root,
});

/**
 * The checks of `release:bump` (§10), read-only except a fetch: the target preflight, HEAD exactly one export commit
 * ahead of `origin/main` (for an empty remote: the single root commit), 0 behind, the version from the tags (or
 * `version`), its tag absent locally and on origin, HEAD untagged, the version free on npm.
 * @param {{ target: string, version?: string, run?: Runner }} options
 */
export function checkBump({ target, version: requested, run = defaultRunner }) {
  const { root, unborn, head } = preflightTarget({ target, run });
  if (unborn) throw new Error(`Target ${root} has no commit yet; run npm run release:copy first`);
  const git = gitIn(run, root);
  const manifest = readManifest(root);
  const upstream = remoteMain(run, root);
  if (upstream) {
    git(['fetch', '--quiet', '--tags', 'origin', PUBLIC_BRANCH]);
    const behind = git(['rev-list', '--count', `${head}..${upstream}`]);
    if (behind !== '0') {
      throw new Error(
        `Target ${root}: ${PUBLIC_BRANCH} is ${behind} behind origin/${PUBLIC_BRANCH} (released elsewhere?); ` +
          `reset it to origin/${PUBLIC_BRANCH} (git -C ${root} reset --keep origin/${PUBLIC_BRANCH}) and run ` +
          'npm run release:copy again',
      );
    }
    const ahead = git(['rev-list', '--count', `${upstream}..${head}`]);
    if (ahead !== '1') {
      throw new Error(
        `Target ${root}: expected exactly one local export commit ahead of origin/${PUBLIC_BRANCH}, found ${ahead}; ` +
          'run npm run release:copy',
      );
    }
  } else {
    git(['fetch', '--quiet', '--tags', 'origin']);
    const count = git(['rev-list', '--count', head]);
    if (count !== '1') {
      throw new Error(
        `Target ${root}: origin has no ${PUBLIC_BRANCH} yet, so ${PUBLIC_BRANCH} must be the single export commit, ` +
          `found ${count} commits`,
      );
    }
  }
  const subject = git(['log', '-1', '--format=%s', head]);
  if (!exportSource(subject)) {
    throw new Error(`Target ${root}: HEAD is not an export commit (${subject}); run npm run release:copy`);
  }
  const onOrigin = remoteTags(run, root);
  const local = git(['tag', '--list', 'v*']).split('\n').filter(Boolean);
  const tags = [...new Set([...local, ...onOrigin])];
  const highest = highestAlphaTag(tags);
  const version = releaseVersion(tags, { requested, fallback: manifest.version });
  const tag = `v${version}`;
  if (local.includes(tag)) throw new Error(`Git tag ${tag} already exists in ${root}`);
  if (onOrigin.includes(tag)) throw new Error(`Git tag ${tag} already exists on origin (${PUBLIC_REPO})`);
  const tagged = git(['tag', '--points-at', head]);
  if (tagged) throw new Error(`HEAD of ${root} is already tagged (${tagged}); finish that release first`);
  assertFreeOnNpm(run, version, root);
  return { root, head, version, tag, highest, previous: highest ?? manifest.version };
}

/** The loud line for a major version change (`0.x` → `1.0.0`), or null. */
export function majorWarning(from, to) {
  if (!from || majorOf(from) === majorOf(to)) return null;
  return `!! MAJOR VERSION CHANGE: ${from} → ${to}. Stay on 0.x while in alpha unless that is the plan.`;
}

/**
 * `release:bump` (§10): the checks, then `npm version <v> --no-git-tag-version`, commit `chore(release): <v>`,
 * annotated tag `v<v>`, `git push --atomic origin main --follow-tags`. When a step before the push (or the push
 * itself) fails, its own commit and tag are undone, so the target is back to the one export commit.
 * @param {{ target: string, version?: string, run?: Runner, log?: Log, dryRun?: boolean,
 *   beforePush?: () => Promise<void> }} options
 */
export async function bumpRelease({
  target,
  version: requested,
  run = defaultRunner,
  log = (line) => process.stdout.write(`${line}\n`),
  dryRun = false,
  beforePush = async () => {},
  next,
}) {
  const checked = checkBump({ target, version: requested, run });
  const { root, head, version, tag, previous } = checked;
  const warning = majorWarning(previous, version);
  if (warning) log(warning);
  const steps = bumpSteps(root, version);
  if (dryRun) {
    log(`dry run: release:bump would run`);
    for (const step of steps) log(`  ${formatCommand(step)}`);
    return { ...checked, status: 'dry-run' };
  }
  const git = gitIn(run, root);
  const undo = () => {
    const failed = [];
    const step = (args) => {
      const result = run('git', args, { cwd: root, capture: true });
      if (result.status !== 0) failed.push(`git ${args.join(' ')}: ${(result.stderr || result.stdout).trim()}`);
    };
    if (git(['tag', '--list', tag])) step(['tag', '-d', tag]);
    if (revParse(run, root, 'HEAD') !== head) step(['reset', '--quiet', '--keep', head]);
    else step(['checkout', head, '--', 'package.json']);
    return failed.length === 0
      ? `${root} is back to the export commit ${head.slice(0, 7)}`
      : `!! could not undo the bump in ${root} (${failed.join('; ')}); run: git -C ${root} tag -d ${tag}; ` +
          `git -C ${root} reset --keep ${head}`;
  };
  const [push] = steps.splice(-1);
  let unknown = false;
  try {
    for (const { command, args, cwd } of steps) must(run, command, args, { cwd, capture: true });
    log(`committed chore(release): ${version} and tagged ${tag} in ${root}`);
    await beforePush();
    log(`$ ${formatCommand(push)}`);
    const pushed = run(push.command, push.args, { cwd: root });
    if (pushed.status !== 0) {
      // --atomic: all or nothing. Only a push the remote did take (a lost reply) leaves origin at our commit.
      const releaseCommit = git(['rev-parse', 'HEAD']);
      let onOrigin;
      try {
        onOrigin = remoteMain(run, root);
      } catch (error) {
        unknown = true;
        const finish = next ?? [publishStep(root)];
        throw new Error(
          [
            `git push failed (exit ${pushed.status}) and origin could not be checked (${error.message.split('\n')[0]}).`,
            `Push outcome unknown; check git -C ${root} ls-remote origin. The local commit and ${tag} are kept.`,
            `If origin has ${PUBLIC_BRANCH} at ${releaseCommit.slice(0, 7)} and ${tag}, the push went through; finish with:`,
            ...finish.map((step) => `  ${formatCommand(step)}`),
            `Otherwise undo with: git -C ${root} tag -d ${tag} && git -C ${root} reset --keep ${head}`,
          ].join('\n'),
          { cause: error },
        );
      }
      if (onOrigin === releaseCommit) {
        log(`git push reported a failure, but origin/${PUBLIC_BRANCH} has the release commit; going on`);
      } else {
        throw new Error(`git push failed (exit ${pushed.status}); nothing was pushed`);
      }
    }
  } catch (error) {
    if (!unknown) error.message = `${error.message}\n${undo()}`;
    throw error;
  }
  log(`pushed ${PUBLIC_BRANCH} and ${tag} to ${PUBLIC_REPO}`);
  return { ...checked, status: 'bumped' };
}

/**
 * `release:publish` (§10): `npm publish --tag latest` in the target (`prepublishOnly` runs `release:check`). Checks
 * first: the target preflight, an `x.y.z-alpha.N` version whose tag `v<v>` is on HEAD and on origin, free on npm.
 * @param {{ target: string, run?: Runner, log?: Log, dryRun?: boolean }} options
 */
export function publishRelease({
  target,
  run = defaultRunner,
  log = (line) => process.stdout.write(`${line}\n`),
  dryRun = false,
}) {
  const { root, unborn, head } = preflightTarget({ target, run });
  if (unborn) throw new Error(`Target ${root} has no commit yet; run npm run release:copy and release:bump first`);
  const { version } = readManifest(root);
  if (!isAlphaVersion(version))
    throw new Error(`${PACKAGE} version must look like x.y.z-${PRERELEASE}.N, got ${version}`);
  const tag = `v${version}`;
  const git = gitIn(run, root);
  if (!git(['tag', '--points-at', head]).split('\n').includes(tag)) {
    throw new Error(`HEAD of ${root} is not tagged ${tag}; run npm run release:bump first`);
  }
  if (!remoteTags(run, root).includes(tag)) throw new Error(`${tag} is not on origin yet; run npm run release:bump`);
  assertFreeOnNpm(run, version, root);
  const step = publishStep(root);
  if (dryRun) {
    log(`dry run: release:publish would run\n  ${formatCommand(step)}`);
    return { root, version, tag, status: 'dry-run' };
  }
  log(`$ ${formatCommand(step)}`);
  must(run, step.command, step.args, { cwd: root });
  log(`published ${PACKAGE}@${version} with --tag ${DIST_TAG}`);
  return { root, version, tag, status: 'published' };
}

/**
 * `npm run release` (§10): `release:copy` → version → npm check → `[y/N]` → bump → publish → GitHub prerelease.
 * `dryRun` stops before the prompt and prints the commands; `yes` skips the prompt. A stop or a failure before the
 * push leaves the export commit local in the target (the next `release:copy` amends it). SIGINT/SIGTERM before the
 * prompt end the run with exit code 130/143 and never reach an outward step.
 * @param {{ dryRun?: boolean, yes?: boolean, version?: string, target?: string, packageDir?: string, run?: Runner,
 *   prompt?: (question: string, options?: { signal?: AbortSignal }) => Promise<string>, log?: Log,
 *   signals?: NodeJS.EventEmitter }} [options]
 */
export async function release(options = {}) {
  const guard = interruptGuard(options.signals ?? process);
  try {
    const result = await releaseSteps({ ...options, guard });
    return { ...result, interrupted: guard.signal };
  } catch (error) {
    if (guard.signal) {
      error.exitCode = signalExitCode(guard.signal);
      error.message = `interrupted by ${guard.signal}. ${error.message}`;
    }
    throw error;
  } finally {
    guard.dispose();
  }
}

async function releaseSteps({
  dryRun = false,
  yes = false,
  version: requested,
  target,
  packageDir = PACKAGE_DIR,
  run = defaultRunner,
  prompt = defaultPrompt,
  log = (line) => process.stdout.write(`${line}\n`),
  guard,
}) {
  run = guard.wrap(run);
  const checkpoint = () => guard.checkpoint();
  const sourceRoot = sourceRootOf(packageDir, run);
  target ??= defaultTarget(sourceRoot, run);
  log(`${dryRun ? 'dry run: ' : ''}release ${PACKAGE} through ${target}; cms is not changed`);

  // 1. release:copy. Then the version and the bump checks, read-only (a fetch at most).
  const { root } = copyPackage({ packageDir, target, run, log });
  await checkpoint();
  const { version, highest, previous } = checkBump({ target: root, version: requested, run });
  log(`version ${version} (${highest ? `last tag v${highest}` : 'no tag yet: package.json'}), free on npm`);
  const warning = majorWarning(previous, version);
  if (warning) log(warning);
  if (!dryRun) {
    must(run, 'npm', ['whoami'], { cwd: root, capture: true }, 'log in to npm first (npm login)');
    must(run, 'gh', ['auth', 'status'], { cwd: root, capture: true }, 'log in with gh auth login first');
  }
  await checkpoint();
  const gh = ghReleaseStep(root, version);
  const outward = [...bumpSteps(root, version), publishStep(root), gh];
  const keep = `The export commit stays local in ${root}; the next npm run release:copy amends it.`;

  // 2. Dry run ends here.
  if (dryRun) {
    log('dry run: would run');
    for (const step of outward) log(`  ${formatCommand(step)}`);
    log(`dry run: nothing was pushed or published. ${keep}`);
    return { status: 'dry-run', version, target: root };
  }

  // 3. The stop.
  if (warning) log(warning);
  const question = `Tag v${version}, push it to ${PUBLIC_REPO}, publish ${PACKAGE}@${version} to npm with --tag ${DIST_TAG} and create a GitHub prerelease?`;
  const abort = new AbortController();
  guard.interrupted.then(() => abort.abort());
  const answer = yes ? 'y' : await prompt(question, { signal: abort.signal });
  if (!isYes(answer) || guard.signal) {
    log(`Stopped before any outward step. ${keep}`);
    return { status: 'stopped', version, target: root };
  }
  await checkpoint();

  // 4. Outward: bump (commit, tag, push) → npm publish → GitHub prerelease.
  await bumpRelease({ target: root, version, run, log, beforePush: checkpoint, next: [publishStep(root), gh] });
  const finish = (steps, error) =>
    new Error(
      [
        error.message,
        `Pushed v${version} to ${PUBLIC_REPO}. Finish by hand with:`,
        ...steps.map((step) => `  ${formatCommand(step)}`),
      ].join('\n'),
    );
  // A Ctrl-C during or after the push stops here: the rest is printed, not run.
  try {
    await checkpoint();
    publishRelease({ target: root, run, log });
  } catch (error) {
    throw finish([publishStep(root), gh], error);
  }
  try {
    await checkpoint();
    log(`$ ${formatCommand(gh)}`);
    must(run, gh.command, gh.args, { cwd: root });
  } catch (error) {
    throw finish([gh], error);
  }
  log(`Released ${PACKAGE}@${version} (v${version})`);
  return { status: 'released', version, target: root };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let options;
  try {
    options = parseReleaseArgs(process.argv.slice(2), process.env);
  } catch (error) {
    process.stderr.write(`release: ${error.message}\n`);
    process.exit(2);
  }
  const { command, target, version, yes, dryRun } = options;
  const name = command === 'release' ? 'release' : `release:${command}`;
  try {
    if (command === 'release') {
      const result = await release({ dryRun, yes, version, target });
      if (result.interrupted) process.exitCode = signalExitCode(result.interrupted);
    } else {
      const guard = interruptGuard();
      try {
        const run = guard.wrap(defaultRunner);
        const dir = target ?? defaultTarget(sourceRootOf(PACKAGE_DIR, run), run);
        if (command === 'bump')
          await bumpRelease({ target: dir, version, run, dryRun, beforePush: () => guard.checkpoint() });
        else publishRelease({ target: dir, run, dryRun });
      } catch (error) {
        if (guard.signal) error.exitCode = signalExitCode(guard.signal);
        throw error;
      } finally {
        guard.dispose();
      }
    }
  } catch (error) {
    process.stderr.write(`${name}: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  }
}
