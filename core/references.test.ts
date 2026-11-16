// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { refKey } from './paths';
import {
  checkReferenceDepth,
  createResolver,
  entryReferences,
  findReferrers,
  MAX_REFERENCE_DEPTH,
  referenceFields,
} from './references';
import type { Entry } from './validate';

import { readProject, validateProject } from '../node/project';

const survey = join(import.meta.dirname, '../__fixtures__/survey');
const temps: string[] = [];

afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function copy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'editlet-survey-'));
  temps.push(root);
  await cp(survey, root, { recursive: true });
  return root;
}

async function load(drafts = true) {
  const { schema, entries } = await readProject(survey);
  const byRef = new Map(entries.map((e) => [refKey(e.collection, e.slug), e]));
  const lookup = (ref: string) => {
    const found = byRef.get(ref);
    return found && (drafts || found.data.draft !== true) ? found : undefined;
  };
  return { schema, entries, byRef, resolve: createResolver<Entry>(schema, lookup) };
}

type Tree = { slug: string; data: Record<string, unknown> };
const data = (e: unknown) => (e as Tree).data;
const list = (e: unknown, field: string) => data(e)[field] as Tree[];

describe('the survey fixture', () => {
  it('is valid: the cycle and the draft are not issues', async () => {
    expect(await validateProject(survey)).toEqual([]);
  });

  it('reports a broken reference at the level where it is', async () => {
    const root = await copy();
    const file = join(root, 'cms/content/option/rating-high.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('question/role', 'question/gone'));
    expect(await validateProject(root)).toEqual([
      {
        file: 'cms/content/option/rating-high.md',
        path: 'followUp',
        message: 'Referenced entry not found: question/gone',
      },
    ]);
  });

  it('reports a broken item of a list by its index', async () => {
    const root = await copy();
    const file = join(root, 'cms/content/section/about-you.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('question/role', 'question/gone'));
    const issues = await validateProject(root);
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual([
      'questions.1: Referenced entry not found: question/gone',
    ]);
  });

  it('reports a reference to a collection the field does not allow', async () => {
    const root = await copy();
    const file = join(root, 'cms/content/survey/pulse.md');
    await writeFile(file, (await readFile(file, 'utf8')).replace('section/feedback', 'question/age'));
    const issues = await validateProject(root);
    expect(issues.map((i) => `${i.path}: ${i.message}`)).toEqual(['sections.0: Must reference an entry in: section']);
  });
});

describe('referenceFields and entryReferences', () => {
  it('lists reference fields in schema order and their values in list order', async () => {
    const { schema, byRef } = await load();
    expect(referenceFields(schema.collections.question!).map(([k]) => k)).toEqual(['options', 'next']);
    const age = byRef.get('question/age')!;
    expect(entryReferences(schema.collections.question!, age.data)).toEqual([
      { field: 'options', ref: 'option/age-young' },
      { field: 'options', ref: 'option/age-adult' },
      { field: 'options', ref: 'option/age-draft' },
    ]);
  });
});

describe('findReferrers', () => {
  it('finds every entry that points at a ref, with the fields', async () => {
    const { schema, entries } = await load();
    const feedback = findReferrers(schema, entries, 'section/feedback');
    expect(feedback.map((r) => [refKey(r.entry.collection, r.entry.slug), r.fields])).toEqual([
      ['survey/onboarding', ['sections']],
      ['survey/pulse', ['sections']],
    ]);
    const age = findReferrers(schema, entries, 'question/age');
    expect(age.map((r) => refKey(r.entry.collection, r.entry.slug))).toEqual(['option/age-adult', 'section/about-you']);
    expect(findReferrers(schema, entries, 'brand/index').map((r) => r.entry.slug)).toEqual(['onboarding']);
    expect(findReferrers(schema, entries, 'survey/pulse')).toEqual([]);
  });
});

describe('createResolver', () => {
  it('keeps the entry at depth 0', async () => {
    const { byRef, resolve } = await load();
    const onboarding = byRef.get('survey/onboarding')!;
    expect(resolve(onboarding, 0)).toBe(onboarding);
  });

  it('resolves survey → section → question → option, every field type intact', async () => {
    const { byRef, resolve } = await load();
    const tree = resolve(byRef.get('survey/onboarding')!, 4);
    expect(tree.body).toContain('**Five minutes**');
    expect(data(tree)).toMatchObject({ title: 'Onboarding survey', status: 'open' });
    expect(data(data(tree).brand)).toEqual({
      name: 'Acme Research',
      accent: '#1f6feb',
      logo: { src: 'logo.webp', alt: 'Acme logo' },
    });

    const sections = list(tree, 'sections');
    expect(sections.map((s) => s.slug)).toEqual(['about-you', 'feedback']);
    expect(data(sections[0]).order).toBe(1);

    const [age, role] = list(sections[0], 'questions');
    expect(data(age)).toMatchObject({ prompt: 'How old are you?', kind: 'single', mandatory: true, weight: 1 });
    expect(data(role).image).toEqual({ src: 'role/diagram.webp', alt: 'Team roles' });
    // `next` of a level-3 question is level 4, its options level 5: entries whose own references stay strings.
    const next = data(role).next;
    expect(data(next)).toMatchObject({ prompt: 'How likely are you to recommend us?' });
    expect(list(next, 'options').map((o) => o.data)).toEqual([
      { label: 'Not likely', score: 0 },
      { label: 'Very likely', score: 10, followUp: 'question/role' },
    ]);

    const options = list(age, 'options');
    expect(options.map((o) => data(o).label)).toEqual(['Under 18', '18 or older', 'Prefer not to say']);
    expect(data(options[0])).toEqual({ label: 'Under 18', score: 0, correct: false });
    expect(data(options[2])).toEqual({ label: 'Prefer not to say', draft: true });
    // The cycle back to question/age, at level 5: an entry, its options strings again.
    const followUp = data(options[1]).followUp as Tree;
    expect(followUp.slug).toBe('age');
    expect(followUp.data.options).toEqual(['option/age-young', 'option/age-adult', 'option/age-draft']);
  });

  it('stops a cycle when the depth runs out', async () => {
    const { byRef, resolve } = await load();
    const age = resolve(byRef.get('question/age')!, 3);
    const adult = list(age, 'options')[1]!;
    const again = data(adult).followUp as Tree;
    expect(again.slug).toBe('age');
    const adultAgain = list(again, 'options')[1]!;
    expect(adultAgain.data.followUp).toBe('question/age');
    expect(JSON.parse(JSON.stringify(age))).toEqual(age);
  });

  it('drops references that lookup does not find: list items and single fields', async () => {
    const { byRef, resolve } = await load(false);
    const age = resolve(byRef.get('question/age')!, 1);
    expect(list(age, 'options').map((o) => o.slug)).toEqual(['age-young', 'age-adult']);
    const { schema } = await load();
    const noRole = createResolver<Entry>(schema, (r) => (r === 'question/rating' ? undefined : byRef.get(r)));
    const role = noRole(byRef.get('question/role')!, 1);
    expect(Object.hasOwn(role.data, 'next')).toBe(false);
  });

  it('shares a subtree between entries and keeps the input untouched', async () => {
    const { byRef, resolve } = await load();
    const onboarding = byRef.get('survey/onboarding')!;
    const before = structuredClone(onboarding);
    const a = list(resolve(onboarding, 2), 'sections')[1];
    const b = list(resolve(byRef.get('survey/pulse')!, 2), 'sections')[0];
    expect(a).toBe(b);
    expect(onboarding).toEqual(before);
  });

  it('refuses a depth outside 0…10', async () => {
    const { byRef, resolve } = await load();
    const onboarding = byRef.get('survey/onboarding')!;
    expect(() => resolve(onboarding, MAX_REFERENCE_DEPTH + 1)).toThrow(RangeError);
    expect(() => resolve(onboarding, -1)).toThrow(RangeError);
    expect(() => checkReferenceDepth(1.5)).toThrow('depth must be a whole number from 0 to 10, got 1.5');
    expect(() => resolve(onboarding, MAX_REFERENCE_DEPTH)).not.toThrow();
  });
});

describe('references inside object and blocks (page/landing)', () => {
  it('lists nested reference fields and values with their paths', async () => {
    const { schema, byRef } = await load();
    const page = schema.collections.page!;
    expect(referenceFields(page).map(([k]) => k)).toEqual(['content.survey.survey']);
    expect(entryReferences(page, byRef.get('page/landing')!.data)).toEqual([
      { field: 'content.3.survey', ref: 'survey/onboarding' },
    ]);
  });

  it('finds a page as a referrer of the survey through its block', async () => {
    const { schema, entries } = await load();
    const found = findReferrers(schema, entries, 'survey/onboarding');
    expect(found.map((r) => [refKey(r.entry.collection, r.entry.slug), r.fields])).toEqual([
      ['page/landing', ['content.3.survey']],
    ]);
  });

  it('resolves a reference in a block on the entry level: page → survey → section → question → option', async () => {
    const { byRef, resolve } = await load();
    const page = resolve(byRef.get('page/landing')!, 4);
    const blocks = page.data.content as Record<string, unknown>[];
    expect(blocks.map((b) => b.block)).toEqual(['hero', 'features', 'prose', 'survey', 'quote']);
    const survey = blocks[3]!.survey as Tree;
    expect(survey.data.title).toBe('Onboarding survey');
    const [aboutYou] = list(survey, 'sections');
    const [age] = list(aboutYou, 'questions');
    expect(list(age, 'options').map((o) => o.data.label)).toEqual(['Under 18', '18 or older', 'Prefer not to say']);
    // Everything else in the blocks is kept as it is.
    expect(blocks[0]).toMatchObject({ title: 'Your opinion, five minutes a month', cta: { label: 'Start' } });
    expect(blocks[3]!.note).toBe('Takes five minutes.');
  });

  it('drops a hidden target inside a block like at the top', async () => {
    const { schema, byRef } = await load();
    const hidden = createResolver<Entry>(schema, (r) => (r === 'survey/onboarding' ? undefined : byRef.get(r)));
    const blocks = hidden(byRef.get('page/landing')!, 1).data.content as Record<string, unknown>[];
    expect(Object.hasOwn(blocks[3]!, 'survey')).toBe(false);
    expect(blocks[3]!.note).toBe('Takes five minutes.');
  });
});
