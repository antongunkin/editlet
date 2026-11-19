import type { ProjectFacts } from './doctorLocal';
import type { DoctorContext, Finding } from './doctorTypes';

import type { Schema } from '../../../core/schema';
import { entryUrl } from '../../../core/urls';
import type { Entry } from '../../../core/validate';
import { CODEOWNERS_PATHS, ownersOf, parseCodeowners } from '../../../github/codeowners';

/** What the GitHub checks need from the local schema. */
export interface RepoStyle {
  base: string;
  /** `git.branchPrefix`, default `editlet/`. */
  prefix: string;
  contentDir: string;
  schemaPath: string;
  labels: string[];
}

interface LiveConfig {
  github?: { owner?: string; repo?: string; baseBranch?: string };
  authUrl?: string;
  preview?: boolean;
}

async function get(ctx: DoctorContext, url: string, init: RequestInit = {}): Promise<Response | null> {
  try {
    return await ctx.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
  } catch {
    return null;
  }
}

const COOP_BAD = (value: string | null) => value?.trim().toLowerCase() === 'same-origin';

/** Checks of the deployed site and its auth handler (`--url`). Returns the live config for the GitHub checks. */
export async function siteChecks(ctx: DoctorContext): Promise<{ findings: Finding[]; config: LiveConfig | null }> {
  const site = new URL(ctx.url!);
  const out: Finding[] = [];
  let config: LiveConfig | null = null;

  const cfg = await get(ctx, new URL('/editlet/config.json', site).href);
  if (cfg?.status === 200) {
    try {
      config = (await cfg.json()) as LiveConfig;
    } catch {
      config = null;
    }
  }
  if (!config) {
    out.push({ status: 'fail', id: 'site.config', message: `/editlet/config.json: ${cfg ? cfg.status : 'no answer'}` });
  } else if (!config.github?.owner || !config.github.repo || !config.github.baseBranch) {
    out.push({
      status: 'fail',
      id: 'site.config',
      message: 'config.json has no repository: "Editing on the live site is not set up"',
    });
  } else {
    const { owner, repo, baseBranch } = config.github;
    out.push({ status: 'ok', id: 'site.config', message: `${owner}/${repo}, base ${baseBranch}` });
  }

  const admin = await get(ctx, new URL('/editlet/index.html', site).href);
  out.push(
    admin?.status === 200
      ? { status: 'ok', id: 'site.admin', message: '/editlet/index.html is served' }
      : { status: 'fail', id: 'site.admin', message: `/editlet/index.html: ${admin ? admin.status : 'no answer'}` },
  );

  const devApi = await get(ctx, new URL('/__editlet/files', site).href);
  out.push(
    devApi?.status === 200
      ? {
          status: 'fail',
          id: 'site.dev-api',
          message: 'the dev file API answers on the live site: anyone can write files',
        }
      : { status: 'ok', id: 'site.dev-api', message: 'no dev file API' },
  );

  const page = await get(ctx, site.href);
  const coop = page?.headers.get('cross-origin-opener-policy') ?? null;
  out.push(
    COOP_BAD(coop)
      ? { status: 'fail', id: 'site.coop', message: 'the page sends Cross-Origin-Opener-Policy: same-origin' }
      : { status: 'ok', id: 'site.coop', message: `COOP ${coop ?? 'not set'}` },
  );

  out.push(...(await authChecks(ctx, site, config?.authUrl)));
  if (config?.preview) {
    out.push({
      status: 'manual',
      id: 'site.preview',
      message: 'draft preview is on: open ?editlet on a editlet/* branch and check the page shows the branch content',
    });
  }
  return { findings: out, config };
}

/** A path without its trailing `/` (the root stays `/`). */
const bare = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/**
 * One entry's page on the live site: the first collection in schema order whose `url` has `{slug}`, its first entry
 * by file name that is not a draft. A 2xx is `ok`; anything else is `warn` (the pattern may not match the routes).
 * No such collection: no check.
 */
export async function entryUrlCheck(
  ctx: DoctorContext,
  project: { schema: Schema; entries: Entry[] },
): Promise<Finding[]> {
  const { schema, entries } = project;
  const key = Object.keys(schema.collections).find((k) => schema.collections[k]?.url?.includes('{slug}'));
  if (!key) return [];
  // An invalid file name (`Hello_World.md`) has no page: `entryUrl` gives `null` for it.
  const entry = entries
    .filter((e) => e.collection === key && e.data.draft !== true && entryUrl(schema, key, e.slug) !== null)
    .toSorted((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))[0];
  if (!entry) {
    return [
      {
        status: 'manual',
        id: 'site.entry-url',
        message: `${key} has no published entry: open one of its pages by hand`,
      },
    ];
  }
  const path = entryUrl(schema, key, entry.slug) ?? '/';
  const url = new URL(path, ctx.url).href;
  const res = await get(ctx, url);
  if (res && res.status >= 200 && res.status < 300) {
    return [{ status: 'ok', id: 'site.entry-url', message: `${url} answers ${res.status}` }];
  }
  const where = res?.headers.get('location');
  // A redirect that only adds or drops the trailing `/`: the browser follows it, and the editor ignores the slash.
  const target = where && URL.canParse(where, url) ? new URL(where, url) : null;
  if (res && res.status >= 300 && res.status < 400 && target?.origin === new URL(url).origin) {
    if (bare(target.pathname) === bare(new URL(url).pathname)) {
      return [
        {
          status: 'ok',
          id: 'site.entry-url',
          message: `${url} redirects to ${target.pathname} (only the trailing / differs: match the site's slash in url)`,
        },
      ];
    }
  }
  const answer = !res ? 'no answer' : where ? `${res.status} to ${where}` : String(res.status);
  return [
    {
      status: 'warn',
      id: 'site.entry-url',
      message: `${url}: ${answer} (expected 2xx): the url of ${key} (${schema.collections[key]!.url}) may not match the site's routes`,
    },
  ];
}

async function authChecks(ctx: DoctorContext, site: URL, authUrl: string | undefined): Promise<Finding[]> {
  if (!authUrl) {
    return [{ status: 'warn', id: 'auth.url', message: 'config.json has no authUrl: only token sign-in is offered' }];
  }
  const base = new URL(authUrl, site).href.replace(/\/+$/, '');
  const out: Finding[] = [];
  const health = await get(ctx, `${base}/health`);
  out.push(
    health?.status === 204
      ? { status: 'ok', id: 'auth.health', message: `${base}/health answers 204` }
      : {
          status: 'fail',
          id: 'auth.health',
          message: `${base}/health: ${health ? health.status : 'no answer'} (expected 204)`,
        },
  );
  const start = await get(ctx, `${base}/auth?origin=${encodeURIComponent(site.origin)}`);
  const location = start?.headers.get('location') ?? '';
  if (start?.status === 302 && location.startsWith('https://github.com/login/oauth/authorize')) {
    const clientId = new URL(location).searchParams.get('client_id');
    out.push(
      clientId
        ? { status: 'ok', id: 'auth.origin', message: `${site.origin} is allowed; GitHub App client ${clientId}` }
        : {
            status: 'fail',
            id: 'auth.origin',
            message: 'the redirect to GitHub has no client_id: GITHUB_CLIENT_ID is empty',
          },
    );
  } else if (start?.status === 400) {
    out.push({ status: 'fail', id: 'auth.origin', message: `ALLOWED_ORIGINS does not list ${site.origin}` });
  } else {
    out.push({
      status: 'fail',
      id: 'auth.origin',
      message: `/auth: ${start ? start.status : 'no answer'} (expected 302 to GitHub)`,
    });
  }
  out.push({
    status: 'manual',
    id: 'auth.github-app',
    message: `GitHub App: callback URL ${base}/callback; Contents and Pull requests read/write, Deployments read; installed on the repo`,
  });
  return out;
}

function repoOf(
  ctx: DoctorContext,
  facts: ProjectFacts,
  config: LiveConfig | null,
): { owner: string; repo: string } | null {
  if (config?.github?.owner && config.github.repo) return { owner: config.github.owner, repo: config.github.repo };
  const fromConfig = /repo\s*:\s*['"`]([\w.-]+)\/([\w.-]+)['"`]/.exec(facts.config?.text ?? '');
  if (fromConfig) return { owner: fromConfig[1]!, repo: fromConfig[2]! };
  const remote = ctx.exec('git', ['-C', ctx.root, 'remote', 'get-url', 'origin']).stdout.trim();
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

const ghJson = (ctx: DoctorContext, path: string): unknown => {
  const res = ctx.exec('gh', ['api', path]);
  if (res.status !== 0) return undefined;
  try {
    return JSON.parse(res.stdout) as unknown;
  } catch {
    return undefined;
  }
};

type Rule = { type?: string; parameters?: Record<string, unknown> };

const types = (rules: unknown): string[] => (Array.isArray(rules) ? rules.map((r) => String((r as Rule).type)) : []);

/** The `CODEOWNERS` GitHub uses on `base`, through `gh api` (base64 contents), or `null`. */
function codeownersText(ctx: DoctorContext, slug: string, base: string): { path: string; text: string } | null {
  for (const path of CODEOWNERS_PATHS) {
    const file = ghJson(ctx, `repos/${slug}/contents/${path}?ref=${encodeURIComponent(base)}`) as
      | { content?: string }
      | undefined;
    if (typeof file?.content === 'string') return { path, text: Buffer.from(file.content, 'base64').toString('utf8') };
  }
  return null;
}

/**
 * The roles recipe (`references/roles.md`): Code Owners review on the base, a valid `CODEOWNERS`, branch creation
 * only under the prefix, push rules on private repos, and the pull request labels. Without `CODEOWNERS` the recipe is
 * not in use: one `manual` line, plus the labels check.
 */
function roleChecks(
  ctx: DoctorContext,
  slug: string,
  info: { private?: boolean; visibility?: string },
  baseRules: unknown,
  style: RepoStyle,
): Finding[] {
  const out: Finding[] = [];
  const { base, prefix } = style;
  const owners = codeownersText(ctx, slug, base);
  if (!owners) {
    out.push({
      status: 'manual',
      id: 'github.roles',
      message: 'roles not set up (optional): no CODEOWNERS on the base branch; see references/roles.md',
    });
  } else {
    const errors = ghJson(ctx, `repos/${slug}/codeowners/errors?ref=${encodeURIComponent(base)}`) as
      | { errors?: { line: number; message: string }[] }
      | undefined;
    const list = errors?.errors ?? [];
    const rules = parseCodeowners(owners.text);
    const content = ownersOf(rules, `${style.contentDir}/x.md`) ?? [];
    const schema = ownersOf(rules, style.schemaPath) ?? [];
    out.push(
      list.length > 0
        ? {
            status: 'fail',
            id: 'github.codeowners',
            message: `${owners.path}: ${list
              .slice(0, 3)
              .map((e) => `line ${e.line}: ${e.message.split('\n')[0]}`)
              .join('; ')}`,
          }
        : {
            status: 'ok',
            id: 'github.codeowners',
            message: `${owners.path}: content by ${content.join(' ') || 'nobody'}, schema by ${schema.join(' ') || 'nobody'}`,
          },
    );
    const pr = Array.isArray(baseRules)
      ? (baseRules as Rule[]).find((r) => r.type === 'pull_request')?.parameters
      : undefined;
    if (pr && (pr.require_code_owner_review !== true || pr.require_last_push_approval !== true)) {
      const missing = [
        pr.require_code_owner_review === true ? null : 'Require review from Code Owners',
        pr.require_last_push_approval === true ? null : 'Require approval of the most recent reviewable push',
      ].filter(Boolean);
      out.push({
        status: 'warn',
        id: 'github.code-owner-review',
        message: `${base} ruleset lacks: ${missing.join(', ')}`,
      });
    } else if (pr) {
      out.push({ status: 'ok', id: 'github.code-owner-review', message: `${base} requires Code Owners review` });
    }

    const outside = types(ghJson(ctx, `repos/${slug}/rules/branches/doctor-probe`));
    const inside = types(ghJson(ctx, `repos/${slug}/rules/branches/${prefix}doctor-probe`));
    if (inside.includes('creation')) {
      out.push({
        status: 'fail',
        id: 'github.creations',
        message: `a creation rule also covers ${prefix}*: the editor cannot create branches (exclude ${prefix}**/*)`,
      });
    } else {
      out.push(
        outside.includes('creation')
          ? { status: 'ok', id: 'github.creations', message: `only ${prefix}* branches can be created without bypass` }
          : {
              status: 'warn',
              id: 'github.creations',
              message: `anyone with write access can create any branch (add Restrict creations outside ${prefix}**/*)`,
            },
      );
    }

    if (info.private !== true) {
      out.push({
        status: 'manual',
        id: 'github.push-rules',
        message: 'push rules need a private or internal repository; CODEOWNERS keeps code changes waiting for owners',
      });
    } else {
      const sets = ghJson(ctx, `repos/${slug}/rulesets?targets=push`);
      const paths: string[] = [];
      let bypassHidden = false;
      for (const set of Array.isArray(sets) ? (sets as { id: number; enforcement?: string }[]) : []) {
        if (set.enforcement !== 'active') continue;
        const full = ghJson(ctx, `repos/${slug}/rulesets/${set.id}`) as
          | { rules?: Rule[]; bypass_actors?: unknown[] }
          | undefined;
        if (full && full.bypass_actors === undefined) bypassHidden = true;
        for (const rule of full?.rules ?? []) {
          if (rule.type !== 'file_path_restriction') continue;
          const restricted = rule.parameters?.restricted_file_paths;
          if (Array.isArray(restricted)) paths.push(...restricted.map(String));
        }
      }
      const covers = paths.some((p) => p === '**/*' || p === style.schemaPath);
      out.push(
        covers
          ? { status: 'ok', id: 'github.push-rules', message: `push rules restrict ${paths.join(', ')}` }
          : {
              status: 'warn',
              id: 'github.push-rules',
              message: `no push rule keeps editors out of ${style.schemaPath} and code (Restrict file paths)`,
            },
      );
      if (bypassHidden) {
        out.push({
          status: 'manual',
          id: 'github.bypass',
          message: 'GitHub hides who bypasses the push rules from this account: check that only admins do',
        });
      }
    }
  }

  for (const label of style.labels) {
    const found = ghJson(ctx, `repos/${slug}/labels/${encodeURIComponent(label)}`);
    out.push(
      found
        ? { status: 'ok', id: 'github.labels', message: `label ${label} exists` }
        : {
            status: 'warn',
            id: 'github.labels',
            message: `label ${label} does not exist: pull requests may open without it (gh label create ${label})`,
          },
    );
  }
  return out;
}

/** Read-only GitHub checks through `gh api` (GET only). */
export function githubChecks(
  ctx: DoctorContext,
  facts: ProjectFacts,
  config: LiveConfig | null,
  style: RepoStyle,
): Finding[] {
  const { base } = style;
  const repo = repoOf(ctx, facts, config);
  if (!repo)
    return [
      { status: 'manual', id: 'github.repo', message: 'no GitHub repository found (admin.repo or the origin remote)' },
    ];
  if (ctx.exec('gh', ['auth', 'status']).status !== 0) {
    return [
      { status: 'manual', id: 'github.repo', message: `gh is not logged in: check ${repo.owner}/${repo.repo} by hand` },
    ];
  }
  const slug = `${repo.owner}/${repo.repo}`;
  const info = ghJson(ctx, `repos/${slug}`) as { permissions?: { push?: boolean }; private?: boolean } | undefined;
  if (!info) return [{ status: 'fail', id: 'github.repo', message: `${slug}: not found or no access` }];
  const out: Finding[] = [
    info.permissions?.push
      ? { status: 'ok', id: 'github.repo', message: `${slug}: you can push` }
      : { status: 'warn', id: 'github.repo', message: `${slug}: your account cannot push` },
  ];
  const rules = ghJson(ctx, `repos/${slug}/rules/branches/${base}`);
  const hasPrRule = Array.isArray(rules) && rules.some((r) => (r as { type?: string }).type === 'pull_request');
  const classic = hasPrRule
    ? undefined
    : (ghJson(ctx, `repos/${slug}/branches/${base}/protection`) as
        | { required_pull_request_reviews?: unknown }
        | undefined);
  out.push(
    hasPrRule || classic?.required_pull_request_reviews
      ? { status: 'ok', id: 'github.protection', message: `${base} requires a pull request` }
      : { status: 'warn', id: 'github.protection', message: `${base} has no rule that requires a pull request` },
  );
  const deployments = ghJson(ctx, `repos/${slug}/deployments?per_page=30`);
  const envs = Array.isArray(deployments)
    ? deployments.map((d) => String((d as { environment?: string }).environment))
    : [];
  out.push(
    envs.some((e) => !/production/i.test(e))
      ? { status: 'ok', id: 'github.deployments', message: 'the host reports branch preview deployments' }
      : {
          status: 'warn',
          id: 'github.deployments',
          message: 'no preview deployments reported: the branch screen shows no preview',
        },
  );
  out.push(...roleChecks(ctx, slug, info, rules, style));
  return out;
}
