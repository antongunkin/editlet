import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useFullFileProblems } from './fullFileProblems.test-helper';
import { useEntryProblems } from './useModelData';

import { parseSchemaText } from '../../../core/schema';
import { createMemorySource, type ContentSource } from '../../../core/source';
import { invalidateFiles, type SchemaData } from '../data/queries';
import { SourceProvider } from '../source/context';
import { createTestQueryClient } from '../test/render';

// The Content model problems from summaries and the suspects' files, against the phase 1 answer (every file read).

type Files = Record<string, string | Uint8Array>;

const SURVEY = join(import.meta.dirname, '../../../__fixtures__/survey');
// The demo site of the development repo; the public mirror holds only the package.
const DEMO = join(import.meta.dirname, '../../../../..');
const hasDemo = existsSync(join(DEMO, 'cms/schema.json'));
const SCHEMA_PATH = 'cms/schema.json';
const LOAD = { timeout: 15_000 };

/** The `cms/` directory of `root` as source files: text for entries and the schema, bytes for the rest. */
function filesOf(root: string): Files {
  const out: Files = {};
  for (const e of readdirSync(join(root, 'cms'), { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const abs = join(e.parentPath, e.name);
    const path = relative(root, abs).split(sep).join('/');
    out[path] = /\.(md|json)$/.test(path) ? readFileSync(abs, 'utf8') : new Uint8Array(readFileSync(abs));
  }
  return out;
}

const schemaData = (files: Files): SchemaData => ({
  schema: parseSchemaText(files[SCHEMA_PATH] as string, SCHEMA_PATH),
  schemaPath: SCHEMA_PATH,
});

const md = (frontmatter: string, body = '') => `---\n${frontmatter}\n---\n${body}`;

/** One page load: a new query client over `source`. */
function load(hook: typeof useEntryProblems, source: ContentSource, data: SchemaData) {
  const client = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SourceProvider source={source}>{children}</SourceProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => hook(data), { wrapper });
  const settled = async () => {
    await waitFor(() => expect(view.result.current.pending).toBe(false), LOAD);
    return view.result.current.problems;
  };
  /** The files parsed and kept in full. */
  const fullFiles = () =>
    client
      .getQueryCache()
      .findAll({ queryKey: ['file'] })
      .filter((q) => q.state.fetchStatus !== 'idle' || q.state.status !== 'pending')
      .map((q) => q.queryKey[1] as string)
      .toSorted();
  return { client, view, settled, fullFiles };
}

/** Both ways over the same files; they must agree. Returns the problems and what the new way read in full. */
async function compare(files: Files, data = schemaData(files)) {
  const phase1 = load(useFullFileProblems, createMemorySource(files), data);
  const expected = await phase1.settled();
  const phase2 = load(useEntryProblems, createMemorySource(files), data);
  expect(await phase2.settled()).toStrictEqual(expected);
  return {
    files: expected.map((p) => p.file),
    messages: (file: string) => expected.find((p) => p.file === file)?.issues.map((i) => `${i.path}: ${i.message}`),
    fullFiles: phase2.fullFiles(),
  };
}

const content = (path: string) => `cms/content/${path}`;

/** The survey fixture, with a reference field inside the `seo` object (the fixture's objects hold none). */
function survey(): Files {
  const files = filesOf(SURVEY);
  const schema = JSON.parse(files[SCHEMA_PATH] as string);
  schema.collections.page.fields.seo.fields.related = { type: 'reference', label: 'Related', collections: ['survey'] };
  return { ...files, [SCHEMA_PATH]: JSON.stringify(schema) };
}

const surveyBroken: Files = {
  [content('question/wrong-type.md')]: md('prompt: Q\nkind: single\nweight: heavy'),
  [content('option/no-label.md')]: md('score: 1'),
  [content('question/bad-ref.md')]: md('prompt: Q\nkind: single\nnext: question/nobody'),
  [content('page/bad-object-ref.md')]: md('title: P\nseo:\n  related: survey/nobody'),
  [content('page/bad-block-ref.md')]: md('title: P\ncontent:\n  - block: survey\n    survey: survey/nobody'),
  [content('question/no-image.md')]: md('prompt: Q\nkind: single\nimage:\n  src: role/none.webp\n  alt: x'),
  [content('page/no-nested-image.md')]: md(
    'title: P\ncontent:\n  - block: features\n    items:\n      - title: F\n        icon:\n          src: none.webp\n          alt: x',
  ),
  [content('question/outside-image.md')]: md('prompt: Q\nkind: single\nimage:\n  src: ../../../outside.png\n  alt: x'),
  [content('question/url-image.md')]: md(
    'prompt: Q\nkind: single\nimage:\n  src: https://example.test/a.png\n  alt: x',
  ),
  [content('option/Bad_Slug.md')]: md('label: Fine but for its name'),
  // The same content as a file with a good slug: one summary, two answers.
  [content('option/same-text.md')]: md('label: Twin'),
  [content('option/Same_Text.md')]: md('label: Twin'),
  [content('option/broken.md')]: '---\nlabel: [\n---\n',
  // The same broken content under another name: each error names its own file.
  [content('option/broken-too.md')]: '---\nlabel: [\n---\n',
  [content('option/not-utf8.md')]: new Uint8Array([0xff, 0xfe, 0x00]),
  [content('option/fine.md')]: md('label: Fine'),
  [content('option/notes.txt')]: 'not an entry',
};

const featureIcon = (src: string) =>
  `title: P\ncontent:\n  - block: features\n    items:\n      - title: F\n        icon:\n          src: ${src}\n          alt: x`;

/** The survey's image fields with a `src` that no file can answer: reported without the tree. */
const surveyImageSrc: Files = {
  [content('question/absolute-image.md')]: md('prompt: Q\nkind: single\nimage:\n  src: /img.png\n  alt: x'),
  [content('page/nested-url-image.md')]: md(featureIcon('https://example.test/a.png')),
  [content('page/nested-absolute-image.md')]: md(featureIcon('/img.png')),
};

const bodyImages = [
  '![gone](none.png)',
  '![gone below](gone/none.webp)',
  '![remote](https://example.test/a.png)',
  '![absolute](/img.png)',
  '<img src="../../../outside.png" alt="outside">',
].join('\n');

/** Body and Markdown-string images are not validated: no problem, so no full read. */
const surveyBodyImages: Files = {
  [content('question/body-images.md')]: md('prompt: Q\nkind: single', `${bodyImages}\n`),
  [content('page/markdown-images.md')]: md(
    'title: P\ncontent:\n  - block: prose\n    text: "![gone](none.png) ![remote](https://example.test/a.png)"',
  ),
};

const demoBroken: Files = {
  [content('post/wrong-type.md')]: md('title: T\ntags: one'),
  [content('post/no-title.md')]: md('publishedAt: "2026-01-01T00:00:00.000Z"'),
  [content('homeSection/bad-ref.md')]: md('title: S\nlayout: nope\nart: image/nobody'),
  [content('homeGroup/bad-list-ref.md')]: md('title: G\nsections:\n  - homeSection/nobody'),
  [content('image/no-file.md')]: md('title: I\nfile:\n  src: gone/none.webp\n  alt: x\nwidth: 1\nheight: 1'),
  [content('image/outside.md')]: md('title: I\nfile:\n  src: ../../../none.webp\n  alt: x\nwidth: 1\nheight: 1'),
  [content('post/Bad_Slug.md')]: md('title: Bad slug'),
  [content('post/broken.md')]: '---\ntitle: [\n---\n',
  [content('post/fine.md')]: md('title: Fine'),
};

const demoImageSrc: Files = {
  [content('post/url-image.md')]: md('title: T\nfeaturedImage:\n  src: https://example.test/a.png\n  alt: x'),
  [content('post/absolute-image.md')]: md('title: T\nfeaturedImage:\n  src: /img.png\n  alt: x'),
};

const demoBodyImages: Files = {
  [content('post/body-images.md')]: md('title: Pictures', `${bodyImages}\n`),
};

describe('useEntryProblems over the survey fixture', () => {
  it('reads no file in full while there is no problem', async () => {
    const out = await compare(survey());
    expect(out).toMatchObject({ files: [], fullFiles: [] });
  });

  it('lists the phase 1 problems, reading only the suspects', async () => {
    const out = await compare({ ...survey(), ...surveyBroken, ...surveyImageSrc, ...surveyBodyImages });
    const broken = [
      'option/Bad_Slug.md',
      'option/Same_Text.md',
      'option/broken-too.md',
      'option/broken.md',
      'option/no-label.md',
      'option/not-utf8.md',
      'option/notes.txt',
      'page/bad-block-ref.md',
      'page/bad-object-ref.md',
      'page/no-nested-image.md',
      'question/bad-ref.md',
      'question/no-image.md',
      'question/outside-image.md',
      'question/url-image.md',
      'question/wrong-type.md',
      ...Object.keys(surveyImageSrc).map((path) => path.slice(content('').length)),
    ].map(content);
    expect(out.files.toSorted()).toEqual(broken.toSorted());
    expect(out.messages(content('question/bad-ref.md'))).toEqual(['next: Referenced entry not found: question/nobody']);
    expect(out.messages(content('question/no-image.md'))).toEqual([
      'image.src: Image file not found: cms/content/question/role/none.webp',
    ]);
    expect(out.messages(content('option/Same_Text.md'))?.[0]).toContain('Invalid slug "Same_Text"');
    // One full read per broken entry (the text file is not one) and none for the body and Markdown images.
    expect(out.fullFiles).toEqual(broken.filter((p) => p.endsWith('.md')).toSorted());
  });

  it('finds what a change of the tree breaks, with the summaries unchanged', async () => {
    const files = survey();
    const data = schemaData(files);
    const source = createMemorySource(files);
    const readFile = vi.spyOn(source, 'readFile');
    const page = load(useEntryProblems, source, data);
    expect(await page.settled()).toEqual([]);
    readFile.mockClear();

    // An entry something references and an image something shows are deleted.
    const gone = [content('option/age-adult.md'), content('question/role/diagram.webp')];
    // As after a merge on GitHub: `commit` would refuse to delete what is referenced.
    const list = source.listFiles.bind(source);
    vi.spyOn(source, 'listFiles').mockImplementation(async () => (await list()).filter((f) => !gone.includes(f.path)));
    await act(() => invalidateFiles(page.client));
    await waitFor(() => expect(page.view.result.current.problems.length).toBeGreaterThan(1), LOAD);
    const problems = await page.settled();

    const after = Object.fromEntries(Object.entries(files).filter(([path]) => !gone.includes(path)));
    const phase1 = load(useFullFileProblems, createMemorySource(after), data);
    expect(problems).toStrictEqual(await phase1.settled());
    // Only the referrers are read, in full: no summary is made again.
    expect(page.fullFiles()).toEqual(problems.map((p) => p.file));
    expect(readFile.mock.calls.map(([path]) => path).toSorted()).toEqual(problems.map((p) => p.file));
  });
});

describe.skipIf(!hasDemo)('useEntryProblems over the demo site', () => {
  it('reads no file in full while there is no problem', async () => {
    const out = await compare(filesOf(DEMO));
    expect(out).toMatchObject({ files: [], fullFiles: [] });
  });

  it('lists the phase 1 problems, reading only the suspects', async () => {
    const out = await compare({ ...filesOf(DEMO), ...demoBroken, ...demoImageSrc, ...demoBodyImages });
    const broken = Object.keys({ ...demoBroken, ...demoImageSrc }).filter((path) => path !== content('post/fine.md'));
    expect(out.files.toSorted()).toEqual(broken.toSorted());
    expect(out.fullFiles).toEqual(broken.toSorted());
  });
});

// The content of `npm run bench:admin` (the demo site and generated posts), small.
const GENERATOR = join(DEMO, 'benchmarks/content/posts.mjs');

describe.skipIf(!hasDemo || !existsSync(GENERATOR))('useEntryProblems over the bench content', () => {
  it('reads in full exactly the entries with problems', async () => {
    const out = mkdtempSync(join(tmpdir(), 'editlet-model-'));
    try {
      execFileSync(process.execPath, [GENERATOR, '--count', '200', '--seed', '1', '--out', out], { stdio: 'ignore' });
      const files = { ...filesOf(DEMO), ...filesOf(out) };
      expect(await compare(files)).toMatchObject({ files: [], fullFiles: [] });

      const withProblems = await compare({ ...files, ...demoBroken, ...demoImageSrc, ...demoBodyImages });
      expect(withProblems.fullFiles).toEqual(withProblems.files.toSorted());
      expect(withProblems.files).toHaveLength(Object.keys({ ...demoBroken, ...demoImageSrc }).length - 1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
