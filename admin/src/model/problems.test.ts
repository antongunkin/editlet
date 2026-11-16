import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryProblems, problemCandidates, type ReadResult } from './problems';

import { parseEntryFile } from '../../../core/entryFile';
import { loadSchema } from '../../../core/schema';
import type { FileRef } from '../../../core/source';

const FIXTURE_SITE = join(__dirname, '../../../node/__fixtures__/site');

/** Fixture text files by path (not `fixtureFiles()`: importing the test renderer pulls in the whole App). */
function fixtureFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of readdirSync(FIXTURE_SITE, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath, e.name);
    out[relative(FIXTURE_SITE, abs).split(sep).join('/')] = /\.(md|json)$/.test(e.name)
      ? readFileSync(abs, 'utf8')
      : '';
  }
  return out;
}

const schema = loadSchema(
  JSON.parse(readFileSync(join(__dirname, '../../../node/__fixtures__/site/cms/schema.json'), 'utf8')),
);
const SCHEMA_PATH = 'cms/schema.json';
const ref = (path: string): FileRef => ({ path, sha: 'x' });
const fixtureRefs = () => Object.keys(fixtureFiles()).map(ref);
const readText = (text: string): ReadResult => ({ file: parseEntryFile(text) });

describe('problemCandidates', () => {
  it('skips the schema, images, hidden and outside paths', () => {
    const files = [
      ...fixtureRefs(),
      ref('cms/content/.hidden.md'),
      ref('other/readme.md'),
      ref('cms/content/post/notes.txt'),
    ];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const paths = candidates.map((c) => c.path);
    expect(paths).not.toContain(SCHEMA_PATH);
    expect(paths).not.toContain('cms/content/post/hello-world/cover.webp');
    expect(paths).not.toContain('cms/content/.hidden.md');
    expect(paths).not.toContain('other/readme.md');
    expect(candidates.find((c) => c.path === 'cms/content/post/notes.txt')?.entry).toBeNull();
    expect(candidates.find((c) => c.path.startsWith('cms/content/post/') && c.entry)?.entry?.collection).toBe('post');
  });
});

const run = (files: FileRef[]) => {
  const candidates = problemCandidates(schema, SCHEMA_PATH, files);
  const texts = fixtureFiles();
  const results = candidates.map((c) => (c.entry ? readText(texts[c.path]) : undefined));
  return entryProblems(schema, files, candidates, results);
};

describe('entryProblems', () => {
  it('reports no problems for the valid fixture', () => {
    const files = fixtureRefs();
    const out = run(files);
    expect(out).toEqual({ problems: [], pending: false });
  });

  it('flags a non-entry file without reading it', () => {
    const files = [...fixtureRefs(), ref('cms/content/post/notes.txt')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const results = candidates.map(() => undefined);
    const { problems } = entryProblems(schema, files, candidates, results);
    expect(problems).toEqual([
      {
        file: 'cms/content/post/notes.txt',
        entry: null,
        issues: [{ file: 'cms/content/post/notes.txt', path: '', message: 'Not an entry file' }],
      },
    ]);
  });

  it('reports read issues as they are', () => {
    const files = [ref('cms/content/post/a.md')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const issue = { file: 'cms/content/post/a.md', path: '', message: 'Bad front matter' };
    const out = entryProblems(schema, files, candidates, [{ issues: [issue] }]);
    expect(out.problems).toEqual([{ file: 'cms/content/post/a.md', entry: candidates[0].entry, issues: [issue] }]);
    expect(out.pending).toBe(false);
  });

  it('reports a missing required field', () => {
    const files = [ref('cms/content/post/a.md')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const out = entryProblems(schema, files, candidates, [readText('---\nauthor: author/jane\n---\n')]);
    expect(out.problems[0].issues).toContainEqual(expect.objectContaining({ path: 'title', message: 'Required' }));
  });

  it('reports a reference to a missing entry', () => {
    const files = [ref('cms/content/post/a.md')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const out = entryProblems(schema, files, candidates, [readText('---\ntitle: A\nauthor: author/nobody\n---\n')]);
    expect(out.problems[0].issues.map((i) => i.message)).toContain('Referenced entry not found: author/nobody');
  });

  it('reports a missing image file', () => {
    const files = [ref('cms/content/post/a.md')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const text = '---\ntitle: A\nfeaturedImage:\n  src: ./missing.webp\n  alt: x\n---\n';
    const out = entryProblems(schema, files, candidates, [readText(text)]);
    expect(out.problems[0].issues.some((i) => i.message.startsWith('Image file not found'))).toBe(true);
  });

  it('is pending while a file loads but still reports the others, sorted by file', () => {
    const files = [ref('cms/content/post/b.md'), ref('cms/content/post/a.md'), ref('cms/content/post/c.md')];
    const candidates = problemCandidates(schema, SCHEMA_PATH, files);
    const bad = readText('---\nauthor: author/jane\n---\n');
    const out = entryProblems(schema, files, candidates, [bad, bad, undefined]);
    expect(out.pending).toBe(true);
    expect(out.problems.map((p) => p.file)).toEqual(['cms/content/post/a.md', 'cms/content/post/b.md']);
  });
});
