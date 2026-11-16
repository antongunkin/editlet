// @vitest-environment node
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { EditletError } from './issues';
import { refKey } from './paths';
import { replaceReference } from './references';
import { planRemove, planRename } from './rename';
import { validateEntry } from './validate';

import { listFiles } from '../node/fs';
import { readProject } from '../node/project';

const root = join(import.meta.dirname, '../__fixtures__/survey');

async function load() {
  const { schema, entries } = await readProject(root);
  const files = await listFiles(root, schema.contentDir);
  return { schema, entries, files };
}

const errorOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(EditletError);
    return (e as EditletError).issues[0]!.message;
  }
  throw new Error('expected an EditletError');
};

describe('replaceReference', () => {
  it('renames in lists and single fields, removes from lists and drops single keys, at any depth', async () => {
    const { schema, entries } = await load();
    const byRef = new Map(entries.map((e) => [refKey(e.collection, e.slug), e]));
    const section = schema.collections.section!;
    const aboutYou = byRef.get('section/about-you')!.data;
    expect(replaceReference(section, aboutYou, 'question/role', 'question/team')?.questions).toEqual([
      'question/age',
      'question/team',
    ]);
    expect(replaceReference(section, aboutYou, 'question/role', null)?.questions).toEqual(['question/age']);
    expect(replaceReference(section, aboutYou, 'question/nope', null)).toBeNull();
    const question = schema.collections.question!;
    const removed = replaceReference(question, byRef.get('question/role')!.data, 'question/rating', null)!;
    expect(Object.hasOwn(removed, 'next')).toBe(false);
    const page = schema.collections.page!;
    const landing = byRef.get('page/landing')!.data;
    const blocks = replaceReference(page, landing, 'survey/onboarding', 'survey/welcome')!.content as Record<
      string,
      unknown
    >[];
    expect(blocks[3]).toMatchObject({ block: 'survey', survey: 'survey/welcome' });
    expect(landing.content).not.toBe(blocks);
  });
});

describe('planRename', () => {
  it('moves the entry and its folder, and rewrites references and image sources', async () => {
    const { schema, entries, files } = await load();
    const plan = planRename(schema, entries, files, 'question/role', 'team-role');
    expect(plan.to).toBe('question/team-role');
    expect(plan.remove).toEqual(['cms/content/question/role.md']);
    expect(plan.move).toEqual([
      { from: 'cms/content/question/role/diagram.webp', to: 'cms/content/question/team-role/diagram.webp' },
    ]);
    expect(plan.write.map((w) => [w.path, w.reasons])).toEqual([
      ['cms/content/question/team-role.md', ['renamed', 'images']],
      ['cms/content/option/rating-high.md', ['references']],
      ['cms/content/section/about-you.md', ['references']],
    ]);
    const self = plan.write[0]!;
    expect(self.data.image).toEqual({ src: 'team-role/diagram.webp', alt: 'Team roles' });
    expect(self.data.next).toBe('question/rating');
    expect(plan.write[1]!.data.followUp).toBe('question/team-role');
    expect(plan.write[2]!.data.questions).toEqual(['question/age', 'question/team-role']);
  });

  it('rewrites a reference inside a block, and the entry pointing at itself', async () => {
    const { schema, entries, files } = await load();
    const survey = planRename(schema, entries, files, 'survey/onboarding', 'welcome');
    const page = survey.write.find((w) => w.entry.collection === 'page')!;
    expect((page.data.content as Record<string, unknown>[])[3]!.survey).toBe('survey/welcome');
    const age = planRename(schema, entries, files, 'question/age', 'how-old');
    expect(age.write.map((w) => w.path)).toEqual([
      'cms/content/question/how-old.md',
      'cms/content/option/age-adult.md',
      'cms/content/section/about-you.md',
    ]);
    // The cycle back: the option now points at the new slug.
    expect(age.write[1]!.data.followUp).toBe('question/how-old');
  });

  it('keeps every rewritten entry valid against the moved files', async () => {
    const { schema, entries, files } = await load();
    const plan = planRename(schema, entries, files, 'page/landing', 'join');
    expect(plan.move.map((m) => m.to)).toEqual([
      'cms/content/page/join/chart.webp',
      'cms/content/page/join/fast.webp',
      'cms/content/page/join/hero.webp',
    ]);
    const after = new Set([
      ...files.filter((f) => !plan.move.some((m) => m.from === f)),
      ...plan.move.map((m) => m.to),
    ]);
    for (const w of plan.write) {
      const slug = w.path.slice(w.path.lastIndexOf('/') + 1, -3);
      const entry = { collection: w.entry.collection, slug, data: w.data, body: w.body };
      expect(validateEntry(schema, entry, { fileExists: (p) => after.has(p), entryExists: () => true })).toEqual([]);
    }
    const blocks = plan.write[0]!.data.content as Record<string, any>[];
    expect(blocks[0]!.image.src).toBe('join/hero.webp');
    expect(blocks[2]!.text).toContain('![Chart of answers](join/chart.webp)');
  });

  it('refuses a singleton, a bad, same or taken slug, and an unknown entry', async () => {
    const { schema, entries, files } = await load();
    expect(errorOf(() => planRename(schema, entries, files, 'brand/index', 'other'))).toContain('singleton');
    expect(errorOf(() => planRename(schema, entries, files, 'question/role', 'Team Role'))).toContain('Invalid slug');
    expect(errorOf(() => planRename(schema, entries, files, 'question/role', 'role'))).toContain('same');
    expect(errorOf(() => planRename(schema, entries, files, 'question/role', 'age'))).toBe('question/age is taken');
    expect(errorOf(() => planRename(schema, entries, files, 'question/nope', 'x'))).toBe(
      'Entry not found: question/nope',
    );
  });
});

describe('planRemove', () => {
  it('removes every reference and deletes the entry file', async () => {
    const { schema, entries } = await load();
    const plan = planRemove(schema, entries, 'question/rating');
    expect(plan.remove).toEqual(['cms/content/question/rating.md']);
    expect(plan.write.map((w) => w.path)).toEqual(['cms/content/question/role.md', 'cms/content/section/feedback.md']);
    expect(Object.hasOwn(plan.write[0]!.data, 'next')).toBe(false);
    // The emptied list goes, as the editor writes it.
    expect(Object.hasOwn(plan.write[1]!.data, 'questions')).toBe(false);
  });

  it('leaves the schema check to the caller: a required reference in a block becomes an issue', async () => {
    const { schema, entries } = await load();
    const plan = planRemove(schema, entries, 'survey/onboarding');
    const page = plan.write.find((w) => w.entry.collection === 'page')!;
    const issues = validateEntry(schema, { collection: 'page', slug: 'landing', data: page.data, body: page.body });
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual(['content.3.survey: Required']);
  });
});
