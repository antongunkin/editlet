// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { SKILL_SCRIPTS } from './editlet/scripts/build.ts';

const root = import.meta.dirname;
const SKILLS = readdirSync(root).filter((name) => existsSync(join(root, name, 'SKILL.md')));
const BUILT = Object.values(SKILL_SCRIPTS).flat();

const usage = spawnSync(join(root, '../../../node_modules/.bin/jiti'), [join(root, 'editlet/scripts/schema.ts')], {
  encoding: 'utf8',
});
const SCHEMA_COMMANDS = [...usage.stderr.matchAll(/^ {2}([a-z-]+) /gm)].map((m) => m[1]);

/** GitHub's heading anchor. */
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const anchors = (text: string) => [...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1]!));

function docsOf(skill: string): [string, string][] {
  const refs = join(root, skill, 'references');
  const files = existsSync(refs) ? readdirSync(refs).map((f) => join(refs, f)) : [];
  return [join(root, skill, 'SKILL.md'), ...files].map((path) => [path, readFileSync(path, 'utf8')]);
}

it('finds the three skills and the schema commands', () => {
  expect(SKILLS.toSorted()).toEqual(['editlet', 'editlet-migrate', 'editlet-setup']);
  expect(SCHEMA_COMMANDS).toEqual(expect.arrayContaining(['check', 'json-schema', 'rename-field', 'remove-field']));
});

describe.each(SKILLS)('%s', (skill) => {
  const text = readFileSync(join(root, skill, 'SKILL.md'), 'utf8');
  const meta = parse(text.split(/^---$/m)[1]!) as Record<string, string>;

  it('has only Agent Skills spec frontmatter keys, a matching name and a "Use when" description', () => {
    expect(Object.keys(meta).toSorted()).toEqual(['description', 'name']);
    expect(meta.name).toBe(skill);
    expect(meta.description.startsWith('Use when')).toBe(true);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  });

  it('stays short', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(200);
  });

  describe.each(docsOf(skill).map(([path, body]) => [relative(root, path), path, body]))('%s', (_name, path, body) => {
    it('links only to files and headings that exist', () => {
      for (const [, target, hash] of body.matchAll(/\]\((\.{0,2}\/?[\w./-]+\.md)(?:#([^)]+))?\)/g)) {
        const file = join(dirname(path), target!);
        expect(existsSync(file), `${target} from ${path}`).toBe(true);
        if (hash) expect(anchors(readFileSync(file, 'utf8')), `${target}#${hash}`).toContain(hash);
      }
    });

    it('names only scripts that are built, in the skill that builds them', () => {
      for (const [, name] of body.matchAll(/(?<![\w.-])([a-z]+)\.mjs\b/g)) expect(BUILT).toContain(name);
      for (const [, owner, name] of body.matchAll(/skills\/(editlet[\w-]*)\/scripts\/([a-z]+)\.mjs/g)) {
        expect(SKILL_SCRIPTS[owner!], `${owner}/scripts/${name}.mjs`).toContain(name);
      }
      for (const [, name] of body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/scripts\/([a-z]+)\.mjs/g)) {
        expect(SKILL_SCRIPTS[skill], `${skill}: ${name}.mjs`).toContain(name);
      }
    });

    it('uses only schema commands the CLI has', () => {
      for (const [, command] of body.matchAll(/schema\.mjs ([a-z-]+)/g)) expect(SCHEMA_COMMANDS).toContain(command);
    });
  });
});
