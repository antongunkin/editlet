// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateTypes } from './generate';
import { parseSchemaText } from './schema';

const fixture = path.join(import.meta.dirname, '../__fixtures__/survey/cms/schema.json');
const references = path.join(import.meta.dirname, 'references.ts').replaceAll('\\', '/');

/** App code reading the survey tree; every line must type-check, every `@ts-expect-error` must be an error. */
const usage = `
import type { Resolved } from '${references}';
import type { EntryMap, OptionEntry, PageEntry, QuestionEntry, SurveyEntry } from './content';

declare const s4: Resolved<EntryMap, SurveyEntry, 4>;
const section = s4.data.sections![0]!;
const title: string = section.data.title;
const order: number = section.data.order;
const question = section.data.questions![0]!;
const prompt: string = question.data.prompt;
const kind: 'single' | 'text' | 'scale' = question.data.kind;
const mandatory: boolean | undefined = question.data.mandatory;
const image: { src: string; alt: string } | undefined = question.data.image;
const option = question.data.options![0]!;
const label: string = option.data.label;
const score: number | undefined = option.data.score;
const correct: boolean | undefined = option.data.correct;
// Level 4 (option.followUp) is an entry with raw references: the depth ran out.
const back: QuestionEntry | undefined = option.data.followUp;
const raw: \`option/\${string}\`[] | undefined = option.data.followUp?.data.options;
// The singleton target and the next question are single references: they may be a dropped draft.
const brand: string | undefined = s4.data.brand?.data.name;
const next: string | undefined = question.data.next?.data.prompt;
// The collection tells resolved entries apart.
const collection: 'option' = option.collection;
const body: string = question.body;

// @ts-expect-error a single resolved reference may be missing
const strict: string = question.data.next.data.prompt;
// @ts-expect-error not a field of section
section.data.nope;
// @ts-expect-error at level 4 references are strings
option.data.followUp?.data.options?.[0]?.data;

declare const s0: Resolved<EntryMap, SurveyEntry, 0>;
const ref: \`section/\${string}\` = s0.data.sections![0]!;
const same: SurveyEntry = s0;
// @ts-expect-error depth 0 keeps the reference string
s0.data.sections![0]!.data;

declare const s1: Resolved<EntryMap, SurveyEntry, 1>;
const ids: \`question/\${string}\`[] | undefined = s1.data.sections![0]!.data.questions;

// A depth only known at run time: every level is an entry or a reference string.
declare const sn: Resolved<EntryMap, SurveyEntry, number>;
const either = sn.data.sections![0]!;
const sectionTitle: string = typeof either === 'string' ? either : either.data.title;

// A select option value that looks like a reference is not one.
interface Tricky {
  a: { collection: 'a'; slug: string; data: { kind?: 'a/x' | 'b'; link?: \`a/\${string}\` }; body: string };
}
declare const t: Resolved<Tricky, Tricky['a'], 1>;
const tk: 'a/x' | 'b' | undefined = t.data.kind;
const tl: string | undefined = t.data.link?.data.kind;

declare const o: Resolved<EntryMap, OptionEntry, 2>;
const deep: string | undefined = o.data.followUp?.data.options?.[0]?.data.label;

// P22: references inside blocks resolve on the page's level; blocks narrow by \`block\`.
declare const page: Resolved<EntryMap, PageEntry, 2>;
const blockTexts: string[] = [];
for (const b of page.data.content ?? []) {
  if (b.block === 'survey') {
    const surveyTitle: string | undefined = b.survey?.data.title;
    const firstSection: string | undefined = b.survey?.data.sections?.[0]?.data.title;
    // Depth 2: page → survey → sections; the sections' questions are strings.
    const qs: \`question/\${string}\`[] | undefined = b.survey?.data.sections?.[0]?.data.questions;
    blockTexts.push(surveyTitle ?? '', firstSection ?? '', ...(qs ?? []));
  } else if (b.block === 'hero') {
    const url: string | undefined = b.cta?.url;
    const src: string | undefined = b.image?.src;
    blockTexts.push(b.title, url ?? '', src ?? '');
  } else if (b.block === 'features') {
    blockTexts.push(...(b.items ?? []).map((i) => i.title));
  } else if (b.block === 'prose') {
    blockTexts.push(b.text);
  } else {
    const role: 'customer' | 'team' | undefined = b.by?.role;
    blockTexts.push(b.text, role ?? '');
  }
}
// @ts-expect-error a hero block has no survey
page.data.content?.filter((b) => b.block === 'hero').map((b) => b.survey);
const seo: string | undefined = page.data.seo?.description;
const low: string | undefined = question.data.scale?.labels?.low;

export { blockTexts, seo, low };
export { title, order, prompt, kind, mandatory, image, label, score, correct, back, raw, brand, next, collection };
export { body, strict, ref, same, ids, sectionTitle, tk, tl, deep };
`;

describe('Resolved over the generated content.d.ts', () => {
  it('types the survey tree under tsc --strict', () => {
    const schema = parseSchemaText(fs.readFileSync(fixture, 'utf8'), 'cms/schema.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editlet-resolved-'));
    try {
      fs.writeFileSync(path.join(dir, 'content.d.ts'), generateTypes(schema));
      const file = path.join(dir, 'usage.ts');
      fs.writeFileSync(file, usage);
      const args = ['tsc', '--noEmit', '--strict', '--ignoreConfig', '--skipLibCheck'];
      const options = ['--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler'];
      let output = '';
      try {
        execFileSync('npx', [...args, ...options, file], { stdio: 'pipe' });
      } catch (error) {
        output = String((error as { stdout?: Buffer }).stdout ?? error);
      }
      expect(output).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
