// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '../../../../..');
const site = join(import.meta.dirname, '../../../node/__fixtures__/site');
const jiti = join(repo, 'node_modules/.bin/jiti');

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copyOfSite(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-skill-'));
  temps.push(dir);
  await cp(site, dir, { recursive: true });
  return dir;
}

const run = (script: string, root: string) =>
  spawnSync(jiti, [join(import.meta.dirname, script), root], { encoding: 'utf8' });

describe('skill scripts', () => {
  it('types.ts writes the declarations', async () => {
    const root = await copyOfSite();
    const res = run('types.ts', root);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(join(root, '.editlet/content.d.ts'));
    expect(await readFile(join(root, '.editlet/content.d.ts'), 'utf8')).toContain('export interface EntryMap');
  });

  it.each(['types.ts', 'validate.ts'])('%s prints schema issues and exits 1', async (script) => {
    const root = await copyOfSite();
    await writeFile(join(root, 'cms/schema.json'), '{"collections": 1}');
    const res = run(script, root);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cms/schema.json: contentDir — ');
    expect(res.stderr).not.toContain('EditletError');
  });
});

describe('style.ts', () => {
  const style = (root: string, ...args: string[]) =>
    spawnSync(jiti, [join(import.meta.dirname, 'style.ts'), ...args, '--root', root], { encoding: 'utf8' });
  const git = (root: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, encoding: 'utf8' });

  async function repoOfSite(): Promise<string> {
    const root = await copyOfSite();
    git(root, 'init', '-q', '-b', 'main');
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'init');
    return root;
  }

  it('names branches and commits with the default style', async () => {
    const root = await copyOfSite();
    expect(style(root, 'branch', 'Spring Sale').stdout).toBe('editlet/spring-sale\n');
    expect(style(root, 'commit', 'update', 'post/hello-world').stdout).toBe(
      'Update post/hello-world\n\nEditlet-Source: agent\n',
    );
    expect(style(root, 'commit', 'rename', 'post/x').status).toBe(2);
  });

  it('follows git style keys of the schema', async () => {
    const root = await copyOfSite();
    const path = join(root, 'cms/schema.json');
    const schema = JSON.parse(await readFile(path, 'utf8'));
    schema.git = { ...schema.git, branchPrefix: 'cms/', commitMessage: 'content({collection}): {action} {slug}' };
    await writeFile(path, JSON.stringify(schema));
    expect(style(root, 'branch', 'sale').stdout).toBe('cms/sale\n');
    expect(style(root, 'commit', 'create', 'post/a').stdout).toBe('content(post): create a\n\nEditlet-Source: agent\n');
  });

  it('builds the message of the staged files and the pull request from base...HEAD', async () => {
    const root = await repoOfSite();
    git(root, 'switch', '-q', '-c', 'editlet/sale');
    await writeFile(join(root, 'cms/content/post/sale.md'), '---\ntitle: Sale\n---\n');
    git(root, 'add', 'cms/content/post/sale.md');
    expect(style(root, 'commit', '--staged').stdout).toBe('Create post/sale\n\nEditlet-Source: agent\n');
    git(root, 'commit', '-q', '-m', 'x');

    const pr = JSON.parse(
      style(root, 'pr', 'editlet/sale', '--login', 'alice', '--site', 'https://example.com/').stdout,
    );
    expect(pr).toMatchObject({ title: 'Update editlet/sale', labels: ['editlet'], draft: false });
    expect(pr.body).toContain('- Post · sale — created');
    expect(pr.body).toContain('Review on the site: https://example.com/?editlet=branch:sale');
    const custom = style(
      root,
      'pr',
      'editlet/sale',
      '--login',
      'alice',
      '--site',
      'https://example.com',
      '--param',
      'cms',
    );
    expect(JSON.parse(custom.stdout).body).toContain('Review on the site: https://example.com/?cms=branch:sale');

    const merged = spawnSync(
      jiti,
      [join(import.meta.dirname, 'style.ts'), 'pr-body', 'editlet/sale', '--login', 'alice', '--root', root],
      { encoding: 'utf8', input: 'Human text\n\n<!-- editlet:start -->\nold\n<!-- editlet:end -->\n' },
    ).stdout;
    expect(merged.startsWith('Human text\n\n<!-- editlet:start -->\nOpened in Editlet by @alice.')).toBe(true);
    expect(merged).not.toContain('old');
  });
});
