// @vitest-environment node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { generateTypes } from '../core/generate';
import { parseSchemaText } from '../core/schema';

const repo = path.join(import.meta.dirname, '../../..');
const fixture = path.join(import.meta.dirname, '../__fixtures__/survey/cms/schema.json');
const reader = path.join(import.meta.dirname, 'reader.ts').replaceAll('\\', '/');

/**
 * A Next.js page over the survey: the depth literal in the call types the tree, with no annotation. Every line must
 * type-check; every `@ts-expect-error` must be an error.
 */
const page = `
import { createReader } from '${reader}';
import type { EntryMap } from './content';

const { getEntries, getEntry, getRef, getReferrers } = createReader<EntryMap>();

export async function SurveyPage({ slug }: { slug: string }) {
  const survey = await getEntry('survey', slug, { depth: 3 });
  if (!survey) return null;
  const title: string = survey.data.title;
  const accent: string | undefined = survey.data.brand?.data.accent;
  const rows: string[] = [];
  for (const section of survey.data.sections ?? []) {
    rows.push(section.data.title);
    for (const question of section.data.questions ?? []) {
      const kind: 'single' | 'text' | 'scale' = question.data.kind;
      const labels: string[] = (question.data.options ?? []).map((option) => option.data.label);
      // Level 4 is past depth 3: a reference string again.
      const back: \`question/\${string}\` | undefined = question.data.options?.[0]?.data.followUp;
      rows.push(kind, ...labels, back ?? '');
    }
  }
  return { title, accent, rows };
}

export async function lists() {
  // No depth: plain reference strings, as before P20.
  const flat = await getEntries('survey');
  const ids: \`section/\${string}\`[] | undefined = flat[0]?.data.sections;
  // @ts-expect-error without depth a reference is a string
  flat[0]?.data.sections?.[0]?.data;

  const one = await getEntries('survey', { depth: 1 });
  const sectionTitle: string | undefined = one[0]?.data.sections?.[0]?.data.title;

  const age = await getRef('question/age', { depth: 2 });
  const followUp: string | undefined = age?.data.options?.[1]?.data.followUp?.data.prompt;

  // getReferrers: \`from\` types the entries, depth resolves them.
  const sections = await getReferrers('question/age', { from: 'section', depth: 1 });
  const prompt: string | undefined = sections[0]?.data.questions?.[0]?.data.prompt;
  // @ts-expect-error a section has no prompt
  sections[0]?.data.prompt;

  // @ts-expect-error not a collection
  await getEntries('nope');
  // @ts-expect-error not a reference of this site
  await getRef('nope/x');
  return { ids, sectionTitle, followUp, prompt };
}
`;

describe('createReader types for a Next.js page (survey fixture)', () => {
  it('infers the depth and types the tree under tsc --strict', () => {
    const schema = parseSchemaText(fs.readFileSync(fixture, 'utf8'), 'cms/schema.json');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'editlet-next-types-'));
    try {
      fs.writeFileSync(path.join(dir, 'content.d.ts'), generateTypes(schema));
      const file = path.join(dir, 'page.ts');
      fs.writeFileSync(file, page);
      const args = [
        'tsc',
        '--noEmit',
        '--strict',
        '--ignoreConfig',
        '--skipLibCheck',
        '--allowImportingTsExtensions',
        '--target',
        'es2022',
      ];
      const resolution = ['--module', 'esnext', '--moduleResolution', 'bundler', '--lib', 'es2023,dom'];
      const types = ['--typeRoots', path.join(repo, 'node_modules/@types'), '--types', 'node,react'];
      let output = '';
      try {
        execFileSync('npx', [...args, ...resolution, ...types, file], { stdio: 'pipe', cwd: repo });
      } catch (error) {
        output = String((error as { stdout?: Buffer }).stdout ?? error);
      }
      expect(output).toBe('');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
