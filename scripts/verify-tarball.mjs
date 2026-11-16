// Packs `editlet`, checks the tarball, and installs it into a generated Next.js app and a generated Astro site.
// Run after `npm run build`: `npm run verify:tarball` in the package (`--keep` keeps the temp dir). Spec: P13 §4, §9.4.
// Needs nothing outside the package directory, so it also runs in the standalone `antongunkin/editlet` checkout.
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED =
  /^(?:package\.json|README\.md|LICENSE|dist\/.+|skills\/(?:README\.md|[\w-]+\/(?:SKILL\.md|references\/.+|scripts\/[\w-]+\.mjs)))$/;
const FORBIDDEN = [/\.test\./, /(?:^|\/)__fixtures__\//, /(?:^|\/)__snapshots__\//, /(?:^|\/)admin\/src\//];
const SOURCE_TS = /\.[cm]?tsx?$/;
const DECLARATION = /\.d\.[cm]?ts$/;
/** The skills of the package: the bundled scripts and one reference each needs (a glob in `files` can drop them). */
const SKILLS = {
  editlet: { scripts: ['validate', 'types', 'schema', 'refs', 'guard', 'link'], reference: 'content-format.md' },
  'editlet-setup': { scripts: ['doctor'], reference: 'next.md' },
  'editlet-migrate': { scripts: [], reference: 'mapping.md' },
};
const REQUIRED = [
  'package.json',
  'LICENSE',
  'dist/admin/dist/index.html',
  ...Object.entries(SKILLS).flatMap(([skill, { scripts, reference }]) => [
    `skills/${skill}/SKILL.md`,
    `skills/${skill}/references/${reference}`,
    ...scripts.map((s) => `skills/${skill}/scripts/${s}.mjs`),
  ]),
];
const SECRETS = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['npm token', /\bnpm_[A-Za-z0-9]{36}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{22,}\b/],
];
const PINNED = ['next', 'react', 'react-dom', 'typescript', '@types/react', '@types/react-dom', '@types/node', 'astro'];
/** Entries that import nothing from next, react or astro, so plain Node can load them. */
const PEER_FREE = ['core', 'node', 'auth', 'auth/client', 'auth/protocol', 'github', 'loader', 'loader/protocol'];
const WITH_PEERS = ['astro', 'astro/content', 'next', 'next/config', 'next/preview', 'admin/dist/*', 'package.json'];
/** Only `loader/index.ts` has this literal (`Symbol.for('editlet.loader')`); it survives minification. */
const LOADER_MARKER = 'editlet.loader';
const ENTRY_TITLE = 'Hello world';

function exportTargets(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(exportTargets);
  return [];
}

/** Throws when the packed file list has a path outside the allowlist, a test/fixture/source file, or misses a file. */
export function assertPackFiles(files, exportsMap = {}) {
  const paths = files.map((f) => (typeof f === 'string' ? f : f.path).replace(/^package\//, ''));
  const set = new Set(paths);
  const problems = [];
  for (const path of paths) {
    if (!ALLOWED.test(path)) problems.push(`not allowed: ${path}`);
    else if (FORBIDDEN.some((re) => re.test(path))) problems.push(`forbidden: ${path}`);
    else if (SOURCE_TS.test(path) && !DECLARATION.test(path)) problems.push(`TypeScript source: ${path}`);
  }
  for (const path of REQUIRED) if (!set.has(path)) problems.push(`missing: ${path}`);
  for (const [key, value] of Object.entries(exportsMap)) {
    for (const target of exportTargets(value)) {
      const path = target.replace(/^\.\//, '');
      const star = path.indexOf('*');
      const found = star === -1 ? set.has(path) : paths.some((p) => p.startsWith(path.slice(0, star)));
      if (!found) problems.push(`export ${key} → ${target} is not in the tarball`);
    }
  }
  if (problems.length > 0) throw new Error(`npm tarball file list:\n  ${problems.join('\n  ')}`);
}

/** Throws when `text` (the contents of `file`) looks like it holds a credential. */
export function assertNoSecrets(text, file) {
  for (const [name, re] of SECRETS) {
    if (re.test(text)) throw new Error(`credential-like content (${name}) in ${file}`);
  }
}

/**
 * The version of `name` that Node resolution finds from `fromDir`: the first `node_modules/<name>/package.json` on the
 * way up (the package's own `node_modules` standalone, the hoisted root one in the monorepo). Null when none.
 */
export function installedVersion(name, fromDir) {
  for (let dir = resolve(fromDir); ; dir = dirname(dir)) {
    try {
      const { version } = JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8'));
      if (typeof version === 'string' && version) return version;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    if (dirname(dir) === dir) return null;
  }
}

/** The consumer versions: the exact versions installed next to the package (its devDependencies). */
export function pinnedVersions(fromDir = packageRoot) {
  /** @type {Record<string, string>} */
  const versions = {};
  for (const name of PINNED) {
    const version = installedVersion(name, fromDir);
    if (!version) throw new Error(`${name} is not installed (resolved from ${fromDir}); run npm install first`);
    versions[name] = version;
  }
  return versions;
}

function childEnv() {
  // `npm run -w editlet` exports workspace/lifecycle settings; they must not reach the temp installs.
  const keep = new Set(['npm_config_registry', 'npm_config_cache', 'npm_config_userconfig']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('npm_') || keep.has(k)));
  delete env.NODE_ENV;
  return { ...env, NEXT_TELEMETRY_DISABLED: '1', ASTRO_TELEMETRY_DISABLED: '1', NO_COLOR: '1' };
}

function run(cmd, args, cwd) {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (out += c));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0
        ? done(out)
        : fail(new Error(`${cmd} ${args.join(' ')} exited ${code} in ${cwd}\n${out.slice(-4000)}`)),
    );
  });
}

const durations = {};
async function step(name, fn) {
  const start = Date.now();
  process.stdout.write(`• ${name}\n`);
  const result = await fn();
  durations[name] = `${((Date.now() - start) / 1000).toFixed(1)}s`;
  return result;
}

const check = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function filesUnder(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name));
}

async function someFileContains(dir, ext, needle) {
  for (const file of await filesUnder(dir)) {
    if (file.endsWith(ext) && (await readFile(file, 'utf8')).includes(needle)) return true;
  }
  return false;
}

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer().on('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

const npmInstall = (dir) => run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], dir);

// Next writes tsconfig.json and next-env.d.ts itself on the first build.
const NEXT_FILES = {
  'next.config.ts': `import { withEditlet } from 'editlet/next/config';\n\nexport default withEditlet({});\n`,
  'src/lib/cms.ts': [
    `import { createReader } from 'editlet/next';`,
    `import type { EntryMap } from '../../.editlet/content';`,
    `export const { getEntries, getEntry, getRef } = createReader<EntryMap>();`,
    '',
  ].join('\n'),
  'src/app/layout.tsx': [
    `import type { ReactNode } from 'react';`,
    `import { EditletLoader } from 'editlet/next';`,
    `export default function RootLayout({ children }: { children: ReactNode }) {`,
    `  return (<html lang="en"><body>{children}<EditletLoader /></body></html>);`,
    `}`,
    '',
  ].join('\n'),
  'src/app/page.tsx': [
    `import { getEntry, getRef } from '../lib/cms';`,
    `export default async function Home() {`,
    `  const post = await getEntry('post', 'hello-world');`,
    `  if (!post) throw new Error('post/hello-world is missing');`,
    `  const author = post.data.author ? await getRef(post.data.author) : undefined;`,
    `  return (<main><h1>{post.data.title}</h1><p>{author?.data.name}</p></main>);`,
    `}`,
    '',
  ].join('\n'),
};

async function createNextConsumer(dir, tarball, versions) {
  const v = (name) => versions[name];
  const pkg = {
    name: 'editlet-tarball-next',
    private: true,
    type: 'module',
    dependencies: { editlet: `file:${tarball}`, next: v('next'), react: v('react'), 'react-dom': v('react-dom') },
    devDependencies: Object.fromEntries(
      ['typescript', '@types/react', '@types/react-dom', '@types/node'].map((n) => [n, v(n)]),
    ),
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [file, text] of Object.entries(NEXT_FILES)) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), text);
  }
  await cp(join(packageRoot, 'next/__fixtures__/site/cms'), join(dir, 'cms'), { recursive: true });
}

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
}

async function checkNextServer(dir, adminHtml) {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(join(dir, 'node_modules/.bin/next'), ['start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: dir,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  let log = '';
  let exited = false;
  server.stdout.on('data', (c) => (log += c));
  server.stderr.on('data', (c) => (log += c));
  const closed = new Promise((done) => {
    const stop = (error) => {
      if (error) log += String(error);
      exited = true;
      done();
    };
    server.on('close', () => stop());
    server.on('error', stop);
  });
  try {
    const deadline = Date.now() + 60_000;
    for (;;) {
      check(!exited, `next start exited early:\n${log}`);
      check(Date.now() < deadline, `next start not ready after 60s:\n${log}`);
      const up = await fetch(origin).then(Boolean, () => false);
      if (up) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const admin = await fetchText(`${origin}/editlet/index.html`);
    check(
      admin.status === 200 && admin.text === adminHtml,
      `GET /editlet/index.html → ${admin.status}, not the admin HTML`,
    );
    const config = await fetchText(`${origin}/editlet/config.json`);
    check(config.status === 200 && config.type.includes('json'), `GET /editlet/config.json → ${config.status}`);
    JSON.parse(config.text);
    const home = await fetchText(`${origin}/`);
    check(home.status === 200 && home.text.includes(ENTRY_TITLE), `GET / → ${home.status} without "${ENTRY_TITLE}"`);
  } finally {
    // detached: the server is a process group leader, so this also stops any worker it forked
    const kill = (signal) => {
      try {
        process.kill(-server.pid, signal);
      } catch {}
    };
    if (!exited) kill('SIGTERM');
    const timer = setTimeout(() => kill('SIGKILL'), 5_000);
    await closed;
    clearTimeout(timer);
  }
}

async function smokeNode(dir, exportKeys) {
  const listed = new Set([...PEER_FREE, ...WITH_PEERS].map((k) => `./${k}`));
  const unlisted = exportKeys.filter((k) => !listed.has(k));
  check(unlisted.length === 0, `classify new exports in verify-tarball.mjs: ${unlisted.join(', ')}`);
  const imports = PEER_FREE.map((e) => `await import('editlet/${e}');`).join('\n');
  await writeFile(join(dir, 'smoke.mjs'), `${imports}\n`);
  await run(process.execPath, ['smoke.mjs'], dir);
  await writeFile(
    join(dir, 'smoke.cjs'),
    `const m = require('editlet/next/config');\nif (typeof m.withEditlet !== 'function') throw new Error('withEditlet');\n`,
  );
  await run(process.execPath, ['smoke.cjs'], dir);
  const out = await run(process.execPath, ['node_modules/editlet/skills/editlet/scripts/validate.mjs'], dir);
  check(/✓ \d+ entries valid/.test(out), `validate.mjs printed:\n${out}`);
}

/** `link.mjs --hooks` links every skill and adds the guard hook; a second run and `--check` pass. */
async function checkLink(dir) {
  const link = (...args) =>
    run(process.execPath, ['node_modules/editlet/skills/editlet/scripts/link.mjs', ...args], dir);
  await link('--hooks');
  await link('--hooks');
  await link('--check', '--hooks');
  for (const skill of Object.keys(SKILLS)) {
    const target = await realpath(join(dir, 'node_modules/editlet/skills', skill));
    for (const path of [`.claude/skills/${skill}`, `.agents/skills/${skill}`]) {
      check(
        (await realpath(join(dir, path))) === target,
        `${path} does not resolve to node_modules/editlet/skills/${skill}`,
      );
    }
  }
  const settings = await readFile(join(dir, '.claude/settings.json'), 'utf8');
  check(settings.includes('editlet/scripts/guard.mjs'), '.claude/settings.json has no guard hook');
}

/** The bundled doctor of `editlet-setup` runs from the installed package and sees the Next wiring. */
async function checkDoctor(dir) {
  const doctor = join(dir, 'node_modules/editlet/skills/editlet-setup/scripts/doctor.mjs');
  const res = spawnSync(process.execPath, [doctor, '--json'], { cwd: dir, encoding: 'utf8' });
  check(res.status === 0 || res.status === 1, `doctor.mjs exited ${res.status}:\n${res.stderr}`);
  const byId = Object.fromEntries(JSON.parse(res.stdout).map((f) => [f.id, f.status]));
  for (const id of ['project.package', 'project.skills', 'content.valid', 'next.config', 'next.loader']) {
    check(byId[id] === 'ok', `doctor: ${id} is ${byId[id]}`);
  }
}

/** The same files as `examples/astro`: the integration, `editletCollections()`, a page that lists and renders. */
const ASTRO_FILES = {
  'astro.config.mjs': [
    `import editlet from 'editlet/astro';`,
    `import { defineConfig } from 'astro/config';`,
    '',
    `export default defineConfig({ integrations: [editlet()] });`,
    '',
  ].join('\n'),
  'tsconfig.json': `${JSON.stringify({ extends: 'astro/tsconfigs/strict', include: ['.astro/types.d.ts', '**/*'] })}\n`,
  'src/content.config.ts': [
    `import { editletCollections } from 'editlet/astro/content';`,
    '',
    `export const collections = editletCollections();`,
    '',
  ].join('\n'),
  'src/pages/index.astro': [
    `---`,
    `import { getCollection, getEntry, render } from 'astro:content';`,
    `const post = await getEntry('post', 'hello-world');`,
    `if (!post) throw new Error('post/hello-world is missing');`,
    `const author = post.data.author ? await getEntry(post.data.author) : undefined;`,
    `const posts = await getCollection('post');`,
    `const { Content } = await render(post);`,
    `---`,
    `<html lang="en"><body>`,
    `<ul>{posts.map((p) => <li>{p.id}</li>)}</ul>`,
    `<article data-editlet-entry={'post/' + post.id}>`,
    `<h1>{post.data.title}</h1><p>{author?.data.name}</p><img src={post.data.cover?.src.src} alt="" /><Content />`,
    `</article>`,
    `</body></html>`,
    '',
  ].join('\n'),
};

/** 1×1 PNG: Astro reads the metadata of every image field at build, so the 8-byte Next fixture image will not do. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** Content like `examples/astro/cms`: an image, a reference, Markdown, and a draft that the build leaves out. */
const ASTRO_CMS = {
  'cms/schema.json': `${JSON.stringify(
    {
      contentDir: 'cms/content',
      git: { baseBranch: 'main' },
      collections: {
        post: {
          label: 'Post',
          titleField: 'title',
          fields: {
            title: { type: 'string', label: 'Title', required: true },
            cover: { type: 'image', label: 'Cover image' },
            author: { type: 'reference', label: 'Author', collections: ['author'] },
            body: { type: 'markdown', label: 'Body' },
          },
        },
        author: { label: 'Author', fields: { name: { type: 'string', label: 'Name', required: true } } },
      },
    },
    null,
    2,
  )}\n`,
  'cms/content/post/hello-world.md': [
    '---',
    `title: ${ENTRY_TITLE}`,
    'cover:',
    '  src: hello-world/cover.png',
    '  alt: Cover',
    'author: author/jane',
    '---',
    'Hello!',
    '',
  ].join('\n'),
  'cms/content/post/hello-world/cover.png': PNG,
  'cms/content/post/secret.md': '---\ntitle: Secret\ndraft: true\n---\nShh.\n',
  'cms/content/author/jane.md': '---\nname: Jane\n---\n',
};

async function createAstroConsumer(dir, tarball, astroVersion) {
  const pkg = {
    name: 'editlet-tarball-astro',
    private: true,
    type: 'module',
    dependencies: { astro: astroVersion, editlet: `file:${tarball}` },
  };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const [file, content] of Object.entries({ ...ASTRO_FILES, ...ASTRO_CMS })) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), content);
  }
}

async function main() {
  const keep = process.argv.includes('--keep');
  const totalStart = Date.now();
  const tmp = await mkdtemp(join(tmpdir(), 'editlet-tarball-'));
  try {
    const versions = pinnedVersions(packageRoot);
    const packed = await step('npm pack', async () => {
      const out = await run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', tmp], packageRoot);
      return JSON.parse(out.slice(out.indexOf('[')))[0];
    });
    const tarball = join(tmp, packed.filename);
    const extracted = join(tmp, 'extract');
    const pkgDir = join(extracted, 'package');
    const exportsMap = await step('file list + secret scan', async () => {
      await mkdir(extracted);
      await run('tar', ['-xzf', tarball, '-C', extracted], tmp);
      const { exports } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
      assertPackFiles(packed.files, exports);
      for (const file of await filesUnder(pkgDir)) {
        const bytes = await readFile(file);
        if (!bytes.includes(0)) assertNoSecrets(bytes.toString('utf8'), file.slice(pkgDir.length + 1));
      }
      return exports;
    });

    const next = join(tmp, 'next');
    await step('next: install', async () => {
      await createNextConsumer(next, tarball, versions);
      await npmInstall(next);
    });
    await step('next: build', () => run(join(next, 'node_modules/.bin/next'), ['build'], next));
    await step('next: start + requests', async () => {
      check(await someFileContains(join(next, '.next/static'), '.js', LOADER_MARKER), 'no client chunk has the loader');
      await checkNextServer(next, await readFile(join(pkgDir, 'dist/admin/dist/index.html'), 'utf8'));
    });
    await step('next: link the skills', () => checkLink(next));
    await step('next: doctor', () => checkDoctor(next));
    await step('node: imports + require + validate', () => smokeNode(next, Object.keys(exportsMap)));

    const astro = join(tmp, 'astro');
    await step('astro: install', async () => {
      await createAstroConsumer(astro, tarball, versions.astro);
      await npmInstall(astro);
    });
    await step('astro: build', async () => {
      await run(join(astro, 'node_modules/.bin/astro'), ['build'], astro);
      const dist = join(astro, 'dist');
      await readFile(join(dist, 'editlet/index.html'));
      JSON.parse(await readFile(join(dist, 'editlet/config.json'), 'utf8'));
      const home = await readFile(join(dist, 'index.html'), 'utf8');
      for (const text of [ENTRY_TITLE, 'Jane', 'Hello!'])
        check(home.includes(text), `dist/index.html has no "${text}"`);
      check(!home.includes('<li>secret</li>'), 'dist/index.html lists the draft post');
      check(/\/_astro\/cover\.[\w-]+\.png/.test(home), 'dist/index.html has no built cover image');
      check(await someFileContains(dist, '.js', LOADER_MARKER), 'no built Astro script has the loader');
    });

    durations.total = `${((Date.now() - totalStart) / 1000).toFixed(1)}s`;
    const summary = {
      version: packed.version,
      filename: packed.filename,
      size: packed.size,
      unpackedSize: packed.unpackedSize,
      files: packed.files.length,
      consumers: { ...versions },
      durations,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (keep) process.stdout.write(`kept ${tmp}\n`);
    else await rm(tmp, { recursive: true, force: true, maxRetries: 3 });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
