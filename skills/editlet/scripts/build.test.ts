// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSkillScripts } from './build.ts';

const repo = join(import.meta.dirname, '../../../../..');
const site = join(import.meta.dirname, '../../../node/__fixtures__/site');

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buildSkillScripts', () => {
  it('bundled validate runs from node_modules', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'editlet-bundle-'));
    temps.push(tmp);
    const outdir = join(tmp, 'node_modules/editlet/skills/editlet/scripts');
    await mkdir(outdir, { recursive: true });
    for (const dep of ['yaml', 'zod']) {
      await symlink(join(repo, 'node_modules', dep), join(tmp, 'node_modules', dep));
    }
    const written = await buildSkillScripts(outdir);
    expect(written).toContain(join(outdir, 'validate.mjs'));
    await cp(site, join(tmp, 'site'), { recursive: true });
    const res = spawnSync('node', [join(outdir, 'validate.mjs'), join(tmp, 'site')], { encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('✓ 3 entries valid');
  });

  it('bundled doctor of editlet-setup runs from node_modules', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'editlet-bundle-'));
    temps.push(tmp);
    const outdir = join(tmp, 'node_modules/editlet/skills/editlet-setup/scripts');
    await mkdir(outdir, { recursive: true });
    for (const dep of ['yaml', 'zod']) {
      await symlink(join(repo, 'node_modules', dep), join(tmp, 'node_modules', dep));
    }
    expect(await buildSkillScripts(outdir, 'editlet-setup')).toEqual([join(outdir, 'doctor.mjs')]);
    await cp(site, join(tmp, 'site'), { recursive: true });
    await writeFile(join(tmp, 'site/package.json'), '{}');
    const res = spawnSync('node', [join(outdir, 'doctor.mjs'), '--root', join(tmp, 'site')], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^ok {5}content\.valid: schema and entries valid$/m);
    expect(res.stdout).toMatch(/^fail {3}project\.framework:/m);
  });
});
