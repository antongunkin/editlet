import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { localChecks, projectFacts } from './doctorLocal';
import { entryUrlCheck, githubChecks, siteChecks, type RepoStyle } from './doctorRemote';
import type { DoctorContext, Finding } from './doctorTypes';

import { resolveGitStyle } from '../../../core/gitStyle';
import type { GitConfig } from '../../../core/schema';
import { readProject } from '../../../node/project';

const SCHEMA_PATH = 'cms/schema.json';

/** Base branch, prefix, content folder and labels from the local schema (read as JSON; defaults when unreadable). */
function repoStyle(root: string): RepoStyle {
  let schema: { git?: Partial<GitConfig>; contentDir?: string } = {};
  try {
    schema = JSON.parse(readFileSync(join(root, SCHEMA_PATH), 'utf8')) as typeof schema;
  } catch {
    // The content check reports a missing or broken schema.
  }
  const git = schema.git ?? {};
  const style = resolveGitStyle({ ...git, baseBranch: git.baseBranch ?? 'main' });
  return {
    base: git.baseBranch ?? 'main',
    prefix: style.branchPrefix,
    contentDir: schema.contentDir ?? 'cms/content',
    schemaPath: SCHEMA_PATH,
    labels: style.pullRequest.labels,
  };
}

/** All checks for one project. Read-only; the network is used only with `ctx.url`. */
export async function doctor(ctx: DoctorContext): Promise<Finding[]> {
  const facts = projectFacts(ctx.root);
  const findings = await localChecks(ctx, facts);
  let config = null;
  if (ctx.url) {
    const site = await siteChecks(ctx);
    findings.push(...site.findings);
    config = site.config;
    const project = await readProject(ctx.root).catch(() => null);
    if (project) findings.push(...(await entryUrlCheck(ctx, project)));
  }
  if (ctx.url || facts.admin) findings.push(...githubChecks(ctx, facts, config, repoStyle(ctx.root)));
  return findings;
}

export function formatFinding(f: Finding): string {
  return `${f.status.padEnd(6)} ${f.id}: ${f.message}`;
}

const USAGE = 'usage: doctor.mjs [--root <dir>] [--url <https://site>] [--json]\n';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let url: string | undefined;
  let json = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') json = true;
    else if (arg === '--root' && args[i + 1]) root = resolve(args[++i]!);
    else if (arg === '--url' && args[i + 1] && URL.canParse(args[i + 1]!)) url = args[++i];
    else {
      process.stderr.write(USAGE);
      process.exitCode = 2;
      return;
    }
  }
  if (!existsSync(join(root, 'package.json'))) {
    process.stderr.write(`no package.json in ${root}\n`);
    process.exitCode = 2;
    return;
  }
  const findings = await doctor({
    root,
    url,
    nodeVersion: process.versions.node,
    exec: (cmd, cmdArgs) => {
      const res = spawnSync(cmd, cmdArgs, { cwd: root, encoding: 'utf8', timeout: 30_000 });
      return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
    },
    fetch: globalThis.fetch,
  });
  process.stdout.write(json ? `${JSON.stringify(findings, null, 2)}\n` : `${findings.map(formatFinding).join('\n')}\n`);
  if (findings.some((f) => f.status === 'fail')) process.exitCode = 1;
}

if (/^doctor\.(ts|mjs)$/.test(basename(process.argv[1] ?? ''))) await main();
