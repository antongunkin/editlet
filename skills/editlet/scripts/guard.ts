import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { splitCommands } from './shell';

import { DEFAULT_BRANCH_PREFIX, resolveGitStyle } from '../../../core/gitStyle';
import { EditletError, type Issue } from '../../../core/issues';
import { DEFAULT_SCHEMA_PATH, loadProjectSchema } from '../../../node/fs';
import { validateProject } from '../../../node/project';

/**
 * PreToolUse guard for Bash. Best-effort and fails closed on internal errors. Known limits: the branch and CMS
 * project are resolved from the hook `cwd`, so `cd sub && git push` and `git -C other commit` are not followed.
 */
export interface GuardEnv {
  protectedBranches: string[];
  currentBranch: string | null;
  /** `git.branchPrefix` of the schema (default `editlet/`): content change sets live on `<prefix><name>` branches. */
  branchPrefix: string;
  /** Issue lines for the CMS files about to be committed; `null` when no CMS files changed. */
  validateCommit: () => string[] | null;
}

export interface Decision {
  decision: 'deny' | 'ask';
  reason: string;
}

const MAX_LINES = 20;
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix']);
const PUSH_WITH_VALUE = new Set(['-o', '--push-option', '--repo', '--receive-pack', '--exec']);
const KEYWORDS = new Set([
  'if',
  'while',
  'until',
  'then',
  'do',
  'else',
  'elif',
  '!',
  'time',
  'nohup',
  'command',
  'exec',
  'nice',
  'xargs',
]);
// Wrapper options that take a separate value.
const WRAPPER_VALUE_FLAGS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U'],
  nice: ['-n'],
  env: ['-u', '-C', '-S', '--unset', '--chdir'],
  xargs: ['-n', '-I', '-L', '-P', '-s', '-d', '-E'],
  timeout: ['-s', '-k'],
};

const deny = (reason: string): Decision => ({ decision: 'deny', reason });

function programOf(words: string[]): { program: string; args: string[] } | null {
  let i = 0;
  for (;;) {
    const raw = words[i];
    if (raw === undefined) return null;
    const word = raw.replace(/^[({]+/, '');
    if (word === '' || word === '}' || KEYWORDS.has(word) || word === 'sudo' || word === 'env' || word === 'timeout') {
      i++;
      if (word === '' || word === '}') continue;
      const valueFlags = WRAPPER_VALUE_FLAGS[word] ?? [];
      while (words[i]?.startsWith('-') || /^[A-Za-z_]\w*=/.test(words[i] ?? '')) {
        i += valueFlags.includes(words[i]!) ? 2 : 1;
      }
      if (word === 'timeout' && /^[\d.]+[smhd]?$/.test(words[i] ?? '')) i++;
    } else if (/^[A-Za-z_]\w*=/.test(word)) i++;
    else return { program: basename(word), args: words.slice(i + 1) };
  }
}

function formatIssue(issue: Issue): string {
  if (!issue.file) return `${issue.path || '(schema)'} — ${issue.message}`;
  return issue.path ? `${issue.file}: ${issue.path} — ${issue.message}` : `${issue.file} — ${issue.message}`;
}

function commitDecision(env: GuardEnv): Decision | null {
  const lines = env.validateCommit();
  if (!lines) return null;
  if (lines.length > 0) {
    const shown = lines.slice(0, MAX_LINES);
    if (lines.length > MAX_LINES) shown.push(`…and ${lines.length - MAX_LINES} more`);
    return deny(`Editlet content is invalid; fix these before committing:\n${shown.join('\n')}`);
  }
  const branch = env.currentBranch;
  // Content on a feature branch is usually a skill mistake; on the base branch (dev) the push check guards it.
  if (branch && !env.protectedBranches.includes(branch) && !branch.startsWith(env.branchPrefix)) {
    return {
      decision: 'ask',
      reason: `Editlet content change sets go to ${env.branchPrefix}<name> branches, and this commit is on ${branch}.`,
    };
  }
  return null;
}

function pushDecision(args: string[], env: GuardEnv): Decision | null {
  const positional: string[] = [];
  let hasRepo = false;
  let deleting = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--mirror' || arg === '--all') {
      return deny(
        `git push ${arg} is blocked by Editlet: it can overwrite protected branches. Push a ${env.branchPrefix}<name> branch.`,
      );
    }
    if (arg === '--delete' || arg === '-d') deleting = true;
    if (arg === '--repo' || arg.startsWith('--repo=')) hasRepo = true;
    if (PUSH_WITH_VALUE.has(arg)) i++;
    else if (!arg.startsWith('-')) positional.push(arg);
  }
  const refspecs = hasRepo ? positional : positional.slice(1);
  const targets = refspecs.length === 0 ? [env.currentBranch ?? ''] : refspecs.map((spec) => destination(spec, env));
  for (const target of targets) {
    const hit = target.includes('*')
      ? globMatches(target, env.protectedBranches)
      : env.protectedBranches.includes(target);
    if (hit) {
      const verb = deleting || refspecs.some((s) => s.startsWith(':')) ? 'Deleting' : 'Pushing to';
      return deny(
        `${verb} ${target} is blocked by Editlet: publish through a ${env.branchPrefix}<name> branch and a pull request.`,
      );
    }
  }
  return null;
}

function globMatches(pattern: string, branches: string[]): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return branches.some((branch) => re.test(branch));
}

function destination(spec: string, env: GuardEnv): string {
  const stripped = spec.replace(/^\+/, '');
  const colon = stripped.indexOf(':');
  const dest = (colon === -1 ? stripped : stripped.slice(colon + 1)).replace(/^(refs\/)?heads\//, '');
  return dest === 'HEAD' ? (env.currentBranch ?? '') : dest;
}

function gitDecision(args: string[], env: GuardEnv): Decision | null {
  let i = 0;
  while (i < args.length && args[i]!.startsWith('-')) i += GIT_GLOBAL_WITH_VALUE.has(args[i]!) ? 2 : 1;
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (sub === 'push') return pushDecision(rest, env);
  if (sub === 'commit') return commitDecision(env);
  return null;
}

const GH_GLOBAL_WITH_VALUE = new Set(['-R', '--repo', '--hostname']);
const GH_BODY_FLAGS = new Set(['-f', '-F', '--field', '--raw-field', '--input']);

function ghDecision(all: string[]): Decision | null {
  let i = 0;
  while (i < all.length && all[i]!.startsWith('-')) i += GH_GLOBAL_WITH_VALUE.has(all[i]!) ? 2 : 1;
  const args = all.slice(i);
  const [group, action] = args;
  if (group === 'pr' && action === 'merge') {
    if (args.some((a) => a === '--admin' || (a.startsWith('--admin=') && a !== '--admin=false'))) {
      return deny('gh pr merge --admin bypasses branch protection and is blocked by Editlet.');
    }
    return {
      decision: 'ask',
      reason: 'Merging publishes the change. Merge only after the human explicitly approved this PR in chat.',
    };
  }
  if (group === 'api') {
    let method: string | null = null;
    let body = false;
    for (let j = 1; j < args.length; j++) {
      const arg = args[j]!;
      if (arg === '-X' || arg === '--method') method = args[++j] ?? method;
      else if (arg.startsWith('--method=')) method = arg.slice('--method='.length);
      else if (/^-X./.test(arg)) method = arg.slice(2);
      else if (GH_BODY_FLAGS.has(arg) || /^(-f|-F).|^--(field|raw-field|input)=/.test(arg)) body = true;
    }
    // gh api defaults to POST when a request body is given.
    const effective = (method ?? (body ? 'POST' : 'GET')).toUpperCase();
    if (effective !== 'GET' && args.slice(1).some((a) => a.includes('/protection'))) {
      return deny('Changing branch protection through gh api is blocked by Editlet.');
    }
  }
  return null;
}

/** Decides whether a Bash command may run. `null` means no opinion (normal permissions apply). */
export function decide(command: string, env: GuardEnv): Decision | null {
  let ask: Decision | null = null;
  for (const words of splitCommands(command)) {
    const parsed = programOf(words);
    if (!parsed) continue;
    const result =
      parsed.program === 'git'
        ? gitDecision(parsed.args, env)
        : parsed.program === 'gh'
          ? ghDecision(parsed.args)
          : null;
    if (result?.decision === 'deny') return result;
    ask ??= result;
  }
  return ask;
}

function gitRaw(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

const git = (cwd: string, ...args: string[]): string | null => gitRaw(cwd, args)?.trim() ?? null;

/** The directory holding `cms/schema.json`: `cwd` or the nearest parent up to the git toplevel. */
function findProjectRoot(cwd: string): string | null {
  const top = git(cwd, 'rev-parse', '--show-toplevel');
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, DEFAULT_SCHEMA_PATH))) return dir;
    if ((top && dir === resolve(top)) || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

async function resolveEnv(cwd: string, command: string): Promise<GuardEnv> {
  const root = findProjectRoot(cwd);
  const protectedBranches = new Set(['main', 'master']);
  let contentDir: string | null = null;
  let branchPrefix = DEFAULT_BRANCH_PREFIX;
  if (root) {
    try {
      const schema = await loadProjectSchema(root, DEFAULT_SCHEMA_PATH);
      protectedBranches.add(schema.git.baseBranch);
      contentDir = schema.contentDir;
      branchPrefix = resolveGitStyle(schema.git).branchPrefix;
    } catch {
      // Broken schema: protect main/master only; the commit check reports the schema issue.
    }
  }
  // Validation is async but `GuardEnv.validateCommit` is sync, so run it up front (only when a commit is possible).
  const commitLines = root && /\bcommit\b/.test(command) ? await commitIssues(root, contentDir) : null;
  const branch = git(cwd, 'rev-parse', '--abbrev-ref', 'HEAD');
  return {
    protectedBranches: [...protectedBranches],
    currentBranch: branch && branch !== 'HEAD' ? branch : null,
    branchPrefix,
    validateCommit: () => commitLines,
  };
}

async function commitIssues(root: string, contentDir: string | null): Promise<string[] | null> {
  const status = gitRaw(root, ['status', '--porcelain', '--untracked-files=all', '--', '.']);
  if (status === null) return null;
  const prefix = git(root, 'rev-parse', '--show-prefix') ?? '';
  const paths = status
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => line.slice(3).split(' -> '))
    .map((p) => p.replace(/^"|"$/g, ''))
    .map((p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p));
  const touches = paths.some(
    (p) => p === DEFAULT_SCHEMA_PATH || (contentDir !== null && p.startsWith(`${contentDir.replace(/\/$/, '')}/`)),
  );
  if (!touches) return null;
  try {
    return (await validateProject(root)).map(formatIssue);
  } catch (error) {
    if (error instanceof EditletError) return error.issues.map(formatIssue);
    throw error;
  }
}

function emit(d: Decision): void {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: d.decision,
        permissionDecisionReason: d.reason,
      },
    })}\n`,
  );
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
  let input: { tool_name?: unknown; tool_input?: { command?: unknown }; cwd?: unknown };
  try {
    input = JSON.parse(await readStdin());
    if (typeof input !== 'object' || input === null) throw new Error('not an object');
  } catch {
    return emit(deny('Editlet guard could not read the hook input'));
  }
  if (input.tool_name !== 'Bash') return;
  const command = input.tool_input?.command;
  if (typeof command !== 'string') return emit(deny('Editlet guard could not read the hook input'));
  const cwd = typeof input.cwd === 'string' ? input.cwd : process.cwd();
  try {
    const decision = decide(command, await resolveEnv(cwd, command));
    if (decision) emit(decision);
  } catch (error) {
    emit(deny(`Editlet guard failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}

if (/^guard\.(ts|mjs)$/.test(basename(process.argv[1] ?? ''))) await main();
