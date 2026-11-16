// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { assertNoSecrets, assertPackFiles, installedVersion, pinnedVersions } from './verify-tarball.mjs';

const REQUIRED = [
  'package.json',
  'LICENSE',
  'dist/admin/dist/index.html',
  'skills/editlet/SKILL.md',
  'skills/editlet/references/content-format.md',
  'skills/editlet-setup/references/next.md',
  'skills/editlet-migrate/references/mapping.md',
  'skills/editlet/scripts/validate.mjs',
  'skills/editlet/scripts/types.mjs',
  'skills/editlet/scripts/schema.mjs',
  'skills/editlet/scripts/refs.mjs',
  'skills/editlet/scripts/guard.mjs',
  'skills/editlet/scripts/link.mjs',
  'skills/editlet-setup/SKILL.md',
  'skills/editlet-setup/scripts/doctor.mjs',
  'skills/editlet-migrate/SKILL.md',
];
const EXPORTS = {
  './core': { types: './dist/core/index.d.ts', import: './dist/core/index.js', default: './dist/core/index.js' },
  './admin/dist/*': './dist/admin/dist/*',
  './package.json': './package.json',
};
const GOOD = [
  ...REQUIRED,
  'README.md',
  'dist/core/index.js',
  'dist/core/index.d.ts',
  'skills/README.md',
  'skills/editlet-setup/references/doctor.md',
];

describe('assertPackFiles', () => {
  it('accepts the allowlisted layout, with or without the package/ prefix and as pack objects', () => {
    expect(() => assertPackFiles(GOOD, EXPORTS)).not.toThrow();
    expect(() =>
      assertPackFiles(
        GOOD.map((p) => `package/${p}`),
        EXPORTS,
      ),
    ).not.toThrow();
    expect(() =>
      assertPackFiles(
        GOOD.map((path) => ({ path, size: 1 })),
        EXPORTS,
      ),
    ).not.toThrow();
  });

  it.each([
    ['skills/editlet/scripts/validate.ts', 'not allowed'],
    ['next/config.ts', 'not allowed'],
    ['dist/core/index.test.js', 'forbidden'],
    ['dist/next/__fixtures__/site/cms/schema.json', 'forbidden'],
    ['dist/core/__snapshots__/a.snap', 'forbidden'],
    ['dist/admin/src/main.js', 'forbidden'],
    ['dist/core/index.ts', 'TypeScript source'],
    ['dist/next/EditletLoader.tsx', 'TypeScript source'],
    ['skills/editlet/scripts/build.ts', 'not allowed'],
    ['.env', 'not allowed'],
  ])('rejects %s', (path, reason) => {
    expect(() => assertPackFiles([...GOOD, path], EXPORTS)).toThrow(`${reason}: ${path}`);
  });

  it('keeps .d.ts files', () => {
    expect(() => assertPackFiles([...GOOD, 'dist/core/schema.d.ts'], EXPORTS)).not.toThrow();
  });

  it('reports every missing required file', () => {
    expect(() => assertPackFiles(GOOD.filter((p) => p !== 'skills/editlet/scripts/link.mjs'))).toThrow(
      'missing: skills/editlet/scripts/link.mjs',
    );
    expect(() =>
      assertPackFiles(
        GOOD.filter((p) => p !== 'dist/admin/dist/index.html'),
        EXPORTS,
      ),
    ).toThrow('missing: dist/admin/dist/index.html');
  });

  it('requires every export target, including wildcard prefixes', () => {
    expect(() =>
      assertPackFiles(
        GOOD.filter((p) => p !== 'dist/core/index.d.ts'),
        EXPORTS,
      ),
    ).toThrow('export ./core → ./dist/core/index.d.ts is not in the tarball');
    const wildcard = { './assets/*': './dist/assets/*' };
    expect(() => assertPackFiles(GOOD, wildcard)).toThrow('export ./assets/* → ./dist/assets/*');
    expect(() => assertPackFiles([...GOOD, 'dist/assets/a.png'], wildcard)).not.toThrow();
  });
});

const fake = (prefix: string, length: number) => `${prefix}${'a1B2'.repeat(20).slice(0, length)}`;

describe('assertNoSecrets', () => {
  it.each([
    ['private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIE'],
    ['private key', '-----BEGIN PRIVATE KEY-----'],
    ['private key', '-----BEGIN OPENSSH PRIVATE KEY-----'],
    ['npm token', `token=${fake('npm_', 36)}`],
    ['GitHub token', fake('ghp_', 36)],
    ['GitHub token', fake('gho_', 36)],
    ['GitHub token', fake('ghs_', 40)],
    ['GitHub fine-grained token', `"${fake('github_pat_', 60)}"`],
  ])('finds a %s', (name, text) => {
    expect(() => assertNoSecrets(text, 'dist/x.js')).toThrow(`credential-like content (${name}) in dist/x.js`);
  });

  it.each([
    'process.env.npm_config_ignore_scripts',
    'const ghp_ = 1;',
    'GITHUB_TOKEN',
    'github_pat_ placeholder',
    '-----BEGIN PUBLIC KEY-----',
    '-----BEGIN CERTIFICATE-----',
  ])('ignores %s', (text) => {
    expect(() => assertNoSecrets(text, 'dist/x.js')).not.toThrow();
  });
});

const NAMES = ['next', 'react', 'react-dom', 'typescript', '@types/react', '@types/react-dom', '@types/node', 'astro'];

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function install(dir: string, name: string, version: string) {
  mkdirSync(join(dir, 'node_modules', name), { recursive: true });
  writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
}

/** `<base>/node_modules/<name>/package.json` for each name, plus a package dir `<base>/packages/editlet`. */
function tree(versions: Record<string, string>, nested: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'editlet-versions-'));
  made.push(base);
  const pkg = join(base, 'packages/editlet');
  mkdirSync(pkg, { recursive: true });
  for (const [name, version] of Object.entries(versions)) install(base, name, version);
  for (const [name, version] of Object.entries(nested)) install(pkg, name, version);
  return { base, pkg };
}

describe('installedVersion', () => {
  it("finds the hoisted copy above the package dir, and prefers the package's own node_modules", () => {
    const { pkg } = tree({ next: '16.0.0', '@types/node': '26.0.0' }, { next: '16.1.0' });
    expect(installedVersion('next', pkg)).toBe('16.1.0');
    expect(installedVersion('@types/node', pkg)).toBe('26.0.0');
  });

  it('returns null when nothing is installed on the way up', () => {
    const { pkg } = tree({});
    expect(installedVersion('editlet-not-installed-anywhere', pkg)).toBeNull();
  });
});

describe('pinnedVersions', () => {
  const all = Object.fromEntries(NAMES.map((n, i) => [n, `1.${i}.0`]));

  it('reads each consumer version from the installed packages', () => {
    expect(pinnedVersions(tree(all).pkg)).toEqual(all);
  });

  it('throws when a consumer package is not installed', () => {
    const { astro: _astro, ...rest } = all;
    const { pkg } = tree(rest);
    expect(() => pinnedVersions(pkg)).toThrow(`astro is not installed (resolved from ${pkg}); run npm install first`);
  });

  it('resolves every consumer from this package', () => {
    const versions = pinnedVersions(fileURLToPath(new URL('..', import.meta.url)));
    expect(Object.keys(versions)).toEqual(NAMES);
    for (const version of Object.values(versions)) expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
