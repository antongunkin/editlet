// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runScript } from '../../test/runScript';

const repo = join(import.meta.dirname, '../../../../..');
const survey = join(import.meta.dirname, '../../../__fixtures__/survey');
const jiti = join(repo, 'node_modules/.bin/jiti');

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-refs-'));
  temps.push(dir);
  await cp(survey, dir, { recursive: true });
  return dir;
}

// In this process, so v8 coverage sees the script (runScript); one test below runs it as a real CLI.
const run = (root: string, ...args: string[]) =>
  runScript(join(import.meta.dirname, 'refs.ts'), [...args, '--root', root]);
const cli = (root: string, ...args: string[]) =>
  spawnSync(jiti, [join(import.meta.dirname, 'refs.ts'), ...args, '--root', root], { encoding: 'utf8' });
const read = (root: string, name: string) => readFile(join(root, 'cms/content', name), 'utf8');
const exists = (root: string, name: string) =>
  stat(join(root, 'cms/content', name)).then(
    () => true,
    () => false,
  );

describe('refs used-by', () => {
  it('lists the referrers with their fields, nested ones too', async () => {
    const root = await copy();
    const res = await run(root, 'used-by', 'survey/onboarding');
    expect(res.stdout).toBe('cms/content/page/landing.md: content.3.survey\n');
    expect((await run(root, 'used-by', 'survey/pulse')).stdout).toBe('no entry references survey/pulse\n');
    const bad = await run(root, 'used-by', 'survey/nope');
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('Entry not found: survey/nope');
  });
});

describe('refs rename', () => {
  it('prints the plan in a dry run and writes nothing', async () => {
    const root = await copy();
    const before = await read(root, 'section/about-you.md');
    const res = await run(root, 'rename', 'question/role', 'team-role');
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(
      [
        'rename: question/role → question/team-role',
        'entry: cms/content/question/team-role.md (new path) (images)',
        'entry: cms/content/option/rating-high.md (references)',
        'entry: cms/content/section/about-you.md (references)',
        'delete: cms/content/question/role.md',
        'move: cms/content/question/role/diagram.webp → cms/content/question/team-role/diagram.webp',
        'dry run: nothing written; add --apply to write',
        '',
      ].join('\n'),
    );
    expect(await read(root, 'section/about-you.md')).toBe(before);
    expect(await exists(root, 'question/team-role.md')).toBe(false);
  });

  it('applies with one-line edits, moves the folder, and the project stays valid', async () => {
    const root = await copy();
    const before = {
      self: await read(root, 'question/role.md'),
      section: await read(root, 'section/about-you.md'),
      option: await read(root, 'option/rating-high.md'),
    };
    const res = await run(root, 'rename', 'question/role', 'team-role', '--apply');
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('applied: 6 file changes');
    expect(await read(root, 'question/team-role.md')).toBe(
      before.self.replace('src: role/diagram.webp', 'src: team-role/diagram.webp'),
    );
    expect(await read(root, 'section/about-you.md')).toBe(
      before.section.replace('- question/role', '- question/team-role'),
    );
    expect(await read(root, 'option/rating-high.md')).toBe(
      before.option.replace('followUp: question/role', 'followUp: question/team-role'),
    );
    expect(await exists(root, 'question/role.md')).toBe(false);
    expect(await exists(root, 'question/team-role/diagram.webp')).toBe(true);
    expect(await exists(root, 'question/role/diagram.webp')).toBe(false);
    const validate = spawnSync(jiti, [join(import.meta.dirname, 'validate.ts'), root], { encoding: 'utf8' });
    expect(validate.stdout).toMatch(/^✓ \d+ entries valid/);
  });

  it('rewrites references inside blocks and image sources inside nested Markdown', async () => {
    const root = await copy();
    expect((await run(root, 'rename', 'survey/onboarding', 'welcome', '--apply')).status).toBe(0);
    expect(await read(root, 'page/landing.md')).toContain('    survey: survey/welcome\n');
    expect((await run(root, 'rename', 'page/landing', 'join', '--apply')).status).toBe(0);
    const page = await read(root, 'page/landing.md'.replace('landing', 'join'));
    expect(page).toContain('src: join/hero.webp');
    expect(page).toContain('![Chart of answers](join/chart.webp)');
  });

  it('refuses a taken or invalid slug', async () => {
    const root = await copy();
    const taken = await run(root, 'rename', 'question/role', 'age');
    expect(taken.status).toBe(2);
    expect(taken.stderr).toContain('question/age is taken');
    expect((await run(root, 'rename', 'question/role', 'Team Role')).stderr).toContain('Invalid slug');
  });
});

describe('refs remove', () => {
  it('deletes the entry and removes the references, line by line', async () => {
    const root = await copy();
    const role = await read(root, 'question/role.md');
    const res = await run(root, 'remove', 'question/rating', '--apply');
    expect(res.status).toBe(0);
    expect(res.stdout.split('\n').slice(0, 4)).toEqual([
      'remove: question/rating',
      'entry: cms/content/question/role.md (references)',
      'entry: cms/content/section/feedback.md (references)',
      'delete: cms/content/question/rating.md',
    ]);
    expect(await read(root, 'question/role.md')).toBe(role.replace('next: question/rating\n', ''));
    expect(await read(root, 'section/feedback.md')).not.toContain('questions');
    expect(await exists(root, 'question/rating.md')).toBe(false);
  });

  it('refuses when an entry would break, and writes nothing', async () => {
    const root = await copy();
    const res = await run(root, 'remove', 'survey/onboarding', '--apply');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cms/content/page/landing.md: content.3.survey — Required');
    expect(await exists(root, 'survey/onboarding.md')).toBe(true);
  });
});

describe('refs as a CLI', () => {
  it('runs under node through jiti: used-by prints the referrers', async () => {
    const root = await copy();
    const res = cli(root, 'used-by', 'survey/onboarding');
    expect(res).toMatchObject({ status: 0, stdout: 'cms/content/page/landing.md: content.3.survey\n' });
  });
});
