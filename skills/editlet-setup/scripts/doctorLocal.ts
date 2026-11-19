import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DoctorContext, Finding } from './doctorTypes';

import { EditletError } from '../../../core/issues';
import type { Schema } from '../../../core/schema';
import { DEFAULT_SCHEMA_PATH, loadProjectSchema } from '../../../node/fs';
import { validateProject } from '../../../node/project';

const read = (path: string): string | null => (existsSync(path) ? readFileSync(path, 'utf8') : null);

function firstFile(root: string, names: string[]): string | null {
  return names.find((name) => existsSync(join(root, name))) ?? null;
}

const major = (version: string | undefined): number => Number(/(\d+)/.exec(version ?? '')?.[1] ?? NaN);

function installedVersion(root: string, pkg: string): string | undefined {
  const text = read(join(root, 'node_modules', pkg, 'package.json'));
  return text ? (JSON.parse(text) as { version?: string }).version : undefined;
}

/** What the project uses, read from files only. */
export interface ProjectFacts {
  framework: 'next' | 'astro' | null;
  config: { file: string; text: string } | null;
  authUrl?: string;
  preview: boolean;
  /** Admin options are present in the config (`admin: {`). */
  admin: boolean;
}

const NEXT_CONFIGS = ['next.config.ts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];
const ASTRO_CONFIGS = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'];

export function projectFacts(root: string): ProjectFacts {
  const nextFile = firstFile(root, NEXT_CONFIGS);
  const astroFile = firstFile(root, ASTRO_CONFIGS);
  const file = nextFile ?? astroFile;
  const text = file ? (read(join(root, file)) ?? '') : '';
  return {
    framework: nextFile ? 'next' : astroFile ? 'astro' : null,
    config: file ? { file, text } : null,
    authUrl: /authUrl\s*:\s*['"`]([^'"`]+)['"`]/.exec(text)?.[1],
    preview: /preview\s*:\s*true/.test(text),
    admin: /\badmin\s*:\s*\{/.test(text),
  };
}

function checkProject(ctx: DoctorContext, facts: ProjectFacts): Finding[] {
  const out: Finding[] = [];
  const [maj = 0, min = 0] = ctx.nodeVersion.split('.').map(Number);
  out.push(
    maj > 22 || (maj === 22 && min >= 12)
      ? { status: 'ok', id: 'project.node', message: `Node ${ctx.nodeVersion}` }
      : { status: 'fail', id: 'project.node', message: `Node ${ctx.nodeVersion}; Editlet needs 22.12 or newer` },
  );
  const editlet = installedVersion(ctx.root, 'editlet');
  out.push(
    editlet
      ? { status: 'ok', id: 'project.package', message: `editlet ${editlet}` }
      : { status: 'fail', id: 'project.package', message: 'editlet is not installed in node_modules' },
  );
  if (facts.framework === 'next') {
    const next = installedVersion(ctx.root, 'next');
    const react = installedVersion(ctx.root, 'react');
    const ok = major(next) >= 16 && major(react) >= 19;
    out.push({
      status: ok ? 'ok' : 'fail',
      id: 'project.framework',
      message: `next ${next ?? 'missing'}, react ${react ?? 'missing'}${ok ? '' : ' (needs next >=16, react >=19)'}`,
    });
  } else if (facts.framework === 'astro') {
    const astro = installedVersion(ctx.root, 'astro');
    const ok = [6, 7].includes(major(astro));
    out.push({
      status: ok ? 'ok' : 'fail',
      id: 'project.framework',
      message: `astro ${astro ?? 'missing'}${ok ? '' : ' (needs astro ^6 || ^7)'}`,
    });
  } else {
    out.push({ status: 'fail', id: 'project.framework', message: 'no next.config.* or astro.config.* in the root' });
  }
  const link = ['node_modules/editlet/skills/editlet/scripts/link.mjs', '.claude/skills/editlet/scripts/link.mjs']
    .map((rel) => join(ctx.root, rel))
    .find((path) => existsSync(path));
  if (!link) {
    out.push({ status: 'fail', id: 'project.skills', message: 'link.mjs not found: the skills are not installed' });
  } else {
    const res = ctx.exec(process.execPath, [link, '--check', '--hooks', '--root', ctx.root]);
    const lines = res.stdout.trim().split('\n').filter(Boolean);
    const bad = lines.filter((l) => !/: (already linked|hook present|copy kept)$/.test(l));
    out.push(
      res.status === 0 && bad.length === 0
        ? { status: 'ok', id: 'project.skills', message: 'skills linked, guard hook present' }
        : {
            status: res.status === 0 ? 'warn' : 'fail',
            id: 'project.skills',
            message: bad.join('; ') || res.stderr.trim(),
          },
    );
  }
  return out;
}

async function checkContent(root: string): Promise<Finding> {
  if (!existsSync(join(root, 'cms/schema.json'))) {
    return { status: 'fail', id: 'content.valid', message: 'cms/schema.json is missing' };
  }
  let issues;
  try {
    issues = await validateProject(root);
  } catch (error) {
    if (!(error instanceof EditletError)) throw error;
    issues = error.issues;
  }
  if (issues.length === 0) return { status: 'ok', id: 'content.valid', message: 'schema and entries valid' };
  const shown = issues.slice(0, 5).map((i) => `${i.file ?? 'schema'}: ${i.path} — ${i.message}`);
  return { status: 'fail', id: 'content.valid', message: `${issues.length} issue(s): ${shown.join('; ')}` };
}

/** Folders a dynamic route file lives in, and the file it must be: Next `[slug]/page.*`, Astro `[slug].astro`. */
const DYNAMIC_ROUTES: { base: string; file: RegExp }[] = [
  { base: 'app', file: /(^|\/)\[slug\]\/page\.(tsx|ts|jsx|js|mdx)$/ },
  { base: 'src/app', file: /(^|\/)\[slug\]\/page\.(tsx|ts|jsx|js|mdx)$/ },
  { base: 'src/pages', file: /(^|\/)\[slug\]\.astro$/ },
];

/** The first dynamic route file of the site (`src/app/blog/[slug]/page.tsx`), or `null`. */
export function dynamicRoute(root: string): string | null {
  for (const { base, file } of DYNAMIC_ROUTES) {
    if (!existsSync(join(root, base))) continue;
    let files: string[];
    try {
      files = readdirSync(join(root, base), { recursive: true, encoding: 'utf8' });
    } catch {
      continue;
    }
    const hit = files
      .map((rel) => rel.split('\\').join('/'))
      .toSorted()
      .find((rel) => file.test(rel));
    if (hit) return `${base}/${hit}`;
  }
  return null;
}

/**
 * Which collections have a page address (`url`). `warn` only when none has one and the site has a dynamic route:
 * a missing `url` only hides Open on the page and the page address in the editor. Skipped when the schema does not
 * load (`content.valid` reports it).
 */
async function checkUrls(root: string): Promise<Finding[]> {
  let schema: Schema;
  try {
    schema = await loadProjectSchema(root, DEFAULT_SCHEMA_PATH);
  } catch {
    return [];
  }
  const all = Object.entries(schema.collections);
  const withUrl = all.filter(([, c]) => c.url !== undefined);
  const without = all.filter(([, c]) => c.url === undefined).map(([key]) => key);
  if (withUrl.length === 0) {
    const route = dynamicRoute(root);
    if (route) {
      return [
        {
          status: 'warn',
          id: 'content.urls',
          message: `no collection has a page address, but ${route} is a dynamic route: add "url" to the collection it shows`,
        },
      ];
    }
  }
  const verb = withUrl.length === 1 ? 'has' : 'have';
  const list = withUrl.map(([key, c]) => `${key} ${c.url}`).join(', ');
  const rest = without.length === 0 ? '' : `; ${without.join(', ')} ${without.length === 1 ? 'has' : 'have'} none`;
  return [
    {
      status: 'ok',
      id: 'content.urls',
      message: `${withUrl.length} of ${all.length} collections ${verb} a page address${list ? ` (${list})` : ''}${rest}`,
    },
  ];
}

function routeFile(root: string, segments: string, needle: string, exts = ['ts', 'js', 'tsx', 'jsx']): string | null {
  for (const base of ['src/app', 'app', 'src/pages', 'pages']) {
    for (const ext of exts) {
      for (const name of [`${segments}/route.${ext}`, `${segments}.${ext}`]) {
        const text = read(join(root, base, name));
        if (text?.includes(needle)) return `${base}/${name}`;
      }
    }
  }
  return null;
}

const COOP_SAME_ORIGIN = /Cross-Origin-Opener-Policy['"]?\s*,\s*value\s*:\s*['"]same-origin['"]/;

function checkNext(root: string, facts: ProjectFacts): Finding[] {
  const out: Finding[] = [];
  const text = facts.config?.text ?? '';
  out.push(
    text.includes('withEditlet')
      ? { status: 'ok', id: 'next.config', message: `${facts.config?.file} uses withEditlet` }
      : {
          status: 'fail',
          id: 'next.config',
          message: `${facts.config?.file} does not wrap its export with withEditlet`,
        },
  );
  const layoutFile = firstFile(root, ['src/app/layout.tsx', 'app/layout.tsx', 'src/app/layout.jsx', 'app/layout.jsx']);
  const layout = layoutFile ? (read(join(root, layoutFile)) ?? '') : '';
  out.push(
    layout.includes('<EditletLoader') && layout.includes('editlet/next')
      ? { status: 'ok', id: 'next.loader', message: `${layoutFile} renders <EditletLoader />` }
      : {
          status: 'fail',
          id: 'next.loader',
          message: `${layoutFile ?? 'the root layout'} does not render <EditletLoader />`,
        },
  );
  const gitignore = read(join(root, '.gitignore')) ?? '';
  const missing = [
    [/^\/?\.editlet\/?$/m, '/.editlet/'],
    [/^\/?public\/editlet\/?$/m, '/public/editlet/'],
  ]
    .filter(([re]) => !(re as RegExp).test(gitignore))
    .map(([, line]) => line);
  out.push(
    missing.length === 0
      ? { status: 'ok', id: 'next.gitignore', message: '.gitignore covers the generated folders' }
      : { status: 'fail', id: 'next.gitignore', message: `.gitignore lacks ${missing.join(' and ')}` },
  );
  if (facts.preview) {
    const route = routeFile(root, 'api/editlet/preview', 'editlet/next/preview');
    out.push(
      route
        ? { status: 'ok', id: 'next.preview-route', message: route }
        : {
            status: 'fail',
            id: 'next.preview-route',
            message: 'admin.preview is on, but app/api/editlet/preview/route.ts is missing',
          },
    );
  }
  out.push(...checkAuthRoute(root, facts));
  out.push(
    COOP_SAME_ORIGIN.test(text)
      ? { status: 'fail', id: 'next.coop', message: 'Cross-Origin-Opener-Policy: same-origin breaks the sign-in popup' }
      : { status: 'ok', id: 'next.coop', message: 'no COOP same-origin header in the config' },
  );
  return out;
}

function checkAuthRoute(root: string, facts: ProjectFacts): Finding[] {
  if (!facts.authUrl) {
    return [
      {
        status: 'warn',
        id: 'admin.auth-url',
        message: 'no admin.authUrl: on the live site editors can sign in only with a token',
      },
    ];
  }
  if (!facts.authUrl.startsWith('/') && !/^https?:\/\/[^/]+\/api\/editlet\/oauth/.test(facts.authUrl)) {
    return [{ status: 'ok', id: 'admin.auth-url', message: `${facts.authUrl} (hosted outside this app)` }];
  }
  const route = routeFile(root, 'api/editlet/oauth/[...path]', 'editlet/auth');
  return [
    { status: 'ok', id: 'admin.auth-url', message: facts.authUrl },
    route
      ? { status: 'ok', id: 'admin.auth-route', message: route }
      : {
          status: 'fail',
          id: 'admin.auth-route',
          message: `authUrl points into this app, but no route imports editlet/auth`,
        },
  ];
}

function checkAstro(root: string, facts: ProjectFacts): Finding[] {
  const text = facts.config?.text ?? '';
  const out: Finding[] = [];
  out.push(
    text.includes('editlet/astro') && /editlet\s*\(/.test(text)
      ? { status: 'ok', id: 'astro.integration', message: `${facts.config?.file} adds the integration` }
      : {
          status: 'fail',
          id: 'astro.integration',
          message: `${facts.config?.file} does not add editlet() to integrations`,
        },
  );
  const contentFile = firstFile(root, ['src/content.config.ts', 'src/content.config.mjs', 'src/content.config.js']);
  const content = contentFile ? (read(join(root, contentFile)) ?? '') : '';
  out.push(
    /editletCollections|editletLoader/.test(content)
      ? { status: 'ok', id: 'astro.collections', message: `${contentFile} uses the Editlet loader` }
      : {
          status: 'fail',
          id: 'astro.collections',
          message: 'src/content.config.ts does not use editletCollections or editletLoader',
        },
  );
  if (/\bbase\s*:\s*['"`]/.test(text)) {
    out.push({
      status: 'fail',
      id: 'astro.base',
      message: 'Astro `base` is not supported: the admin lives at /editlet/',
    });
  }
  out.push(...checkAuthRoute(root, facts));
  return out;
}

/** Env names the setup needs; never reads values. */
function checkEnv(ctx: DoctorContext, facts: ProjectFacts): Finding[] {
  const out: Finding[] = [];
  const needed: string[] = [];
  if (facts.authUrl && routeFile(ctx.root, 'api/editlet/oauth/[...path]', 'editlet/auth')) {
    needed.push('GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ALLOWED_ORIGINS');
  }
  if (facts.preview) needed.push('CMS_PREVIEW_SECRET', 'CMS_GITHUB_TOKEN');
  const example = read(join(ctx.root, '.env.example')) ?? '';
  const missing = needed.filter((name) => !new RegExp(`^\\s*${name}\\s*=`, 'm').test(example));
  if (needed.length > 0) {
    out.push(
      missing.length === 0
        ? { status: 'ok', id: 'env.example', message: `.env.example names ${needed.join(', ')}` }
        : { status: 'warn', id: 'env.example', message: `.env.example lacks ${missing.join(', ')}` },
    );
  }
  for (const file of ['.env', '.env.local', '.env.production']) {
    if (!existsSync(join(ctx.root, file))) continue;
    const ignored = ctx.exec('git', ['-C', ctx.root, 'check-ignore', '-q', file]).status === 0;
    if (!ignored)
      out.push({
        status: 'fail',
        id: 'env.ignored',
        message: `${file} is not git-ignored: its secrets would be committed`,
      });
  }
  if (needed.length > 0 && existsSync(join(ctx.root, '.vercel/project.json'))) {
    const res = ctx.exec('vercel', ['env', 'ls', '--cwd', ctx.root]);
    if (res.status === 0) {
      const absent = needed.filter((name) => !res.stdout.includes(name));
      out.push(
        absent.length === 0
          ? { status: 'ok', id: 'env.vercel', message: `Vercel has ${needed.join(', ')}` }
          : { status: 'fail', id: 'env.vercel', message: `Vercel project lacks ${absent.join(', ')}` },
      );
    } else {
      out.push({
        status: 'manual',
        id: 'env.vercel',
        message: `check ${needed.join(', ')} in the Vercel project settings`,
      });
    }
  }
  return out;
}

export async function localChecks(ctx: DoctorContext, facts: ProjectFacts): Promise<Finding[]> {
  const out = checkProject(ctx, facts);
  out.push(await checkContent(ctx.root));
  out.push(...(await checkUrls(ctx.root)));
  if (facts.framework === 'next') out.push(...checkNext(ctx.root, facts));
  if (facts.framework === 'astro') out.push(...checkAstro(ctx.root, facts));
  out.push(...checkEnv(ctx, facts));
  return out;
}
