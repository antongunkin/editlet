// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSkillScripts } from './build.ts';
import { linkSkill } from './link.ts';

const repo = join(import.meta.dirname, '../../../../..');
const jiti = join(repo, 'node_modules/.bin/jiti');
const HOOK = 'node "$CLAUDE_PROJECT_DIR"/.claude/skills/editlet/scripts/guard.mjs';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function project(): Promise<{ root: string; skillDir: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'editlet-link-')));
  temps.push(root);
  const skillDir = join(root, 'node_modules/editlet/skills/editlet');
  await mkdir(skillDir, { recursive: true });
  return { root, skillDir };
}

/** Builds the bundles and makes yaml/zod resolvable from the temp project, as after `npm install`. */
async function installDeps(root: string, skillDir: string): Promise<void> {
  await buildSkillScripts(join(skillDir, 'scripts'));
  for (const dep of ['yaml', 'zod']) await symlink(join(repo, 'node_modules', dep), join(root, 'node_modules', dep));
}

async function aliased() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'editlet-alias-')));
  temps.push(base);
  await mkdir(join(base, 'real/proj/node_modules/editlet/skills/editlet'), { recursive: true });
  await symlink('real', join(base, 'alias'));
  const root = join(base, 'real/proj');
  const skillDir = join(root, 'node_modules/editlet/skills/editlet');
  await buildSkillScripts(join(skillDir, 'scripts'));
  const viaAlias = join(base, 'alias/proj/node_modules/editlet/skills/editlet');
  return { root, skillDir, viaAlias };
}

const runCli = (root: string, ...args: string[]) =>
  spawnSync(jiti, [join(import.meta.dirname, 'link.ts'), '--root', root, ...args], { encoding: 'utf8' });

describe('link script', () => {
  it('creates relative links', async () => {
    const { root, skillDir } = await project();
    const lines = await linkSkill({ root, skillDir });
    expect(lines).toEqual(['.claude/skills/editlet: linked', '.agents/skills/editlet: linked']);
    const target = await readlink(join(root, '.claude/skills/editlet'));
    expect(target.startsWith('../../')).toBe(true);
    expect(target).toBe('../../node_modules/editlet/skills/editlet');
    expect(await readlink(join(root, '.agents/skills/editlet'))).toBe(target);
  });

  it('is idempotent', async () => {
    const { root, skillDir } = await project();
    await linkSkill({ root, skillDir });
    const lines = await linkSkill({ root, skillDir });
    expect(lines).toEqual(['.claude/skills/editlet: already linked', '.agents/skills/editlet: already linked']);
  });

  it('fixes a wrong link', async () => {
    const { root, skillDir } = await project();
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    await symlink('../../elsewhere', join(root, '.claude/skills/editlet'));
    const lines = await linkSkill({ root, skillDir });
    expect(lines[0]).toBe('.claude/skills/editlet: fixed link');
    expect(await readlink(join(root, '.claude/skills/editlet'))).toBe('../../node_modules/editlet/skills/editlet');
  });

  it('keeps a copy', async () => {
    const { root, skillDir } = await project();
    const copy = join(root, '.claude/skills/editlet');
    await mkdir(copy, { recursive: true });
    await writeFile(join(copy, 'SKILL.md'), 'mine');
    const lines = await linkSkill({ root, skillDir });
    expect(lines[0]).toBe('.claude/skills/editlet: copy kept');
    expect(await readFile(join(copy, 'SKILL.md'), 'utf8')).toBe('mine');
    expect(await linkSkill({ root, skillDir, check: true })).toContain('.claude/skills/editlet: copy kept');
  });

  it('adds the hook once and keeps existing settings', async () => {
    const { root, skillDir } = await project();
    const settings = join(root, '.claude/settings.json');
    await mkdir(join(root, '.claude'), { recursive: true });
    const other = { matcher: 'Edit', hooks: [{ type: 'command', command: 'echo hi' }] };
    await writeFile(settings, JSON.stringify({ model: 'x', hooks: { PreToolUse: [other], Stop: [] } }));
    const first = await linkSkill({ root, skillDir, hooks: true });
    expect(first[2]).toBe('.claude/settings.json: hook added');
    const second = await linkSkill({ root, skillDir, hooks: true });
    expect(second[2]).toBe('.claude/settings.json: hook present');
    const text = await readFile(settings, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({
      model: 'x',
      hooks: {
        PreToolUse: [other, { matcher: 'Bash', hooks: [{ type: 'command', command: HOOK }] }],
        Stop: [],
      },
    });
  });

  it('creates settings.json when absent', async () => {
    const { root, skillDir } = await project();
    await linkSkill({ root, skillDir, hooks: true });
    const parsed = JSON.parse(await readFile(join(root, '.claude/settings.json'), 'utf8'));
    expect(parsed.hooks.PreToolUse).toHaveLength(1);
  });

  it('rejects invalid settings.json and leaves it untouched', async () => {
    const { root } = await project();
    await mkdir(join(root, '.claude'), { recursive: true });
    await writeFile(join(root, '.claude/settings.json'), '{ nope');
    const res = runCli(root, '--hooks');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('.claude/settings.json');
    expect(await readFile(join(root, '.claude/settings.json'), 'utf8')).toBe('{ nope');
  });

  it('--check on an empty project exits 1 and creates nothing', async () => {
    const { root } = await project();
    const res = runCli(root, '--check', '--hooks');
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('.claude/skills/editlet: missing');
    expect(res.stdout).toContain('.claude/settings.json: hook missing');
    expect(existsSync(join(root, '.claude'))).toBe(false);
    expect(existsSync(join(root, '.agents'))).toBe(false);
  });

  it('--check exits 0 after linking', async () => {
    const { root, skillDir } = await project();
    await installDeps(root, skillDir);
    await linkSkill({ root, skillDir, hooks: true });
    const lines = await linkSkill({ root, skillDir, hooks: true, check: true });
    expect(lines.some((line) => line.endsWith('missing'))).toBe(false);
    expect(lines.some((line) => line.includes('guard'))).toBe(false);
  });

  it('--check reports a missing guard bundle and exits 1; write mode warns', async () => {
    const { root, skillDir } = await project();
    await linkSkill({ root, skillDir, hooks: true });
    const lines = await linkSkill({ root, skillDir, hooks: true, check: true });
    expect(lines).toContain('.claude/settings.json: guard missing');
    expect(runCli(root, '--check', '--hooks').status).toBe(1);
    expect((await linkSkill({ root, skillDir, hooks: true })).some((l) => l.startsWith('warning: '))).toBe(true);
  });

  it('--check reports a guard that cannot load (no yaml/zod installed)', async () => {
    const { root, skillDir } = await project();
    await buildSkillScripts(join(skillDir, 'scripts'));
    await linkSkill({ root, skillDir, hooks: true });
    const lines = await linkSkill({ root, skillDir, hooks: true, check: true });
    expect(lines).toContain('.claude/settings.json: guard broken');
  });

  it('--check reports a link pointing elsewhere as wrong link', async () => {
    const { root } = await project();
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    await mkdir(join(root, 'elsewhere'));
    await symlink('../../elsewhere', join(root, '.claude/skills/editlet'));
    const res = runCli(root, '--check');
    expect(res.status).toBe(1);
    expect(res.stdout).toContain('.claude/skills/editlet: wrong link');
  });

  it('the bundle run from node_modules links to the package path', async () => {
    const { root, skillDir } = await project();
    await buildSkillScripts(join(skillDir, 'scripts'));
    await installDeps(root, skillDir);
    const res = spawnSync('node', [join(skillDir, 'scripts/link.mjs'), '--root', root, '--hooks'], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(await readlink(join(root, '.claude/skills/editlet'))).toBe('../../node_modules/editlet/skills/editlet');
    const check = spawnSync('node', [join(skillDir, 'scripts/link.mjs'), '--root', root, '--check', '--hooks'], {
      encoding: 'utf8',
    });
    expect(check.status).toBe(0);
  });

  it.each(['relative', 'absolute'])('works when run through the installed link (%s)', async (form) => {
    const { root, skillDir } = await project();
    await buildSkillScripts(join(skillDir, 'scripts'));
    const wanted = '../../node_modules/editlet/skills/editlet';
    await linkSkill({ root, skillDir });
    const script = '.claude/skills/editlet/scripts/link.mjs';
    const arg = form === 'relative' ? script : join(root, script);
    for (const extra of [['--check'], []]) {
      const res = spawnSync('node', [arg, ...extra], { cwd: root, encoding: 'utf8' });
      expect(res.status).toBe(0);
      expect(res.stdout).toBe('.claude/skills/editlet: already linked\n.agents/skills/editlet: already linked\n');
    }
    expect(await readlink(join(root, '.claude/skills/editlet'))).toBe(wanted);
    expect(await readlink(join(root, '.agents/skills/editlet'))).toBe(wanted);
  });

  it('links every skill of the package, the main one first', async () => {
    const { root, skillDir } = await project();
    for (const name of ['editlet-setup', 'editlet-migrate']) {
      await mkdir(join(skillDir, '..', name), { recursive: true });
      await writeFile(join(skillDir, '..', name, 'SKILL.md'), '---\nname: x\n---\n');
    }
    await mkdir(join(skillDir, '../shared'), { recursive: true });
    const lines = await linkSkill({ root, skillDir });
    expect(lines).toEqual([
      '.claude/skills/editlet: linked',
      '.agents/skills/editlet: linked',
      '.claude/skills/editlet-migrate: linked',
      '.agents/skills/editlet-migrate: linked',
      '.claude/skills/editlet-setup: linked',
      '.agents/skills/editlet-setup: linked',
    ]);
    expect(await readlink(join(root, '.claude/skills/editlet-setup'))).toBe(
      '../../node_modules/editlet/skills/editlet-setup',
    );
    expect(existsSync(join(root, '.claude/skills/shared'))).toBe(false);
  });

  it('reports and removes links to skills the package no longer has', async () => {
    const { root, skillDir } = await project();
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    await symlink('../../node_modules/editlet/skills/editlet-old', join(root, '.claude/skills/editlet-old'));
    await symlink('../../somewhere/else', join(root, '.claude/skills/mine'));
    expect(await linkSkill({ root, skillDir, check: true })).toContain('.claude/skills/editlet-old: stale link');
    expect(runCli(root, '--check').status).toBe(1);
    expect(await linkSkill({ root, skillDir })).toContain('.claude/skills/editlet-old: stale link removed');
    expect(existsSync(join(root, '.claude/skills/editlet-old'))).toBe(false);
    expect(await readlink(join(root, '.claude/skills/mine'))).toBe('../../somewhere/else');
  });

  it('replaces a link of the old single-skill layout', async () => {
    const { root, skillDir } = await project();
    await mkdir(join(root, '.claude/skills'), { recursive: true });
    await symlink('../../node_modules/editlet/skill', join(root, '.claude/skills/editlet'));
    expect((await linkSkill({ root, skillDir }))[0]).toBe('.claude/skills/editlet: fixed link');
  });

  it('refuses when the skill folder is a self-loop', async () => {
    const { root } = await project();
    await mkdir(join(root, '.claude/skills/editlet'), { recursive: true });
    await expect(linkSkill({ root, skillDir: join(root, '.claude/skills/editlet') })).rejects.toThrow(/link path/);
    expect(existsSync(join(root, '.agents'))).toBe(false);
  });

  it.each([
    ['hooks', { hooks: [] }],
    ['hooks.PreToolUse', { hooks: { PreToolUse: {} } }],
  ])('rejects wrong-typed %s and leaves settings untouched', async (_name, value) => {
    const { root } = await project();
    await mkdir(join(root, '.claude'), { recursive: true });
    const text = JSON.stringify(value);
    await writeFile(join(root, '.claude/settings.json'), text);
    const res = runCli(root, '--hooks');
    expect(res.status).toBe(2);
    expect(res.stderr).toContain('.claude/settings.json');
    expect(await readFile(join(root, '.claude/settings.json'), 'utf8')).toBe(text);
  });

  describe('with a symlinked parent directory', () => {
    it('leaves good links alone when run through the installed link by alias path', async () => {
      const { root, skillDir } = await aliased();
      await linkSkill({ root, skillDir });
      const before = [
        await readlink(join(root, '.claude/skills/editlet')),
        await readlink(join(root, '.agents/skills/editlet')),
      ];
      const script = join(root, '../../alias/proj/.claude/skills/editlet/scripts/link.mjs');
      for (const extra of [['--check'], []]) {
        const res = spawnSync('node', [script, ...extra], { cwd: root, encoding: 'utf8' });
        expect(res.status).toBe(0);
        expect(res.stdout).toBe('.claude/skills/editlet: already linked\n.agents/skills/editlet: already linked\n');
      }
      expect([
        await readlink(join(root, '.claude/skills/editlet')),
        await readlink(join(root, '.agents/skills/editlet')),
      ]).toEqual(before);
    });

    it('a fresh install by alias path makes a working link', async () => {
      const { root, skillDir, viaAlias } = await aliased();
      const res = spawnSync('node', [join(viaAlias, 'scripts/link.mjs')], { cwd: root, encoding: 'utf8' });
      expect(res.status).toBe(0);
      for (const target of ['.claude/skills/editlet', '.agents/skills/editlet']) {
        expect(await realpath(join(root, target))).toBe(await realpath(skillDir));
      }
    });
  });
});
