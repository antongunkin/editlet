// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createReader } from './reader';

import { EditletError } from '../core/issues';
import { isImagePath } from '../core/paths';
import { listFiles } from '../node/fs';
import { readProject } from '../node/project';

const readCommit = vi.hoisted(() => vi.fn());
vi.mock('../github/commitReader', () => ({ readCommit }));

async function commitOf(root: string, drop: string[] = []) {
  const { schema } = await readProject(root, 'cms/schema.json');
  const paths = (await listFiles(root, 'cms')).filter((p) => !drop.includes(p));
  const files = new Map<string, Uint8Array>();
  for (const p of [...paths, 'cms/schema.json']) {
    if (!isImagePath(p)) files.set(p, new Uint8Array(await readFile(join(root, p))));
  }
  return { schema, files, paths: new Set([...paths, 'cms/schema.json']) };
}

const fixture = fileURLToPath(new URL('./__fixtures__/site', import.meta.url));

afterEach(() => vi.unstubAllEnvs());

describe('reader', () => {
  it('lists entries sorted by slug with normalized data', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const posts = await createReader({ root: fixture }).getEntries('post');
    expect(posts.map((p) => p.slug)).toEqual(['hello-world', 'secret']);
    for (const p of posts) {
      for (const v of Object.values(p.data)) expect(v === null || v === '').toBe(false);
    }
  });

  it('reads singletons, missing entries and refs', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const reader = createReader({ root: fixture });
    expect((await reader.getEntry('homePage'))?.data).toMatchObject({ title: 'Home' });
    expect(await reader.getEntry('post', 'nope')).toBeUndefined();
    expect((await reader.getRef('author/jane'))?.data).toMatchObject({ name: 'Jane' });
  });

  it('accepts a generated interface entry map', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    interface Map {
      homePage: { collection: 'homePage'; slug: string; data: { title?: string }; body: string };
    }
    const home = await createReader<Map>({ root: fixture }).getEntry('homePage');
    expect(home?.data.title).toBe('Home');
  });

  it('rewrites image sources to public URLs and keeps alt', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const post = await createReader({ root: fixture }).getEntry('post', 'hello-world');
    expect(post?.data.featuredImage).toEqual({
      src: '/editlet/content/post/hello-world/cover.webp',
      alt: 'Cover',
    });
  });

  it('hides drafts in production unless drafts is set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const reader = createReader({ root: fixture });
    expect((await reader.getEntries('post')).map((p) => p.slug)).toEqual(['hello-world']);
    expect(await reader.getEntry('post', 'secret')).toBeUndefined();
    expect(await reader.getRef('post/secret')).toBeUndefined();
    const all = createReader({ root: fixture, drafts: true });
    expect(await all.getEntries('post')).toHaveLength(2);
  });

  it('rejects with every issue listed', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dir = await mkdtemp(join(tmpdir(), 'editlet-reader-'));
    try {
      await cp(fixture, dir, { recursive: true });
      await rm(join(dir, 'cms/content/author/jane.md'));
      const error = await createReader({ root: dir })
        .getEntries('post')
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(EditletError);
      const message = (error as EditletError).message;
      expect(message).toContain('cms/content/post/hello-world.md: author — Referenced entry not found: author/jane');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  describe('with ref', () => {
    const ref = { branch: 'editlet/x', sha: 'a'.repeat(40) };
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('CMS_GITHUB_TOKEN', 'tok');
      vi.stubEnv(
        'EDITLET_PREVIEW',
        JSON.stringify({ owner: 'o', repo: 'r', schemaPath: 'cms/schema.json', sessionMinutes: 30 }),
      );
      readCommit.mockReset();
    });

    it('reads the commit and stamps ref', async () => {
      readCommit.mockResolvedValue(await commitOf(fixture));
      const reader = createReader({ root: '/nonexistent' });
      const posts = await reader.getEntries('post', { ref: { ...ref, sha: 'b'.repeat(40) } });
      expect(posts.map((p) => p.slug)).toEqual(['hello-world', 'secret']);
      expect(posts[0]).toMatchObject({ ref: { ...ref, sha: 'b'.repeat(40) } });
      expect(readCommit).toHaveBeenCalledWith(
        expect.objectContaining({ owner: 'o', repo: 'r', sha: 'b'.repeat(40), token: 'tok' }),
      );
      const one = await reader.getEntry('post', 'hello-world', { ref: { ...ref, sha: 'b'.repeat(40) } });
      expect(one?.data).toMatchObject({ featuredImage: { src: '/editlet/content/post/hello-world/cover.webp' } });
      expect((await reader.getRef('author/jane', { ref: { ...ref, sha: 'b'.repeat(40) } }))?.data).toMatchObject({
        name: 'Jane',
      });
    });

    it('includes draft entries in production: only a verified editor render has a ref', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      readCommit.mockResolvedValue(await commitOf(fixture));
      const reader = createReader({ root: '/nonexistent' });
      const r = { ...ref, sha: '1'.repeat(40) };
      expect((await reader.getEntries('post', { ref: r })).map((p) => p.slug)).toEqual(['hello-world', 'secret']);
      expect((await reader.getEntry('post', 'secret', { ref: r }))?.slug).toBe('secret');
      expect((await reader.getRef('post/secret', { ref: r }))?.slug).toBe('secret');
    });

    it('reads a sha once', async () => {
      readCommit.mockResolvedValue(await commitOf(fixture));
      const reader = createReader({ root: '/nonexistent' });
      const r = { ...ref, sha: 'c'.repeat(40) };
      await reader.getEntries('post', { ref: r });
      await reader.getEntry('homePage', 'index', { ref: r });
      expect(readCommit).toHaveBeenCalledTimes(1);
    });

    it('throws EditletError for invalid branch content like disk', async () => {
      const c = await commitOf(fixture);
      c.files.delete('cms/content/author/jane.md');
      readCommit.mockResolvedValue(c);
      const error = await createReader({ root: '/nonexistent' })
        .getEntries('post', { ref: { ...ref, sha: 'd'.repeat(40) } })
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(error).toBeInstanceOf(EditletError);
    });

    it('flags a referenced image missing from the commit tree', async () => {
      const c = await commitOf(fixture);
      c.paths = new Set([...c.paths].filter((p) => !isImagePath(p)));
      readCommit.mockResolvedValue(c);
      await expect(
        createReader({ root: '/nonexistent' }).getEntries('post', { ref: { ...ref, sha: 'e'.repeat(40) } }),
      ).rejects.toBeInstanceOf(EditletError);
    });

    it('throws a clear error when the token or preview env is missing', async () => {
      const reader = createReader({ root: '/nonexistent' });
      const r = { ...ref, sha: 'f'.repeat(40) };
      vi.stubEnv('CMS_GITHUB_TOKEN', '');
      await expect(reader.getEntries('post', { ref: r })).rejects.toThrow(/CMS_GITHUB_TOKEN/);
      vi.stubEnv('CMS_GITHUB_TOKEN', 'tok');
      vi.stubEnv('EDITLET_PREVIEW', '');
      await expect(reader.getEntries('post', { ref: r })).rejects.toThrow(/EDITLET_PREVIEW/);
    });
  });
});

describe('reader references (survey fixture)', () => {
  const survey = fileURLToPath(new URL('../__fixtures__/survey', import.meta.url));
  type Tree = { collection: string; slug: string; data: Record<string, unknown>; body: string };
  const list = (e: unknown, field: string) => (e as Tree).data[field] as Tree[];

  it('keeps reference strings without depth', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const entry = await createReader({ root: survey }).getEntry('survey', 'onboarding');
    expect(entry?.data.sections).toEqual(['section/about-you', 'section/feedback']);
  });

  it('includes entries four levels deep, images as public URLs', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const entry = (await createReader({ root: survey }).getEntry('survey', 'onboarding', { depth: 4 })) as Tree;
    expect((entry.data.brand as Tree).data.logo).toEqual({ src: '/editlet/content/brand/logo.webp', alt: 'Acme logo' });
    const [aboutYou] = list(entry, 'sections');
    const [age, role] = list(aboutYou, 'questions');
    expect(role!.data.image).toEqual({ src: '/editlet/content/question/role/diagram.webp', alt: 'Team roles' });
    expect(list(age, 'options').map((o) => o.data.label)).toEqual(['Under 18', '18 or older', 'Prefer not to say']);
    expect(age!.body).toBe('Pick the closest answer.\n');
  });

  it('drops a draft target in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const age = (await createReader({ root: survey }).getRef('question/age', { depth: 1 })) as Tree;
    expect(list(age, 'options').map((o) => o.slug)).toEqual(['age-young', 'age-adult']);
  });

  it('resolves every entry of getEntries', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const surveys = (await createReader({ root: survey }).getEntries('survey', { depth: 1 })) as Tree[];
    expect(surveys.map((s) => list(s, 'sections').map((x) => x.data.title))).toEqual([
      ['About you', 'Feedback'],
      ['Feedback'],
    ]);
  });

  it('lists referrers, optionally from one collection, resolved like other reads', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const reader = createReader({ root: survey });
    const age = await reader.getReferrers('question/age');
    expect(age.map((e) => `${e.collection}/${e.slug}`)).toEqual(['option/age-adult', 'section/about-you']);
    const sections = (await reader.getReferrers('question/age', { from: 'section', depth: 1 })) as Tree[];
    expect(sections.map((s) => s.slug)).toEqual(['about-you']);
    expect(list(sections[0], 'questions').map((q) => q.slug)).toEqual(['age', 'role']);
    expect(await reader.getReferrers('survey/pulse')).toEqual([]);
  });

  it('hides draft referrers in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const dir = await mkdtemp(join(tmpdir(), 'editlet-reader-'));
    try {
      await cp(survey, dir, { recursive: true });
      const file = join(dir, 'cms/content/survey/pulse.md');
      await writeFile(file, (await readFile(file, 'utf8')).replace('status: closed', 'status: closed\ndraft: true'));
      const used = await createReader({ root: dir }).getReferrers('section/feedback');
      expect(used.map((e) => e.slug)).toEqual(['onboarding']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reads blocks: nested images as public URLs, a block reference resolved with the page', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const page = (await createReader({ root: survey }).getEntry('page', 'landing', { depth: 3 })) as Tree;
    const blocks = page.data.content as Record<string, any>[];
    expect(blocks[0]!.image).toEqual({ src: '/editlet/content/page/landing/hero.webp', alt: 'People talking' });
    expect(blocks[1]!.items[0].icon).toEqual({ src: '/editlet/content/page/landing/fast.webp', alt: 'Clock' });
    // A Markdown string inside a block stays as written: the site renders it (and its images) like a body.
    expect(blocks[2]!.text).toContain('![Chart of answers](landing/chart.webp)');
    const sections = list(blocks[3]!.survey, 'sections');
    expect(list(sections[0], 'questions').map((q) => q.data.prompt)).toEqual([
      'How old are you?',
      'What is your role?',
    ]);
    expect(page.data.seo).toEqual({ title: 'Join the Acme panel', description: 'Five minutes a month.' });
  });

  it('lists a page among the referrers of a survey it embeds in a block', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const used = await createReader({ root: survey }).getReferrers('survey/onboarding');
    expect(used.map((e) => `${e.collection}/${e.slug}`)).toEqual(['page/landing']);
  });

  it('rejects a depth outside 0…10', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    await expect(createReader({ root: survey }).getEntries('survey', { depth: 11 })).rejects.toThrow(RangeError);
  });
});
