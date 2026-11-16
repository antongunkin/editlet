// `npm run release:copy [target]` (spec: P13 §10): exports `packages/editlet` into the local checkout of the public
// repo `antongunkin/editlet` (default: `editlet` next to the main cms checkout, also from a git worktree) as one
// commit `chore: sync editlet from antongunkin/cms@<sha>`, then runs `npm install --no-package-lock` and
// `npm run release:check` there. An export that is still unpushed (checked with `git ls-remote`) is amended. Nothing
// is pushed, and cms is never changed. `release.mjs` calls `copyPackage` itself as the first step of `npm run release`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
export const PUBLIC_REPO = 'antongunkin/editlet';
export const PUBLIC_BRANCH = 'main';
/**
 * Build outputs of the package (ignored there). The export deletes them in the target before the build, so a stale
 * file (a built script whose source is gone) can never ship. Every other ignored file of the target is kept.
 */
export const BUILD_OUTPUTS = ['dist/', 'admin/dist/', 'skills/*/scripts/*.mjs'];
/** `-unormal`: untracked files count as dirty even with `status.showUntrackedFiles=no`. */
export const STATUS = ['status', '--porcelain', '--untracked-files=normal'];
/** Settings `npm run` exports that must not leak into the npm/git commands run from here. */
const NPM_ENV_KEEP = new Set(['npm_config_registry', 'npm_config_cache', 'npm_config_userconfig']);
const EXPORT_SUBJECT = /^chore: sync editlet from antongunkin\/cms@([0-9a-f]{7,40})$/;

/**
 * @typedef {{ status: number, stdout: string, stderr: string, signal?: string | null }} RunResult
 *   `signal`: set when the command was killed by a signal (`status` is then 1).
 * @typedef {{ cwd?: string, capture?: boolean, env?: Record<string, string> }} RunOptions
 * @typedef {(command: string, args: string[], options?: RunOptions) => RunResult} Runner
 * @typedef {{ root: string, ref: string, unborn: boolean, head: string | null }} TargetState
 */

const PUBLIC_URL_HOST = [
  String.raw`https://(?:[^@/\s]+@)?github\.com/`,
  String.raw`ssh://git@github\.com(?::22)?/`,
  String.raw`git@github\.com:`,
].join('|');
const PUBLIC_URL = new RegExp(`^(?:${PUBLIC_URL_HOST})antongunkin/editlet(?:\\.git)?/?$`, 'i');

/** `https://github.com/antongunkin/editlet(.git)`, `git@github.com:…`, `ssh://git@github.com/…`; any case. */
export function isPublicRepoUrl(url) {
  return PUBLIC_URL.test(String(url ?? '').trim());
}

/** One line, no trailers. */
export function exportMessage(sourceSha) {
  return `chore: sync editlet from antongunkin/cms@${String(sourceSha).slice(0, 7)}`;
}

/** The short cms sha of an export commit subject, or null for any other subject. */
export function exportSource(subject) {
  return EXPORT_SUBJECT.exec(String(subject ?? '').trim())?.[1] ?? null;
}

/** `[target]`: the only argument of `release:copy`. */
export function parseExportArgs(argv) {
  const options = { target: undefined };
  for (const arg of argv) {
    if (arg.startsWith('-')) throw new Error(`Unknown argument: ${arg} (expected an optional target directory)`);
    if (options.target) throw new Error(`One target directory only, got ${options.target} and ${arg}`);
    options.target = arg;
  }
  return options;
}

/**
 * The environment for child commands: no `npm_*` settings of the `npm run` that started us (e.g. a dry run).
 * @param {Record<string, string | undefined>} [env]
 */
export function childEnv(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('npm_') || NPM_ENV_KEEP.has(key)));
}

/**
 * Runs one command; `capture` returns its output instead of streaming it. Never throws on a non-zero exit.
 * @type {Runner}
 */
export function defaultRunner(command, args, { cwd, capture = false, env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...childEnv(), ...env },
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    signal: result.signal ?? null,
  };
}

export function must(run, command, args, options, hint) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    const how = result.signal ? `killed by ${result.signal}` : `exit ${result.status}`;
    throw new Error(
      `${command} ${args.join(' ')} failed (${how})${hint ? `: ${hint}` : ''}${detail ? `\n${detail}` : ''}`,
    );
  }
  return result;
}

export const gitIn = (run, cwd) => (args, options) =>
  must(run, 'git', args, { cwd, capture: true, ...options }).stdout.trim();

/** The sha `rev` names in `cwd`, or null when it names nothing. */
export const revParse = (run, cwd, rev) => {
  const result = run('git', ['rev-parse', '--quiet', '--verify', `${rev}^{commit}`], { cwd, capture: true });
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * Target checks (§10), before any change: the root of a git repo whose `origin` fetch and push URLs are
 * github.com/antongunkin/editlet, on `main` (unborn is fine), clean including untracked files.
 * @param {{ target: string, run?: Runner }} options
 * @returns {TargetState}
 */
export function preflightTarget({ target, run = defaultRunner }) {
  const dir = resolve(target);
  if (!existsSync(dir)) {
    throw new Error(`Target ${dir} does not exist; clone it first: gh repo clone ${PUBLIC_REPO} ${dir}`);
  }
  const root = realpathSync(dir);
  const top = run('git', ['rev-parse', '--show-toplevel'], { cwd: root, capture: true });
  if (top.status !== 0 || top.stdout.trim() !== root) {
    throw new Error(`Target ${root} must be the root of a git checkout of ${PUBLIC_REPO}`);
  }
  for (const [label, args] of [
    ['origin', ['remote', 'get-url', 'origin']],
    ['the push URL of origin', ['remote', 'get-url', '--push', 'origin']],
  ]) {
    const url = run('git', args, { cwd: root, capture: true });
    if (url.status !== 0 || !isPublicRepoUrl(url.stdout)) {
      throw new Error(`Target ${root}: ${label} must be github.com/${PUBLIC_REPO}, got ${url.stdout.trim() || 'none'}`);
    }
  }
  const branch = run('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, capture: true });
  if (branch.status !== 0 || branch.stdout.trim() !== PUBLIC_BRANCH) {
    const unbornElsewhere = branch.status === 0 && !revParse(run, root, 'HEAD');
    throw new Error(
      `Target ${root} must be on ${PUBLIC_BRANCH}, not ${branch.stdout.trim() || 'a detached HEAD'}` +
        (unbornElsewhere
          ? ` (an empty clone with another default branch: run git symbolic-ref HEAD refs/heads/${PUBLIC_BRANCH} there)`
          : ''),
    );
  }
  const git = gitIn(run, root);
  const dirty = git(STATUS);
  if (dirty) throw new Error(`Target ${root} must be clean (the export replaces its tree):\n${dirty}`);
  const head = revParse(run, root, 'HEAD');
  return { root, ref: git(['symbolic-ref', '--quiet', 'HEAD']), unborn: head === null, head };
}

/**
 * True when `commit` in `root` is an untouched export: its subject names a cms commit and its tree is exactly what
 * the export makes of that commit (`exportTree`: `packages/editlet` without the `export-ignore` paths).
 */
function isExport(root, commit, { sourceRoot, packagePath, run }) {
  const git = gitIn(run, root);
  const short = exportSource(git(['log', '-1', '--format=%s', commit]));
  if (!short) return false;
  const source = revParse(run, sourceRoot, short);
  if (!source) return false;
  const tree = run('git', ['rev-parse', '--verify', `${source}:${packagePath}`], { cwd: sourceRoot, capture: true });
  if (tree.status !== 0) return false;
  return (
    exportTree({ root, sourceRoot, sourceSha: source, packagePath, run }) === git(['rev-parse', `${commit}^{tree}`])
  );
}

/**
 * Writes the export's tree of `sourceSha` into `root`'s object store and returns its sha: `git archive` of
 * `packages/editlet` (so `export-ignore` paths stay out), added to a throwaway index. The target's own index, working
 * tree and ignore rules are not involved (`--force` keeps files the package's .gitignore would skip).
 */
function exportTree({ root, sourceRoot, sourceSha, packagePath, run }) {
  const git = gitIn(run, root);
  const tmp = mkdtempSync(join(tmpdir(), 'editlet-export-'));
  try {
    const tree = join(tmp, 'tree');
    mkdirSync(tree);
    const tar = join(tmp, 'tree.tar');
    gitIn(run, sourceRoot)(['archive', '--format=tar', '-o', tar, `${sourceSha}:${packagePath}`]);
    must(run, 'tar', ['-xf', tar, '-C', tree], { cwd: tmp, capture: true });
    const index = { GIT_INDEX_FILE: join(tmp, 'index') };
    const gitDir = git(['rev-parse', '--absolute-git-dir']);
    git(['add', '--all', '--force', '.'], { cwd: tree, env: { ...index, GIT_DIR: gitDir, GIT_WORK_TREE: tree } });
    return git(['write-tree'], { env: index });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Where the export commit goes: on top of `main` as origin has it right now (`git ls-remote`, fetched when the commit
 * is not local yet), replacing an unpushed export when HEAD is one. A pushed commit is never amended. Anything else
 * on `main` that is not on origin stops the export.
 */
function exportBase(state, options) {
  if (state.unborn) return { parent: null, amend: false };
  const { root, head } = state;
  const { run } = options;
  const git = gitIn(run, root);
  const upstream = git(['ls-remote', '--heads', 'origin', `refs/heads/${PUBLIC_BRANCH}`]).split('\t')[0] || null;
  if (upstream && !revParse(run, root, upstream)) git(['fetch', '--quiet', 'origin', PUBLIC_BRANCH]);
  if (upstream && head === upstream) return { parent: head, amend: false };
  const parents = git(['rev-list', '--parents', '-n', '1', head]).split(' ').slice(1);
  const onTop = upstream ? parents.length === 1 && parents[0] === upstream : parents.length === 0;
  if (onTop && isExport(root, head, options)) return { parent: upstream, amend: true };
  throw new Error(
    `Target ${root}: ${PUBLIC_BRANCH} has commits that are not on origin/${PUBLIC_BRANCH} and are not one unpushed ` +
      `export. Inspect them; to drop them: git -C ${root} reset --keep ${upstream ?? '<commit>'}`,
  );
}

const isTracked = (root, path, run) =>
  must(run, 'git', ['ls-files', '--', path], { cwd: root, capture: true }).stdout.trim() !== '';

/** Deletes the untracked `BUILD_OUTPUTS` in `root`; returns what it deleted. */
export function removeBuildOutputs(root, run = defaultRunner) {
  const removed = [];
  for (const dir of ['dist', 'admin/dist']) {
    if (existsSync(join(root, dir)) && !isTracked(root, dir, run)) {
      rmSync(join(root, dir), { recursive: true, force: true });
      removed.push(`${dir}/`);
    }
  }
  const skills = join(root, 'skills');
  const skillNames = existsSync(skills) ? readdirSync(skills).toSorted() : [];
  for (const skill of skillNames) {
    const scripts = join(skills, skill, 'scripts');
    if (!existsSync(scripts)) continue;
    for (const name of readdirSync(scripts).toSorted()) {
      const path = `skills/${skill}/scripts/${name}`;
      if (name.endsWith('.mjs') && !isTracked(root, path, run)) {
        rmSync(join(root, path), { recursive: true, force: true });
        removed.push(path);
      }
    }
  }
  return removed;
}

/**
 * Replaces the target's tree with `git archive <ref>:<packagePath>` of `sourceRoot` as one commit on `main`
 * (amending an unpushed export). The commit is built in a temporary index (`commit-tree`: no hooks, so no trailers),
 * then checked out with `reset --keep` (or `read-tree -m -u` on an unborn branch), which refuses to overwrite local
 * edits. Tracked files gone from the package are deleted; the untracked `BUILD_OUTPUTS` are deleted too (rebuilt,
 * never stale); `.git`, `node_modules` and every other ignored file stay (they may be the user's: `.DS_Store`,
 * `.env`). It refuses to overwrite an ignored file at a path the export brings in.
 * @param {{ sourceRoot: string, target: string, run?: Runner, packagePath?: string, ref?: string }} options
 */
export function exportPackage({
  sourceRoot,
  target,
  run = defaultRunner,
  packagePath = 'packages/editlet',
  ref = 'HEAD',
}) {
  const state = preflightTarget({ target, run });
  const { root, unborn, head } = state;
  const base = exportBase(state, { sourceRoot, packagePath, run });
  const source = gitIn(run, sourceRoot);
  const sourceSha = source(['rev-parse', `${ref}^{commit}`]);
  const message = exportMessage(sourceSha);
  const git = gitIn(run, root);
  const treeSha = exportTree({ root, sourceRoot, sourceSha, packagePath, run });

  const same =
    !unborn &&
    treeSha === git(['rev-parse', `${head}^{tree}`]) &&
    (!base.amend || git(['log', '-1', '--format=%s', head]) === message);
  if (same) {
    return { root, commit: head, message, sourceSha, amended: false, changed: false, ...rebuild(root, run) };
  }
  const commit = git(['commit-tree', treeSha, ...(base.parent ? ['-p', base.parent] : []), '-m', message]);
  // Git treats ignored files as expendable on checkout; refuse instead of overwriting one the export brings in.
  const listTree = (rev) => git(['ls-tree', '-r', '-z', '--name-only', rev]).split('\0').filter(Boolean);
  const tracked = new Set(head ? listTree(head) : []);
  const clobbered = listTree(commit).filter((path) => !tracked.has(path) && existsSync(join(root, path)));
  if (clobbered.length > 0) {
    throw new Error(
      `Target ${root} has untracked (ignored) files where the export puts files:\n${clobbered.join('\n')}`,
    );
  }
  if (unborn) {
    git(['read-tree', '-m', '-u', commit]);
    git(['update-ref', state.ref, commit, '']);
  } else {
    git(['reset', '--quiet', '--keep', commit]);
  }
  return { root, commit, message, sourceSha, amended: base.amend, changed: true, ...rebuild(root, run) };
}

const rebuild = (root, run) => ({ buildOutputsRemoved: removeBuildOutputs(root, run) });

/** The git root of the package (a real path: `--show-toplevel` prints one, macOS /var → /private/var). */
export function sourceRootOf(packageDir = PACKAGE_DIR, run = defaultRunner) {
  return must(run, 'git', ['rev-parse', '--show-toplevel'], {
    cwd: realpathSync(packageDir),
    capture: true,
  }).stdout.trim();
}

export function packagePathIn(sourceRoot, packageDir = PACKAGE_DIR) {
  return relative(sourceRoot, realpathSync(packageDir)).split(sep).join('/');
}

/**
 * `editlet` next to the main checkout of the monorepo, also from a git worktree (whose root is elsewhere, e.g.
 * `.claude/worktrees/<name>`): the parent of the common git dir is the main checkout.
 */
export function defaultTarget(repoRoot, run = defaultRunner) {
  const common = must(run, 'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: repoRoot,
    capture: true,
  }).stdout.trim();
  return join(dirname(dirname(common)), 'editlet');
}

/**
 * `release:copy`: export, then `npm install --no-package-lock` and `npm run release:check` in the target. cms is
 * only read: `packages/editlet` must be clean there (the export takes HEAD, not the working tree).
 * @param {{ packageDir?: string, target?: string, run?: Runner, log?: (line: string) => void }} [options]
 */
export function copyPackage({
  packageDir = PACKAGE_DIR,
  target,
  run = defaultRunner,
  log = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const sourceRoot = sourceRootOf(packageDir, run);
  const packagePath = packagePathIn(sourceRoot, packageDir);
  const { root: targetRoot } = preflightTarget({ target: target ?? defaultTarget(sourceRoot, run), run });
  const dirty = gitIn(run, sourceRoot)([...STATUS, '--', packagePath]);
  if (dirty) throw new Error(`${packagePath} must be clean in ${sourceRoot} (the export takes HEAD):\n${dirty}`);
  const exported = exportPackage({ sourceRoot, target: targetRoot, run, packagePath });
  const { root } = exported;
  const what = !exported.changed ? 'unchanged' : exported.amended ? 'amended' : 'committed';
  log(`${root}: ${exported.commit.slice(0, 7)} ${exported.message} (${what}; nothing pushed)`);
  if (exported.buildOutputsRemoved.length > 0) {
    log(`deleted stale build outputs before the build: ${exported.buildOutputsRemoved.join(', ')}`);
  }
  must(run, 'npm', ['install', '--no-package-lock', '--no-audit', '--no-fund'], { cwd: root });
  must(run, 'npm', ['run', 'release:check'], { cwd: root });
  const left = gitIn(run, root)(STATUS);
  if (left) throw new Error(`npm install or release:check left changes in ${root}:\n${left}`);
  log(`release:check passed in ${root}`);
  return exported;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { target } = parseExportArgs(process.argv.slice(2));
    copyPackage({ target });
  } catch (error) {
    process.stderr.write(`release:copy: ${error.message}\n`);
    process.exitCode = 1;
  }
}
