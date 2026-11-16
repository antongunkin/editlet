import { describe, expect, it } from 'vitest';

import { createGitHubClient } from './client.ts';
import { compilePattern, ownersOf, ownersOfAll, parseCodeowners, readCodeowners } from './codeowners.ts';
import { createFakeGitHub } from './test/fakeGitHub.ts';

const match = (pattern: string, path: string) => compilePattern(pattern)!.test(path);

describe('compilePattern', () => {
  // The examples of GitHub's "About code owners" page.
  it.each([
    ['*', 'a.md', true],
    ['*', 'deep/dir/a.md', true],
    ['*.js', 'src/app.js', true],
    ['*.js', 'src/app.ts', false],
    ['*.go', 'go.mod', false],
    ['/build/logs/', 'build/logs/a.log', true],
    ['/build/logs/', 'x/build/logs/a.log', false],
    ['docs/*', 'docs/getting-started.md', true],
    ['docs/*', 'docs/build-app/troubleshooting.md', false],
    ['apps/', 'apps/x.ts', true],
    ['apps/', 'packages/apps/x.ts', true],
    ['apps/', 'apps', false],
    ['/docs/', 'docs/a/b.md', true],
    ['/docs/', 'src/docs/a.md', false],
    ['**/logs', 'deep/logs/a.log', true],
    ['**/logs', 'logs/a.log', true],
    ['/scripts/', 'scripts/a.sh', true],
    ['/cms/content/', 'cms/content/post/hello.md', true],
    ['/cms/content/', 'cms/schema.json', false],
    ['/.github/CODEOWNERS', '.github/CODEOWNERS', true],
    ['docs/**', 'docs/a/b/c.md', true],
    ['README.md', 'sub/README.md', true],
    ['a?.md', 'ab.md', true],
    ['Docs/', 'docs/a.md', false],
  ])('%s matches %s: %s', (pattern, path, ok) => {
    expect(match(pattern, path)).toBe(ok);
  });

  it('rejects what GitHub does not support', () => {
    for (const p of ['!x', '[ab].md', '\\#x', '/']) expect(compilePattern(p)).toBeNull();
  });
});

describe('parseCodeowners and ownersOf', () => {
  const rules = parseCodeowners(
    [
      '# Everything else: admins',
      '*                       @acme/admins',
      '',
      '/cms/content/           @acme/editors @acme/admins # inline comment',
      '/cms/content/legal/     @acme/admins',
      '/cms/content/drafts/',
      '[bad].md                @nobody',
      '/.github/CODEOWNERS     @acme/admins',
    ].join('\n'),
  );

  it('keeps valid lines with their owners and line numbers', () => {
    expect(rules.map((r) => [r.pattern, r.owners, r.line])).toEqual([
      ['*', ['@acme/admins'], 2],
      ['/cms/content/', ['@acme/editors', '@acme/admins'], 4],
      ['/cms/content/legal/', ['@acme/admins'], 5],
      ['/cms/content/drafts/', [], 6],
      ['/.github/CODEOWNERS', ['@acme/admins'], 8],
    ]);
  });

  it('takes the last matching rule', () => {
    expect(ownersOf(rules, 'cms/content/post/a.md')).toEqual(['@acme/editors', '@acme/admins']);
    expect(ownersOf(rules, 'cms/content/legal/terms.md')).toEqual(['@acme/admins']);
    expect(ownersOf(rules, 'cms/schema.json')).toEqual(['@acme/admins']);
    expect(ownersOf(rules, 'cms/content/drafts/x.md')).toEqual([]);
    expect(ownersOf(parseCodeowners('/docs/ @a'), 'src/x.ts')).toBeNull();
  });

  it('collects the owners of several paths once', () => {
    expect(ownersOfAll(rules, ['cms/content/post/a.md', 'cms/schema.json', 'cms/content/drafts/x.md'])).toEqual([
      '@acme/editors',
      '@acme/admins',
    ]);
  });
});

describe('readCodeowners', () => {
  it('reads the first file GitHub would use, on the given ref', async () => {
    const fake = createFakeGitHub({
      owner: 'o',
      repo: 'r',
      branches: { main: { CODEOWNERS: '* @root', 'docs/CODEOWNERS': '* @docs' }, other: { 'x.md': 'x' } },
    });
    const client = createGitHubClient({ token: 't', fetch: fake.fetch });
    expect(await readCodeowners(client, 'o', 'r', 'main')).toEqual({ path: 'CODEOWNERS', text: '* @root' });
    expect(await readCodeowners(client, 'o', 'r', 'other')).toBeNull();
  });
});
