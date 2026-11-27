// The history reads of the dev API: one file (`GET /history`) and a batch (`POST /history`) with the same answers.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { FileEvent, FileHistory } from '../core/source';

const execFileAsync = promisify(execFile);

/** Pathspec syntax `git log -- <path>` reads as a pattern: such a path is asked on its own, as `GET` asks it. */
const GLOB = /[*?[]/;
/** `git log` processes of the per-path fallback that run at once. */
const PARALLEL = 8;
const MAX_BUFFER = 1 << 28;

const EVENT_FORMAT = '%an%x1f%aI%x1f%s';

const noHistory = (): FileHistory => ({ updated: null, created: null, commits: 0 });

function toEvent([name = '', date = '', message = '']: string[]): FileEvent {
  return { actor: { name }, date, message };
}

/** `git log` of one file: newest and oldest commit plus the count; empty when git is not usable. */
export async function fileHistory(root: string, path: string): Promise<FileHistory> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', root, 'log', `--format=${EVENT_FORMAT}`, '--', path], {
      maxBuffer: 1 << 24,
    });
    const events = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => toEvent(line.split('\x1f')));
    return { updated: events[0] ?? null, created: events.at(-1) ?? null, commits: events.length };
  } catch {
    // not a git checkout, or no git binary
    return noHistory();
  }
}

type Commit = {
  hash: string;
  parents: string[];
  /** Committer time: git walks the history newest first by it. */
  time: number;
  event: FileEvent;
  /** The paths this commit changes against its first parent: `<mode> <blob>` after it, `null` when it removes one. */
  changed: Map<string, string | null>;
};

function git(root: string, args: string[], input?: string): Promise<string> {
  const run = execFileAsync('git', ['-C', root, ...args], { maxBuffer: MAX_BUFFER });
  if (input !== undefined) {
    // A git that exits before it reads its input breaks the pipe; the promise already reports the failure.
    run.child.stdin?.on('error', () => {});
    run.child.stdin?.end(input);
  }
  return run.then((r) => r.stdout);
}

/** Every commit reachable from HEAD, children before parents (so HEAD is first), with what it changes in `paths`. */
async function readCommits(root: string, paths: string[]): Promise<Commit[]> {
  const out = await git(
    root,
    [
      '--literal-pathspecs',
      '-c',
      'log.showRoot=true',
      'log',
      // Every commit with its real parents; `walk` does git's history simplification, which differs per path.
      '--full-history',
      '--sparse',
      '--topo-order',
      '--diff-merges=first-parent',
      '--raw',
      '--no-abbrev',
      '--no-renames',
      '--relative',
      '--no-show-signature',
      '-z',
      `--format=%x01%H%x1f%P%x1f%ct%x1f${EVENT_FORMAT}`,
      '--stdin',
    ],
    // The paths go through stdin: 500 of them can be longer than a command line.
    ['HEAD', '--', ...paths, ''].join('\n'),
  );

  const commits: Commit[] = [];
  const tokens = out.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!.replace(/^\n+/, '');
    if (token.startsWith('\x01')) {
      const [hash = '', parents = '', time = '', ...event] = token.slice(1).split('\x1f');
      commits.push({
        hash,
        parents: parents.split(' ').filter(Boolean),
        time: Number(time),
        event: toEvent(event),
        changed: new Map(),
      });
    } else if (token.startsWith(':')) {
      // `:<old mode> <new mode> <old blob> <new blob> <status>`, then the path as its own token.
      const [, mode, , blob, status] = token.split(' ');
      commits.at(-1)?.changed.set(tokens[++i]!, status === 'D' ? null : `${mode} ${blob}`);
    }
  }
  return commits;
}

/**
 * What `git log -- <path>` lists, from the whole graph: newest first by committer time, a merge that has the file as
 * one of its parents has it follows only that parent (the first such), and a commit that leaves the file as it found
 * it is not listed.
 */
function walk(commits: Commit[], index: Map<string, number>, path: string): FileHistory {
  // The file in every commit: parents come after children, so from the end.
  const state: (string | null)[] = Array.from({ length: commits.length }, () => null);
  for (let i = commits.length - 1; i >= 0; i--) {
    const { changed, parents } = commits[i]!;
    const own = changed.get(path);
    state[i] = own !== undefined ? own : parents.length > 0 ? state[index.get(parents[0]!)!]! : null;
  }

  const history = noHistory();
  const queue = commits.length > 0 ? [0] : [];
  const seen = new Set(queue);
  while (queue.length > 0) {
    const i = queue.shift()!;
    const { parents, event } = commits[i]!;
    const before = parents.map((parent) => index.get(parent)!);
    const same = before.find((parent) => state[parent] === state[i]);
    if (before.length === 0 ? state[i] !== null : same === undefined) {
      history.updated ??= event;
      history.created = event;
      history.commits += 1;
    }
    for (const parent of same === undefined ? before : [same]) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      // Equal times keep the order they were met in.
      const at = queue.findIndex((queued) => commits[queued]!.time < commits[parent]!.time);
      queue.splice(at === -1 ? queue.length : at, 0, parent);
    }
  }
  return history;
}

async function onePerPath(root: string, paths: string[], into: Map<string, FileHistory>): Promise<void> {
  for (let i = 0; i < paths.length; i += PARALLEL) {
    const chunk = paths.slice(i, i + PARALLEL);
    const histories = await Promise.all(chunk.map((path) => fileHistory(root, path)));
    chunk.forEach((path, j) => into.set(path, histories[j]!));
  }
}

/**
 * `fileHistory` of many files (canonical paths without control characters) from one `git log` pass. A path that one
 * pass cannot answer the same way is asked on its own: a glob, a directory, or every path under `log.follow`.
 */
export async function fileHistories(root: string, paths: string[]): Promise<Map<string, FileHistory>> {
  const out = new Map(paths.map((path) => [path, noHistory()]));
  const wanted = new Set(out.keys());
  const alone = new Set([...wanted].filter((path) => GLOB.test(path)));
  try {
    // `log.follow` makes a one-file `git log` follow renames.
    const follow = await git(root, ['config', '--type=bool', '--default=false', '--get', 'log.follow']);
    if (follow.trim() === 'true') {
      await onePerPath(root, [...wanted], out);
      return out;
    }
    const batch = [...wanted].filter((path) => !alone.has(path));
    const commits = batch.length > 0 ? await readCommits(root, batch) : [];
    for (const { changed } of commits) {
      for (const file of changed.keys()) {
        // A change below a requested path: that path is (or was) a directory.
        for (let end = file.lastIndexOf('/'); end > 0; end = file.lastIndexOf('/', end - 1)) {
          if (wanted.has(file.slice(0, end))) alone.add(file.slice(0, end));
        }
      }
    }
    const index = new Map(commits.map((commit, i) => [commit.hash, i]));
    for (const path of batch) if (!alone.has(path)) out.set(path, walk(commits, index, path));
  } catch {
    // Without git or a commit every history is empty; if only the batch failed, ask path by path.
    const usable = await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).then(
      () => true,
      () => false,
    );
    if (usable) await onePerPath(root, [...wanted], out);
    return out;
  }
  await onePerPath(root, [...alone], out);
  return out;
}
