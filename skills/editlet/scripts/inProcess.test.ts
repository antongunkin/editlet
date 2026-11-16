// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runScript } from '../../test/runScript';

// The CLI glue of the skill scripts, run in this process (the jiti tests run the same scripts as child processes).

const site = join(import.meta.dirname, '../../../node/__fixtures__/site');
const script = (name: string) => join(import.meta.dirname, `${name}.ts`);
const post = 'cms/content/post/hello-world.md';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copyOfSite(): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'editlet-inproc-')));
  temps.push(dir);
  await cp(site, dir, { recursive: true });
  return dir;
}

const git = (root: string, ...args: string[]) =>
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });

async function repoOfSite(): Promise<string> {
  const root = await copyOfSite();
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'init');
  return root;
}

const schema = (root: string, ...args: string[]) => runScript(script('schema'), [...args, '--root', root]);

describe('schema.ts', () => {
  it('check accepts the unchanged schema and counts the entries', async () => {
    const root = await copyOfSite();
    const res = await schema(root, 'check', 'cms/schema.json');
    expect(res).toMatchObject({ status: 0, stdout: '✓ schema change is safe (3 entries checked)\n' });
  });

  it('check reports a breaking candidate, an unreadable one and a missing argument', async () => {
    const root = await copyOfSite();
    const next = JSON.parse(await readFile(join(root, 'cms/schema.json'), 'utf8'));
    next.collections.post.fields.summary = { type: 'string', label: 'Summary', required: true };
    await writeFile(join(root, 'candidate.json'), JSON.stringify(next));
    const broken = await schema(root, 'check', 'candidate.json');
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain(`${post}: summary — Required`);

    const missing = await schema(root, 'check', 'nope.json');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/^check: cannot read nope\.json: /);
    expect((await schema(root, 'check')).stderr).toContain('check: missing <candidate.json>');
  });

  it('check reports an invalid candidate as issues', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, 'candidate.json'), '{"collections":1}');
    const res = await schema(root, 'check', 'candidate.json');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('contentDir — ');
  });

  it('rename-field prints the dry run, then --apply writes', async () => {
    const root = await copyOfSite();
    const dry = await schema(root, 'rename-field', 'post', 'featuredImage', 'cover');
    expect(dry.stdout).toBe(
      [
        'schema: cms/schema.json (post.featuredImage → post.cover)',
        `entry: ${post}`,
        'dry run: nothing written; add --apply to write',
        '',
      ].join('\n'),
    );
    const applied = await schema(root, 'rename-field', 'post', 'featuredImage', 'cover', '--apply');
    expect(applied.stdout).toContain('applied: 2 files written');
    expect(await readFile(join(root, post), 'utf8')).toContain('cover:\n  src: hello-world/cover.webp');
  });

  it('rename-field marks re-serialized entries and reports clashes', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, post), '---\n{title: Hi, author: author/jane}\n---\nBody\n');
    const res = await schema(root, 'rename-field', 'post', 'author', 'writer');
    expect(res.stdout).toContain(`entry: ${post} (rewritten in standard format)`);

    await writeFile(join(root, post), '---\ntitle: Hi\nwriter: x\nauthor: author/jane\n---\n');
    const clash = await schema(root, 'rename-field', 'post', 'author', 'writer', '--apply');
    expect(clash.status).toBe(1);
    expect(clash.stderr).toContain(`${post}: writer — Field "writer" already exists in this entry`);
  });

  it('remove-field prints losses and needs its arguments', async () => {
    const root = await copyOfSite();
    const res = await schema(root, 'remove-field', 'post', 'featuredImage');
    expect(res.stdout).toContain(`loses data: ${post} (featuredImage)`);
    expect(res.stdout).toContain('note: image files are left on disk: cms/content/post/hello-world/cover.webp');
    expect((await schema(root, 'remove-field', 'post')).status).toBe(2);
    expect((await schema(root, 'rename-field', 'post')).status).toBe(2);
  });

  it('a failed write stops before the schema and lists what was written', async () => {
    const root = await copyOfSite();
    const second = 'cms/content/post/second.md';
    await writeFile(join(root, second), await readFile(join(root, post), 'utf8'));
    await chmod(join(root, second), 0o444);
    const before = await readFile(join(root, 'cms/schema.json'), 'utf8');
    const res = await schema(root, 'rename-field', 'post', 'title', 'headline', '--apply');
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(new RegExp(`^write failed: ${second}: .+\\nalready written: ${post}\\n$`));
    expect(await readFile(join(root, 'cms/schema.json'), 'utf8')).toBe(before);
  });

  it('json-schema prints one or all collections and rejects an unknown one', async () => {
    const root = await copyOfSite();
    expect(JSON.parse((await schema(root, 'json-schema', 'post')).stdout).properties.title).toBeDefined();
    expect(Object.keys(JSON.parse((await schema(root, 'json-schema')).stdout)).toSorted()).toEqual([
      'author',
      'homePage',
      'post',
    ]);
    const unknown = await schema(root, 'json-schema', 'nope');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain('Unknown collection "nope" (known: post, author, homePage)');
  });

  it('prints the usage for no command, an unknown command and an unknown flag', async () => {
    const root = await copyOfSite();
    const none = await runScript(script('schema'), ['--root', root]);
    expect(none.status).toBe(2);
    expect(none.stderr.startsWith('Usage: schema')).toBe(true);
    expect((await schema(root, 'frobnicate')).stderr).toMatch(/^Unknown command "frobnicate"\nUsage:/);
    expect((await schema(root, 'json-schema', '--dry-run')).status).toBe(2);
  });

  it('reports a broken schema as issues', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const res = await schema(root, 'json-schema');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cms/schema.json: contentDir — ');
  });
});

describe('validate.ts and types.ts', () => {
  it('validate counts valid entries and reports broken ones', async () => {
    const root = await copyOfSite();
    expect(await runScript(script('validate'), [root])).toMatchObject({ status: 0, stdout: '✓ 3 entries valid\n' });
    await writeFile(join(root, post), '---\nauthor: author/nobody\n---\n');
    const res = await runScript(script('validate'), [root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`${post}: title — `);
  });

  it.each(['validate', 'types'])('%s reports a broken schema', async (name) => {
    const root = await copyOfSite();
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const res = await runScript(script(name), [root]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cms/schema.json: contentDir — ');
  });

  it('types writes the declarations and prints their path', async () => {
    const root = await copyOfSite();
    const res = await runScript(script('types'), [root]);
    expect(res.stdout).toBe(`${join(root, '.editlet/content.d.ts')}\n`);
  });
});

const style = (root: string, args: string[], stdin?: string) =>
  runScript(script('style'), [...args, '--root', root], stdin);

describe('style.ts', () => {
  it('prints branch names and commit messages', async () => {
    const root = await copyOfSite();
    expect((await style(root, ['branch', 'Spring', 'Sale'])).stdout).toBe('editlet/spring-sale\n');
    expect((await style(root, ['commit', 'upload', 'post/a'])).stdout).toBe('Upload post/a\n\nEditlet-Source: agent\n');
  });

  it.each([
    [['branch'], 'branch needs a name'],
    [['branch', '!!!'], 'branch needs a name'],
    [['commit', 'rename', 'post/a'], 'commit rename needs <collection>/<old> <new>'],
    [['commit', 'update', 'post'], 'commit needs an action and <collection>/<slug>'],
    [['pr', 'editlet/x'], 'pr needs a branch and --login'],
    [['pr', 'editlet/x', '--login'], '--login needs a value'],
    [['pr', 'editlet/x', '--login', '--site'], '--login needs a value'],
    [['frobnicate'], 'unknown command "frobnicate"'],
    [[], 'no command'],
  ])('exits 2 for %j', async (args, message) => {
    const res = await style(await copyOfSite(), args);
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(new RegExp(`^${message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nUsage:`));
  });

  it('exits 1 when the schema is invalid', async () => {
    const root = await copyOfSite();
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const res = await style(root, ['branch', 'x']);
    expect(res).toMatchObject({ status: 1, stderr: 'cms/schema.json is invalid; run validate.mjs\n' });
  });

  it('describes staged files, the pull request and an updated pull request body', async () => {
    const root = await repoOfSite();
    expect((await style(root, ['commit', '--staged'])).stderr).toMatch(/^nothing is staged/);
    git(root, 'switch', '-q', '-c', 'editlet/sale');
    await writeFile(join(root, 'cms/content/post/sale.md'), '---\ntitle: Sale\n---\n');
    await rm(join(root, 'cms/content/author/jane.md'));
    git(root, 'add', '-A');
    expect((await style(root, ['commit', '--staged'])).stdout).toMatch(/^Update 2 entries\n|^.+\n\nEditlet-Source/);
    git(root, 'commit', '-q', '-m', 'x');

    const pr = JSON.parse((await style(root, ['pr', 'sale', '--login', 'alice', '--site', 'https://e.com//'])).stdout);
    expect(pr).toMatchObject({ title: 'Update sale', labels: ['editlet'], draft: false });
    expect(pr.body).toContain('- Post · sale — created');
    expect(pr.body).toContain('Review on the site: https://e.com/?editlet=branch:sale');

    const withoutSite = JSON.parse((await style(root, ['pr', 'editlet/sale', '--login', 'alice'])).stdout);
    expect(withoutSite.body).not.toContain('Review on the site');

    const body = 'Human\n\n<!-- editlet:start -->\nold\n<!-- editlet:end -->\n';
    const merged = (await style(root, ['pr-body', 'editlet/sale', '--login', 'alice'], body)).stdout;
    expect(merged.startsWith('Human\n\n<!-- editlet:start -->\nOpened in Editlet by @alice.')).toBe(true);
    expect(merged).not.toContain('old');
  });
});

const guard = (input: unknown) =>
  runScript(script('guard'), [], typeof input === 'string' ? input : JSON.stringify(input));

const decision = (res: { stdout: string }) =>
  res.stdout ? JSON.parse(res.stdout).hookSpecificOutput.permissionDecision : null;

const reason = (res: { stdout: string }) => JSON.parse(res.stdout).hookSpecificOutput.permissionDecisionReason;

describe('guard.ts', () => {
  it('denies unreadable input and ignores other tools', async () => {
    expect(reason(await guard('not json'))).toBe('Editlet guard could not read the hook input');
    expect(reason(await guard('null'))).toBe('Editlet guard could not read the hook input');
    expect(reason(await guard({ tool_name: 'Bash', tool_input: {} }))).toBe(
      'Editlet guard could not read the hook input',
    );
    expect((await guard({ tool_name: 'Read', tool_input: { file_path: 'x' } })).stdout).toBe('');
  });

  it('protects the schema base branch and asks for a commit outside the branch prefix', async () => {
    const root = await repoOfSite();
    await writeFile(
      join(root, 'cms/schema.json'),
      (await readFile(join(root, 'cms/schema.json'), 'utf8')).replace(
        '"baseBranch": "main"',
        '"baseBranch": "dev", "branchPrefix": "cms/"',
      ),
    );
    git(root, 'commit', '-q', '-am', 'dev');
    const push = await guard({ tool_name: 'Bash', tool_input: { command: 'git push origin dev' }, cwd: root });
    expect(reason(push)).toContain('Pushing to dev is blocked by Editlet: publish through a cms/<name> branch');

    git(root, 'switch', '-q', '-c', 'feature');
    await writeFile(join(root, 'cms/content/post/new.md'), '---\ntitle: New\n---\n');
    const commit = await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: root });
    expect(decision(commit)).toBe('ask');
    expect(reason(commit)).toContain('this commit is on feature');
  });

  it('denies a commit of invalid content, also from a subfolder of the project', async () => {
    const root = await repoOfSite();
    git(root, 'switch', '-q', '-c', 'editlet/x');
    await writeFile(join(root, 'cms/content/post/bad.md'), '---\nauthor: author/nobody\n---\n');
    const res = await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: join(root, 'cms') });
    expect(decision(res)).toBe('deny');
    expect(reason(res)).toContain('cms/content/post/bad.md: title — ');
  });

  it('reports a broken schema on commit and still protects main', async () => {
    const root = await repoOfSite();
    git(root, 'switch', '-q', '-c', 'editlet/x');
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const commit = await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: root });
    expect(reason(commit)).toContain('cms/schema.json: contentDir — ');
    const push = await guard({ tool_name: 'Bash', tool_input: { command: 'git push origin main' }, cwd: root });
    expect(decision(push)).toBe('deny');
  });

  it('has no opinion on a commit that does not touch CMS files or outside a project', async () => {
    const root = await repoOfSite();
    git(root, 'switch', '-q', '-c', 'feature');
    await writeFile(join(root, 'README.md'), 'x');
    expect((await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -am x' }, cwd: root })).stdout).toBe(
      '',
    );
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'editlet-noproj-')));
    temps.push(outside);
    const res = await guard({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: outside });
    expect(res.stdout).toBe('');
  });
});

const link = (root: string, ...args: string[]) => runScript(script('link'), [...args, '--root', root]);

async function emptyProject(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'editlet-link-inproc-')));
  temps.push(root);
  return root;
}

describe('link.ts', () => {
  it('prints the usage for an unknown flag', async () => {
    const res = await runScript(script('link'), ['--force']);
    expect(res).toMatchObject({ status: 2, stderr: 'usage: link.mjs [--check] [--hooks] [--root <dir>]\n' });
  });

  it('--check reports missing links with exit 1; after linking it passes', async () => {
    const root = await emptyProject();
    const before = await link(root, '--check');
    expect(before.status).toBe(1);
    expect(before.stdout).toContain('.claude/skills/editlet: missing');
    const linked = await link(root);
    expect(linked.status).toBe(0);
    expect(linked.stdout).toContain('.claude/skills/editlet: linked');
    const after = await link(root, '--check');
    expect(after.status).toBe(0);
    expect(after.stdout).toContain('.claude/skills/editlet: already linked');
  });

  it('exits 2 and leaves an invalid settings.json alone', async () => {
    const root = await emptyProject();
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude/settings.json'), '{ nope');
    const res = await link(root, '--hooks');
    expect(res).toMatchObject({ status: 2, stderr: '.claude/settings.json: not valid JSON, left untouched\n' });
    expect(await readFile(join(root, '.claude/settings.json'), 'utf8')).toBe('{ nope');
  });
});
