// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { decide, type GuardEnv } from './guard.ts';
import { splitCommands } from './shell.ts';

const repo = join(import.meta.dirname, '../../../../..');
const site = join(import.meta.dirname, '../../../node/__fixtures__/site');
const jiti = join(repo, 'node_modules/.bin/jiti');

const env = (over: Partial<GuardEnv> = {}): GuardEnv => ({
  protectedBranches: ['main', 'master'],
  currentBranch: 'editlet/x',
  branchPrefix: 'editlet/',
  validateCommit: () => null,
  ...over,
});

describe('splitCommands', () => {
  it('splits on operators and respects quotes', () => {
    expect(splitCommands('a b && c "d && e" || f; g | h\ni \'j;k\' & l')).toEqual([
      ['a', 'b'],
      ['c', 'd && e'],
      ['f'],
      ['g'],
      ['h'],
      ['i', 'j;k'],
      ['l'],
    ]);
  });

  it('keeps redirections and escapes in one token', () => {
    expect(splitCommands('make 2>&1 a\\ b')).toEqual([['make', '2>&1', 'a b']]);
  });
});

describe('decide', () => {
  it.each([
    'git push origin main',
    'git push origin HEAD:main',
    'git push origin editlet/x:refs/heads/main',
    'git -C . push origin main',
    'git -c core.x=1 --no-pager push origin +main',
    'git push --mirror',
    'git push --all',
    'git push origin --delete main',
    'git push origin :main',
    'git push --force origin master',
    'FOO=1 sudo git push origin main',
    'gh pr merge 12 --admin',
    'gh -R o/r pr merge 12 --admin',
    'gh --repo=o/r pr merge 12 --admin',
    'gh api repos/o/r/branches/main/protection -f enforce_admins=true',
    'gh api repos/o/r/branches/main/protection --input body.json',
    'git push --repo=origin main',
    '(git push origin main)',
    '{ git push origin main; }',
    'if true; then git push origin main; fi',
    'timeout 10 git push origin main',
    'sudo -u root git push origin main',
    'nice -n 5 git push origin main',
    'echo | xargs -n 1 git push origin main',
    'git \\\npush origin main',
    'if git push origin main; then :; fi',
    'while git push origin main; do :; done',
    'env -u X git push origin main',
    'env -i FOO=1 git push origin main',
    'env --unset=X git push origin main',
    'env -C /tmp git push origin main',
    'echo $(git push origin main)',
    'echo `git push origin main`',
    'echo "$(git push origin main)"',
    'echo "x `git push origin main` y"',
    'echo $(echo $(git push origin main))',
    'gh api -X PUT repos/o/r/branches/main/protection',
    'gh api --method=DELETE repos/o/r/branches/main/protection',
  ])('denies %s', (command) => {
    expect(decide(command, env())?.decision).toBe('deny');
  });

  it('denies push to main inside a chain', () => {
    const d = decide('git add . && git commit -m "x" && git push origin main', env());
    expect(d).toEqual({
      decision: 'deny',
      reason: 'Pushing to main is blocked by Editlet: publish through a editlet/<name> branch and a pull request.',
    });
  });

  it('denies bare push on base branch', () => {
    expect(decide('git push', env({ currentBranch: 'main' }))?.decision).toBe('deny');
    expect(decide('git push origin HEAD', env({ currentBranch: 'main' }))?.decision).toBe('deny');
    expect(decide('git push origin', env({ currentBranch: 'release', protectedBranches: ['release'] }))?.decision).toBe(
      'deny',
    );
  });

  it('denies admin merge with a value, glob refspecs and heads/ destinations', () => {
    expect(decide('gh pr merge 12 --admin=true', env())?.decision).toBe('deny');
    expect(decide('gh pr merge 12 --admin=false', env())?.decision).toBe('ask');
    expect(decide('git push origin editlet/x:heads/main', env())?.decision).toBe('deny');
    expect(decide("git push origin 'refs/heads/*:refs/heads/*'", env())?.decision).toBe('deny');
    expect(decide('git push origin HEAD:*', env())?.decision).toBe('deny');
    expect(decide('git push origin editlet/x:refs/heads/editlet/*', env())).toBeNull();
  });

  it('asks before merging with gh global flags', () => {
    expect(decide('gh --repo o/r pr merge 12', env())?.decision).toBe('ask');
    expect(decide('gh -R o/r pr merge 12', env())?.decision).toBe('ask');
  });

  it('asks before merging', () => {
    expect(decide('gh pr merge 12 --squash', env())).toEqual({
      decision: 'ask',
      reason: 'Merging publishes the change. Merge only after the human explicitly approved this PR in chat.',
    });
  });

  it.each([
    'git push -u origin editlet/x',
    'git push',
    'git push --force-with-lease origin editlet/x',
    'git push -o ci.skip origin editlet/x',
    'echo "git push origin main"',
    "echo '$(git push origin main)'",
    'echo "cost is $5"',
    'gh pr view 12',
    'gh api repos/o/r/branches/main/protection',
    'git status',
  ])('allows %s', (command) => {
    expect(decide(command, env())).toBeNull();
  });

  it('validates commits', () => {
    const bad = env({ validateCommit: () => ['cms/content/post/a.md: title — Required'] });
    const d = decide('git commit -m x', bad);
    expect(d?.decision).toBe('deny');
    expect(d?.reason).toBe(
      'Editlet content is invalid; fix these before committing:\ncms/content/post/a.md: title — Required',
    );
    expect(decide('git commit -m x', env({ validateCommit: () => [] }))).toBeNull();
    expect(decide('git commit -m x', env())).toBeNull();
  });

  it('asks before a content commit on a branch outside the prefix', () => {
    const valid = { validateCommit: () => [] };
    const d = decide('git commit -m x', env({ ...valid, currentBranch: 'feature/x' }));
    expect(d).toEqual({
      decision: 'ask',
      reason: 'Editlet content change sets go to editlet/<name> branches, and this commit is on feature/x.',
    });
    expect(decide('git commit -m x', env({ ...valid, currentBranch: 'main' }))).toBeNull();
    expect(decide('git commit -m x', env({ ...valid, currentBranch: 'cms/x', branchPrefix: 'cms/' }))).toBeNull();
    expect(decide('git commit -m x', env({ currentBranch: 'feature/x' }))).toBeNull();
  });

  it('names the prefix in push refusals', () => {
    expect(decide('git push origin main', env({ branchPrefix: 'cms/' }))?.reason).toContain('a cms/<name> branch');
  });

  it('caps commit issue lines at 20', () => {
    const lines = Array.from({ length: 25 }, (_, i) => `f${i}: p — m`);
    const d = decide('git commit -m x', env({ validateCommit: () => lines }));
    expect(d?.reason.split('\n')).toHaveLength(22);
    expect(d?.reason.endsWith('…and 5 more')).toBe(true);
  });
});

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]) {
  const res = spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });
  expect(res.status, res.stderr).toBe(0);
}

async function fixtureRepo(branch = 'main'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-guard-'));
  temps.push(dir);
  await cp(site, dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'init');
  if (branch !== 'main') git(dir, 'checkout', '-b', branch);
  return dir;
}

const guard = (input: string) => spawnSync(jiti, [join(import.meta.dirname, 'guard.ts')], { input, encoding: 'utf8' });
const hook = (command: string, cwd: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd });

describe('guard CLI', () => {
  it('fails closed when the commit check throws', async () => {
    const dir = await fixtureRepo('editlet/x');
    await writeFile(join(dir, 'cms/content/post/new.md'), '---\ntitle: New\n---\n');
    await chmod(join(dir, 'cms/content/post/hello-world.md'), 0o000);
    const res = guard(hook('git commit -am x', dir));
    await chmod(join(dir, 'cms/content/post/hello-world.md'), 0o644);
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toContain('Editlet guard failed:');
  });

  it('denies a push to main', async () => {
    const res = guard(hook('git push origin main', await fixtureRepo()));
    expect(res.status).toBe(0);
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    expect(out).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    expect(out.permissionDecisionReason).toContain('Pushing to main is blocked');
  });

  it('denies unreadable input', () => {
    const res = guard('not json');
    expect(JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason).toBe(
      'Editlet guard could not read the hook input',
    );
    expect(JSON.parse(guard('{"tool_name":"Bash","tool_input":{}}').stdout).hookSpecificOutput.permissionDecision).toBe(
      'deny',
    );
  });

  it('ignores other tools and harmless commands', async () => {
    expect(guard('{"tool_name":"Read","tool_input":{}}').stdout).toBe('');
    expect(guard(hook('ls', await fixtureRepo())).stdout).toBe('');
  });

  it('denies a commit of invalid content', async () => {
    const dir = await fixtureRepo('editlet/x');
    const file = join(dir, 'cms/content/post/hello-world.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('title: Hello world\n', ''));
    const res = guard(hook('git commit -am x', dir));
    const out = JSON.parse(res.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe('deny');
    expect(out.permissionDecisionReason).toContain('title — Required');
  });

  it('allows a commit without CMS changes', async () => {
    const dir = await fixtureRepo('editlet/x');
    await writeFile(join(dir, 'notes.txt'), 'x');
    expect(guard(hook('git commit -am x', dir)).stdout).toBe('');
  });
});
