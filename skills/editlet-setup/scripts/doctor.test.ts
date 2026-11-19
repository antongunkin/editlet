// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { doctor } from './doctor.ts';
import type { DoctorContext, ExecResult, Finding } from './doctorTypes';

import { runScript } from '../../test/runScript';

const repo = join(import.meta.dirname, '../../../../..');
const jiti = join(repo, 'node_modules/.bin/jiti');

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const SCHEMA = {
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: { post: { label: 'Post', fields: { title: { type: 'string', label: 'Title', required: true } } } },
};

const NEXT_FILES: Record<string, string> = {
  'package.json': '{ "name": "site", "private": true }',
  'node_modules/editlet/package.json': '{ "version": "0.1.0-alpha.0" }',
  'node_modules/next/package.json': '{ "version": "16.4.6" }',
  'node_modules/react/package.json': '{ "version": "19.3.0" }',
  'node_modules/editlet/skills/editlet/scripts/link.mjs': '',
  'next.config.ts': "import { withEditlet } from 'editlet/next/config';\nexport default withEditlet({});\n",
  'src/app/layout.tsx':
    "import { EditletLoader } from 'editlet/next';\nexport default function L({ children }) { return <html><body>{children}<EditletLoader /></body></html>; }\n",
  '.gitignore': 'node_modules\n/.editlet/\n/public/editlet/\n',
  'cms/schema.json': JSON.stringify(SCHEMA),
  'cms/content/post/hello.md': '---\ntitle: Hello\n---\n',
};

async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'editlet-doctor-'));
  temps.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

type Exec = (cmd: string, args: string[]) => ExecResult | undefined;
const ok = (stdout = ''): ExecResult => ({ status: 0, stdout, stderr: '' });
const LINKED = '.claude/skills/editlet: already linked\n.claude/settings.json: hook present\n';

function ctx(root: string, extra: Partial<DoctorContext> & { execs?: Exec } = {}): DoctorContext {
  return {
    root,
    nodeVersion: '26.9.0',
    fetch: (() => Promise.reject(new Error('no network in tests'))) as typeof fetch,
    ...extra,
    exec: (cmd, args) => {
      const hit = extra.execs?.(cmd, args);
      if (hit) return hit;
      if (args.some((a) => a.endsWith('link.mjs'))) return ok(LINKED);
      return { status: 1, stdout: '', stderr: '' };
    },
  };
}

const byId = (findings: Finding[]) => Object.fromEntries(findings.map((f) => [f.id, f]));

describe('doctor: local checks', () => {
  it('passes a correct Next setup', async () => {
    const findings = await doctor(ctx(await project(NEXT_FILES)));
    expect(findings.filter((f) => f.status === 'fail')).toEqual([]);
    expect(byId(findings)['next.loader']?.status).toBe('ok');
    expect(byId(findings)['admin.auth-url']?.status).toBe('warn');
  });

  it('finds the five breakages of a Next setup', async () => {
    const root = await project({
      ...NEXT_FILES,
      'next.config.ts':
        "export default { async headers() { return [{ source: '/(.*)', headers: [{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }] }]; } };\n",
      'src/app/layout.tsx':
        'export default function L({ children }) { return <html><body>{children}</body></html>; }\n',
      '.gitignore': 'node_modules\n',
      'cms/schema.json': JSON.stringify({
        ...SCHEMA,
        collections: { post: { label: 'Post', fields: { title: { type: 'strng', label: 'Title' } } } },
      }),
    });
    const failed = (await doctor(ctx(root))).filter((f) => f.status === 'fail').map((f) => f.id);
    expect(failed.toSorted()).toEqual(['content.valid', 'next.config', 'next.coop', 'next.gitignore', 'next.loader']);
  });

  it('reports missing skills, an old framework and an old Node', async () => {
    const files: Record<string, string> = {
      ...NEXT_FILES,
      'node_modules/next/package.json': '{ "version": "15.5.0" }',
    };
    delete files['node_modules/editlet/skills/editlet/scripts/link.mjs'];
    const findings = byId(await doctor({ ...ctx(await project(files)), nodeVersion: '22.11.0' }));
    expect(findings['project.node']?.status).toBe('fail');
    expect(findings['project.framework']?.status).toBe('fail');
    expect(findings['project.skills']?.status).toBe('fail');
  });

  it('checks the auth and preview routes and env names, never values', async () => {
    const root = await project({
      ...NEXT_FILES,
      'next.config.ts':
        "import { withEditlet } from 'editlet/next/config';\nexport default withEditlet({}, { admin: { repo: 'acme/site', authUrl: 'https://acme.dev/api/editlet/oauth', preview: true } });\n",
      '.env.example': 'GITHUB_CLIENT_ID=\nALLOWED_ORIGINS=\n',
      '.env.local': 'GITHUB_CLIENT_SECRET=supersecretvalue\n',
    });
    const findings = byId(await doctor(ctx(root)));
    expect(findings['admin.auth-route']?.status).toBe('fail');
    expect(findings['next.preview-route']?.status).toBe('fail');
    expect(findings['env.ignored']?.status).toBe('fail');
    expect(JSON.stringify(findings)).not.toContain('supersecretvalue');

    await mkdir(join(root, 'src/app/api/editlet/oauth/[...path]'), { recursive: true });
    await writeFile(
      join(root, 'src/app/api/editlet/oauth/[...path]/route.ts'),
      "import { handleRequest } from 'editlet/auth';\n",
    );
    await mkdir(join(root, 'src/app/api/editlet/preview'), { recursive: true });
    await writeFile(
      join(root, 'src/app/api/editlet/preview/route.ts'),
      "export { POST, DELETE } from 'editlet/next/preview';\n",
    );
    const again = byId(await doctor(ctx(root, { execs: (cmd) => (cmd === 'git' ? ok() : undefined) })));
    expect(again['admin.auth-route']?.status).toBe('ok');
    expect(again['next.preview-route']?.status).toBe('ok');
    expect(again['env.ignored']).toBeUndefined();
    expect(again['env.example']?.message).toBe(
      '.env.example lacks GITHUB_CLIENT_SECRET, CMS_PREVIEW_SECRET, CMS_GITHUB_TOKEN',
    );
  });

  it('checks an Astro setup', async () => {
    const root = await project({
      'package.json': '{ "name": "site" }',
      'node_modules/editlet/package.json': '{ "version": "0.1.0" }',
      'node_modules/astro/package.json': '{ "version": "7.4.12" }',
      'node_modules/editlet/skills/editlet/scripts/link.mjs': '',
      'astro.config.mjs':
        "import editlet from 'editlet/astro';\nexport default { base: '/docs', integrations: [editlet()] };\n",
      'cms/schema.json': JSON.stringify(SCHEMA),
    });
    const findings = byId(await doctor(ctx(root)));
    expect(findings['astro.integration']?.status).toBe('ok');
    expect(findings['astro.collections']?.status).toBe('fail');
    expect(findings['astro.base']?.status).toBe('fail');
  });
});

function fakeFetch(routes: Record<string, { status: number; body?: string; headers?: Record<string, string> }>) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const route = routes[url.pathname] ?? { status: 404 };
    return new Response(route.status === 204 || route.status === 302 ? null : (route.body ?? ''), {
      status: route.status,
      headers: route.headers,
    });
  }) as typeof fetch;
}

const LIVE = {
  '/editlet/config.json': {
    status: 200,
    body: JSON.stringify({
      github: { owner: 'acme', repo: 'site', baseBranch: 'main' },
      authUrl: '/api/editlet/oauth',
    }),
  },
  '/editlet/index.html': { status: 200, body: '<html></html>' },
  '/': { status: 200, body: '<html></html>' },
  '/api/editlet/oauth/health': { status: 204 },
  '/api/editlet/oauth/auth': {
    status: 302,
    headers: { location: 'https://github.com/login/oauth/authorize?client_id=Iv23abc&state=x' },
  },
};

const GH: Exec = (cmd, args) => {
  if (cmd !== 'gh') return undefined;
  if (args[0] === 'auth') return ok();
  const path = args[1] ?? '';
  if (path === 'repos/acme/site') return ok('{"permissions":{"push":true}}');
  if (path.endsWith('/rules/branches/main')) return ok('[{"type":"pull_request"}]');
  if (path.includes('/deployments')) return ok('[{"environment":"Production"},{"environment":"Preview"}]');
  if (path.endsWith('/labels/editlet')) return ok('{"name":"editlet"}');
  return { status: 1, stdout: '', stderr: 'Not Found' };
};

const b64 = (text: string) => Buffer.from(text).toString('base64');

/** A private repo set up with the roles recipe; `over` replaces answers by path. */
const ghRoles =
  (over: Record<string, string | null> = {}): Exec =>
  (cmd, args) => {
    if (cmd !== 'gh' || args[0] === 'auth') return GH(cmd, args);
    const path = args[1] ?? '';
    const answers: Record<string, string | null> = {
      'repos/acme/site': '{"permissions":{"push":true},"private":true}',
      'repos/acme/site/rules/branches/main':
        '[{"type":"pull_request","parameters":{"require_code_owner_review":true,"require_last_push_approval":true}}]',
      'repos/acme/site/contents/.github/CODEOWNERS?ref=main': JSON.stringify({
        content: b64('* @acme/admins\n/cms/content/ @acme/editors @acme/admins\n'),
      }),
      'repos/acme/site/codeowners/errors?ref=main': '{"errors":[]}',
      'repos/acme/site/rules/branches/doctor-probe': '[{"type":"creation"}]',
      'repos/acme/site/rules/branches/editlet/doctor-probe': '[]',
      'repos/acme/site/rulesets?targets=push': '[{"id":7,"enforcement":"active"}]',
      'repos/acme/site/rulesets/7':
        '{"rules":[{"type":"file_path_restriction","parameters":{"restricted_file_paths":["**/*"]}}],"bypass_actors":[]}',
      ...over,
    };
    if (path in answers)
      return answers[path] === null ? { status: 1, stdout: '', stderr: 'Not Found' } : ok(answers[path]!);
    return GH(cmd, args);
  };

const GH_NO_RULES: Exec = (cmd, args) => (cmd === 'gh' && args[1]?.includes('/rules/') ? ok('[]') : GH(cmd, args));

describe('doctor: live site and GitHub', () => {
  it('passes a correct live setup', async () => {
    const root = await project(NEXT_FILES);
    const findings = await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: GH }));
    expect(findings.filter((f) => f.status === 'fail' || f.status === 'warn').map((f) => f.id)).toEqual([
      'admin.auth-url',
    ]);
    const ids = byId(findings);
    expect(ids['auth.origin']?.message).toContain('Iv23abc');
    expect(ids['github.protection']?.status).toBe('ok');
    expect(ids['auth.github-app']?.message).toContain('https://acme.dev/api/editlet/oauth/callback');
  });

  it('flags an exposed dev API, a refused origin, COOP and a missing PR rule', async () => {
    const root = await project(NEXT_FILES);
    const fetch = fakeFetch({
      ...LIVE,
      '/__editlet/files': { status: 200, body: '[]' },
      '/': { status: 200, headers: { 'cross-origin-opener-policy': 'same-origin' } },
      '/api/editlet/oauth/auth': { status: 400 },
    });
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch, execs: GH_NO_RULES })));
    expect(ids['site.dev-api']?.status).toBe('fail');
    expect(ids['site.coop']?.status).toBe('fail');
    expect(ids['auth.origin']?.message).toBe('ALLOWED_ORIGINS does not list https://acme.dev');
    expect(ids['github.protection']?.status).toBe('warn');
  });

  it('checks the roles recipe when CODEOWNERS exists', async () => {
    const root = await project(NEXT_FILES);
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: ghRoles() })));
    expect(ids['github.codeowners']).toMatchObject({
      status: 'ok',
      message: '.github/CODEOWNERS: content by @acme/editors @acme/admins, schema by @acme/admins',
    });
    expect(ids['github.code-owner-review']?.status).toBe('ok');
    expect(ids['github.creations']?.status).toBe('ok');
    expect(ids['github.push-rules']?.status).toBe('ok');
    expect(ids['github.bypass']).toBeUndefined();
    expect(ids['github.roles']).toBeUndefined();
  });

  it('flags gaps in the roles recipe', async () => {
    const root = await project(NEXT_FILES);
    const execs = ghRoles({
      'repos/acme/site/rules/branches/main':
        '[{"type":"pull_request","parameters":{"require_code_owner_review":false}}]',
      'repos/acme/site/codeowners/errors?ref=main': '{"errors":[{"line":2,"message":"Unknown owner\\nmore"}]}',
      'repos/acme/site/rules/branches/editlet/doctor-probe': '[{"type":"creation"}]',
      'repos/acme/site/rulesets/7': '{"rules":[]}',
      'repos/acme/site/labels/editlet': null,
    });
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs })));
    expect(ids['github.codeowners']).toMatchObject({
      status: 'fail',
      message: '.github/CODEOWNERS: line 2: Unknown owner',
    });
    expect(ids['github.code-owner-review']?.message).toContain('Require review from Code Owners');
    expect(ids['github.creations']?.status).toBe('fail');
    expect(ids['github.push-rules']?.status).toBe('warn');
    expect(ids['github.bypass']?.status).toBe('manual');
    expect(ids['github.labels']?.status).toBe('warn');
  });

  it('says the roles are optional without CODEOWNERS, and push rules need a private repo', async () => {
    const root = await project(NEXT_FILES);
    const plain = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: GH })));
    expect(plain['github.roles']?.status).toBe('manual');
    expect(plain['github.creations']).toBeUndefined();
    const publicRepo = ghRoles({ 'repos/acme/site': '{"permissions":{"push":true},"private":false}' });
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: publicRepo })));
    expect(ids['github.push-rules']?.status).toBe('manual');
  });

  it('says "not set up" when config.json has no repository', async () => {
    const root = await project(NEXT_FILES);
    const fetch = fakeFetch({ ...LIVE, '/editlet/config.json': { status: 200, body: '{}' } });
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch })));
    expect(ids['site.config']?.status).toBe('fail');
    expect(ids['auth.url']?.status).toBe('warn');
  });
});

describe('doctor CLI', () => {
  it('exits 2 on bad usage and 1 when a check fails', async () => {
    const root = await project({ ...NEXT_FILES, '.gitignore': '' });
    const script = join(import.meta.dirname, 'doctor.ts');
    expect(spawnSync(jiti, [script, '--bogus'], { encoding: 'utf8' }).status).toBe(2);
    const res = spawnSync(jiti, [script, '--root', root], { encoding: 'utf8' });
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/^fail {3}next\.gitignore: \.gitignore lacks/m);
  });
});

describe('doctor CLI in process', () => {
  const script = join(import.meta.dirname, 'doctor.ts');

  it.each([[['--bogus']], [['--url', 'not a url']], [['--root']]])('exits 2 with the usage for %j', async (args) => {
    const res = await runScript(script, args);
    expect(res).toMatchObject({
      status: 2,
      stderr: 'usage: doctor.mjs [--root <dir>] [--url <https://site>] [--json]\n',
    });
  });

  it('exits 2 without a package.json', async () => {
    const root = await project({ 'README.md': '' });
    const res = await runScript(script, ['--root', root]);
    expect(res).toMatchObject({ status: 2, stderr: `no package.json in ${root}\n` });
  });

  it('prints one line per finding, or JSON, and exits 1 when a check fails', async () => {
    const root = await project({ ...NEXT_FILES, '.gitignore': '' });
    const text = await runScript(script, ['--root', root]);
    expect(text.status).toBe(1);
    expect(text.stdout).toMatch(/^fail {3}next\.gitignore: \.gitignore lacks/m);
    expect(text.stdout).toMatch(/^ok {5}next\.loader: /m);
    const json = await runScript(script, ['--json', '--root', root]);
    expect(json.status).toBe(1);
    const findings = JSON.parse(json.stdout) as Finding[];
    expect(byId(findings)['next.gitignore']?.status).toBe('fail');
  });

  it('exits 0 when nothing fails', async () => {
    const res = await runScript(script, ['--root', await project(NEXT_FILES)]);
    expect(res.stdout).not.toMatch(/^fail/m);
    expect(res.status).toBe(0);
  });
});

/** `vercel env ls` answering `stdout` with `status`. */
const vercel =
  (stdout: string, status = 0): Exec =>
  (cmd) =>
    cmd === 'vercel' ? { status, stdout, stderr: '' } : undefined;

describe('doctor: more local checks', () => {
  const PREVIEW_CONFIG =
    "import { withEditlet } from 'editlet/next/config';\nexport default withEditlet({}, { admin: { repo: 'acme/site', authUrl: '/api/editlet/oauth', preview: true } });\n";
  const ROUTES = {
    'src/app/api/editlet/oauth/[...path]/route.ts': "import { handleRequest } from 'editlet/auth';\n",
    'src/app/api/editlet/preview/route.ts': "export { POST } from 'editlet/next/preview';\n",
    '.env.example':
      'GITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nALLOWED_ORIGINS=\nCMS_PREVIEW_SECRET=\nCMS_GITHUB_TOKEN=\n',
    '.vercel/project.json': '{}',
  };

  it('fails a folder with no framework, no editlet package and no schema', async () => {
    const ids = byId(await doctor(ctx(await project({ 'package.json': '{}' }))));
    expect(ids['project.framework']).toMatchObject({
      status: 'fail',
      message: 'no next.config.* or astro.config.* in the root',
    });
    expect(ids['project.package']?.status).toBe('fail');
    expect(ids['content.valid']).toMatchObject({ status: 'fail', message: 'cms/schema.json is missing' });
    expect(ids['project.skills']?.status).toBe('fail');
  });

  it('reports a broken schema, an old Astro and an auth handler hosted elsewhere', async () => {
    const ids = byId(
      await doctor(
        ctx(
          await project({
            'package.json': '{}',
            'node_modules/astro/package.json': '{ "version": "5.2.0" }',
            'astro.config.mjs': "export default { integrations: [], admin: { authUrl: 'https://auth.acme.dev/x' } };\n",
            'cms/schema.json': '{"collections": 1}',
          }),
          { url: undefined },
        ),
      ),
    );
    expect(ids['project.framework']).toMatchObject({ status: 'fail', message: 'astro 5.2.0 (needs astro ^6 || ^7)' });
    expect(ids['content.valid']?.message).toMatch(/^\d+ issue\(s\): cms\/schema.json: /);
    expect(ids['astro.integration']?.status).toBe('fail');
    expect(ids['admin.auth-url']).toMatchObject({
      status: 'ok',
      message: 'https://auth.acme.dev/x (hosted outside this app)',
    });
  });

  it('warns about link problems the link check does not fail on', async () => {
    const findings = await doctor(
      ctx(await project(NEXT_FILES), {
        execs: (_, args) =>
          args.some((a) => a.endsWith('link.mjs')) ? ok('.claude/skills/editlet: fixed link\n') : undefined,
      }),
    );
    expect(byId(findings)['project.skills']).toMatchObject({
      status: 'warn',
      message: '.claude/skills/editlet: fixed link',
    });
  });

  it('checks the env names in the Vercel project, or asks to check them by hand', async () => {
    const root = await project({ ...NEXT_FILES, 'next.config.ts': PREVIEW_CONFIG, ...ROUTES });
    const full = byId(
      await doctor(
        ctx(root, {
          execs: vercel('GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET ALLOWED_ORIGINS CMS_PREVIEW_SECRET CMS_GITHUB_TOKEN'),
        }),
      ),
    );
    expect(full['env.example']?.status).toBe('ok');
    expect(full['env.vercel']?.status).toBe('ok');
    expect(full['next.preview-route']?.status).toBe('ok');
    const partial = byId(await doctor(ctx(root, { execs: vercel('GITHUB_CLIENT_ID') })));
    expect(partial['env.vercel']).toMatchObject({ status: 'fail' });
    expect(partial['env.vercel']?.message).toContain('CMS_GITHUB_TOKEN');
    const noCli = byId(await doctor(ctx(root, { execs: vercel('', 1) })));
    expect(noCli['env.vercel']?.status).toBe('manual');
  });
});

describe('doctor: page addresses', () => {
  const withUrls = (collections: Record<string, unknown>) => JSON.stringify({ ...SCHEMA, collections });
  const POST = { label: 'Post', fields: { title: { type: 'string', label: 'Title', required: true } } };
  const DYNAMIC = { 'src/app/blog/[slug]/page.tsx': 'export default function P() { return null; }\n' };

  it('lists the collections with a page address and names those without', async () => {
    const root = await project({
      ...NEXT_FILES,
      ...DYNAMIC,
      'cms/schema.json': withUrls({
        post: { ...POST, pluralLabel: 'Posts', url: '/blog/{slug}' },
        home: { ...POST, label: 'Home', singleton: true, url: '/' },
        author: POST,
        tag: POST,
      }),
    });
    expect(byId(await doctor(ctx(root)))['content.urls']).toEqual({
      status: 'ok',
      id: 'content.urls',
      message: '2 of 4 collections have a page address (post /blog/{slug}, home /); author, tag have none',
    });
  });

  it('warns only when no collection has url and the site has a dynamic route', async () => {
    const warned = byId(await doctor(ctx(await project({ ...NEXT_FILES, ...DYNAMIC }))));
    expect(warned['content.urls']).toMatchObject({
      status: 'warn',
      message:
        'no collection has a page address, but src/app/blog/[slug]/page.tsx is a dynamic route: add "url" to the collection it shows',
    });
    const astro = byId(
      await doctor(ctx(await project({ ...NEXT_FILES, 'src/pages/posts/[slug].astro': '---\n---\n' }))),
    );
    expect(astro['content.urls']?.message).toContain('src/pages/posts/[slug].astro');
    const plain = byId(await doctor(ctx(await project(NEXT_FILES))));
    expect(plain['content.urls']).toMatchObject({
      status: 'ok',
      message: '0 of 1 collections have a page address; post has none',
    });
  });

  it('skips the check when the schema does not load', async () => {
    const ids = byId(await doctor(ctx(await project({ ...NEXT_FILES, ...DYNAMIC, 'cms/schema.json': '{' }))));
    expect(ids['content.valid']?.status).toBe('fail');
    expect(ids['content.urls']).toBeUndefined();
  });

  const LIVE_POSTS = {
    ...NEXT_FILES,
    'cms/schema.json': withUrls({
      home: { ...POST, label: 'Home', singleton: true, url: '/' },
      post: { ...POST, url: '/blog/{slug}' },
    }),
    'cms/content/home/index.md': '---\ntitle: Home\n---\n',
    'cms/content/post/alpha.md': '---\ntitle: Alpha\ndraft: true\n---\n',
    'cms/content/post/beta.md': '---\ntitle: Beta\n---\n',
    'cms/content/post/gamma.md': '---\ntitle: Gamma\n---\n',
  };

  it('fetches the first published entry of the first {slug} collection on the live site', async () => {
    const root = await project(LIVE_POSTS);
    const seen: string[] = [];
    const routes = fakeFetch({ ...LIVE, '/blog/beta': { status: 200, body: '<html></html>' } });
    const fetch = ((input: string | URL | Request, init?: RequestInit) => {
      seen.push(new URL(String(input)).pathname);
      return routes(input, init);
    }) as typeof globalThis.fetch;
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch, execs: GH })));
    expect(ids['site.entry-url']).toEqual({
      status: 'ok',
      id: 'site.entry-url',
      message: 'https://acme.dev/blog/beta answers 200',
    });
    expect(seen).not.toContain('/blog/alpha');
  });

  it('warns with the URL when the page is not there', async () => {
    const root = await project(LIVE_POSTS);
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: GH })));
    expect(ids['site.entry-url']).toMatchObject({
      status: 'warn',
      message:
        "https://acme.dev/blog/beta: 404 (expected 2xx): the url of post (/blog/{slug}) may not match the site's routes",
    });
  });

  it('skips a file whose name is not a valid slug, and says no answer', async () => {
    const root = await project({ ...LIVE_POSTS, 'cms/content/post/Aaa_Bad.md': '---\ntitle: Bad\n---\n' });
    const seen: string[] = [];
    const fetch = (async (input: string | URL | Request) => {
      seen.push(new URL(String(input)).pathname);
      throw new Error('offline');
    }) as typeof globalThis.fetch;
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch, execs: GH })));
    expect(seen).toContain('/blog/beta');
    expect(seen.some((p) => /null|Aaa_Bad/.test(p))).toBe(false);
    expect(ids['site.entry-url']?.message).toMatch(/^https:\/\/acme\.dev\/blog\/beta: no answer/);
  });

  it('a redirect that only changes the trailing / is ok; another redirect warns with its target', async () => {
    const root = await project(LIVE_POSTS);
    const slash = fakeFetch({ ...LIVE, '/blog/beta': { status: 308, headers: { location: '/blog/beta/' } } });
    const slashed = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: slash, execs: GH })));
    expect(slashed['site.entry-url']).toMatchObject({
      status: 'ok',
      message: expect.stringContaining('redirects to /blog/beta/'),
    });
    const away = fakeFetch({ ...LIVE, '/blog/beta': { status: 302, headers: { location: '/login' } } });
    const warned = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: away, execs: GH })));
    expect(warned['site.entry-url']).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('302 to /login'),
    });
  });

  it('has no remote check without a {slug} collection, and none without --url', async () => {
    const root = await project({
      ...NEXT_FILES,
      'cms/schema.json': withUrls({ post: { ...POST, url: '/blog' } }),
    });
    const remote = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: GH })));
    expect(remote['site.entry-url']).toBeUndefined();
    const local = byId(await doctor(ctx(await project(LIVE_POSTS))));
    expect(local['site.entry-url']).toBeUndefined();
  });

  it('asks for a check by hand when the collection has only drafts', async () => {
    const root = await project({
      ...LIVE_POSTS,
      'cms/content/post/beta.md': '---\ntitle: Beta\ndraft: true\n---\n',
      'cms/content/post/gamma.md': '---\ntitle: Gamma\ndraft: true\n---\n',
      'cms/content/post/hello.md': '---\ntitle: Hello\ndraft: true\n---\n',
    });
    const ids = byId(await doctor(ctx(root, { url: 'https://acme.dev', fetch: fakeFetch(LIVE), execs: GH })));
    expect(ids['site.entry-url']?.status).toBe('manual');
  });
});
