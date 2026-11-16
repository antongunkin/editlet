import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, readdir, readFile, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Folders that hold one link per skill: Claude Code, and agents that read `.agents/skills` (Codex and others). */
const LINK_DIRS = ['.claude/skills', '.agents/skills'];
const MAIN = 'editlet';
const TARGETS = LINK_DIRS.map((dir) => `${dir}/${MAIN}`);
const SETTINGS = '.claude/settings.json';
const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR"/.claude/skills/editlet/scripts/guard.mjs';
const GUARD_MARKER = 'editlet/scripts/guard.mjs';

export interface LinkOptions {
  root: string;
  /**
   * The `editlet` skill folder, as invoked (not realpath'd). Every sibling folder with a `SKILL.md` (the package's
   * `skills/<name>/`) is linked too.
   */
  skillDir: string;
  check?: boolean;
  hooks?: boolean;
}

export class SettingsError extends Error {}

type Json = Record<string, unknown>;

const real = (path: string): Promise<string | null> => realpath(path).catch(() => null);

async function linkTarget(
  root: string,
  skillDir: string,
  skillReal: string,
  target: string,
  check: boolean,
): Promise<string> {
  const linkPath = join(root, target);
  const linkDir = dirname(linkPath);
  const stat = await lstat(linkPath).catch(() => null);
  if (stat && !stat.isSymbolicLink()) return `${target}: copy kept`;
  if (stat && (await real(linkPath)) === skillReal) return `${target}: already linked`;
  if (check) return `${target}: ${stat ? 'wrong link' : 'missing'}`;
  if (stat) await rm(linkPath);
  await mkdir(linkDir, { recursive: true });
  let wanted = relative(linkDir, skillDir);
  const lexicalWorks = (await real(resolve(linkDir, wanted))) === skillReal;
  if (!lexicalWorks || (!skillDir.startsWith(root + sep) && root !== (await real(root)))) {
    wanted = join(relative((await real(linkDir)) ?? linkDir, dirname(skillReal)), basename(skillReal));
  }
  await symlink(wanted, linkPath);
  return stat ? `${target}: fixed link` : `${target}: linked`;
}

/** Throws when the real skill folder is, or lies inside, one of the folders that hold the links. */
async function assertNotInLinkFolders(root: string, skillReal: string): Promise<void> {
  for (const dir of LINK_DIRS) {
    const folder = await real(join(root, dir));
    if (folder && (skillReal === folder || skillReal.startsWith(folder + sep))) {
      throw new SettingsError(
        `${dir}/${MAIN}: the skill folder resolves into a link folder, run link.mjs from the package`,
      );
    }
  }
}

/** The skills to link: the main skill plus every sibling folder with a SKILL.md, main first, then by name. */
async function skillNames(skillsRoot: string): Promise<string[]> {
  const entries = await readdir(skillsRoot, { withFileTypes: true }).catch(() => []);
  const names = entries
    .filter((e) => e.name !== MAIN && (e.isDirectory() || e.isSymbolicLink()))
    .filter((e) => existsSync(join(skillsRoot, e.name, 'SKILL.md')))
    .map((e) => e.name)
    .toSorted();
  return [MAIN, ...names];
}

/**
 * Links in the link folders that point into the package's skills folder at a skill that no longer exists (a skill
 * removed or renamed in a newer version). Removed in write mode.
 */
async function staleLinks(root: string, skillsRoot: string, names: string[], check: boolean): Promise<string[]> {
  const roots = [skillsRoot, (await real(skillsRoot)) ?? skillsRoot];
  const lines: string[] = [];
  for (const dir of LINK_DIRS) {
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isSymbolicLink() || names.includes(entry.name)) continue;
      const linkPath = join(root, dir, entry.name);
      const target = resolve(join(root, dir), await readlink(linkPath));
      if (existsSync(target) || !roots.some((r) => dirname(target) === r)) continue;
      if (!check) await rm(linkPath);
      lines.push(`${dir}/${entry.name}: ${check ? 'stale link' : 'stale link removed'}`);
    }
  }
  return lines;
}

async function readSettings(path: string): Promise<Json | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Json;
  } catch {
    throw new SettingsError(`${SETTINGS}: not valid JSON, left untouched`);
  }
}

function hasGuardHook(settings: Json): boolean {
  const hooks = settings.hooks as Json | undefined;
  const entries = Array.isArray(hooks?.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];
  return entries.some((entry) => {
    const list = (entry as { hooks?: unknown } | null)?.hooks;
    return (
      Array.isArray(list) &&
      list.some((hook) => {
        const command = (hook as { command?: unknown } | null)?.command;
        return typeof command === 'string' && command.includes(GUARD_MARKER);
      })
    );
  });
}

async function installHook(root: string, check: boolean): Promise<string> {
  const path = join(root, SETTINGS);
  const settings = (await readSettings(path)) ?? {};
  const existing = settings.hooks as unknown;
  if (existing !== undefined && (typeof existing !== 'object' || existing === null || Array.isArray(existing))) {
    throw new SettingsError(`${SETTINGS}: "hooks" is not an object, left untouched`);
  }
  const existingPre = (existing as Json | undefined)?.PreToolUse;
  if (existingPre !== undefined && !Array.isArray(existingPre)) {
    throw new SettingsError(`${SETTINGS}: "hooks.PreToolUse" is not an array, left untouched`);
  }
  if (hasGuardHook(settings)) return `${SETTINGS}: hook present`;
  if (check) return `${SETTINGS}: hook missing`;
  const hooks = (typeof settings.hooks === 'object' && settings.hooks !== null ? settings.hooks : {}) as Json;
  const pre = Array.isArray(hooks.PreToolUse) ? (hooks.PreToolUse as unknown[]) : [];
  hooks.PreToolUse = [...pre, { matcher: 'Bash', hooks: [{ type: 'command', command: HOOK_COMMAND }] }];
  settings.hooks = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`);
  return `${SETTINGS}: hook added`;
}

/** The hook only protects when `guard.mjs` exists and loads (Node exit 1 is a non-blocking hook error). */
function guardState(root: string): 'ok' | 'missing' | 'broken' {
  const guard = join(root, TARGETS[0]!, 'scripts/guard.mjs');
  if (!existsSync(guard)) return 'missing';
  const res = spawnSync(process.execPath, [guard], { input: '{"tool_name":"Read"}', encoding: 'utf8', timeout: 20000 });
  return res.status === 0 ? 'ok' : 'broken';
}

const under = (dir: string, link: string): boolean => dir === link || dir.startsWith(link + sep);

/**
 * When the script runs through an installed link, skillDir lies at/under a target path. Swap that link prefix for the
 * link's own target (one readlink, not a realpath) so the link keeps pointing at the real package folder.
 */
async function unwrapInstalledLink(root: string, skillDir: string): Promise<string> {
  let dir = skillDir;
  for (const target of TARGETS) {
    const linkPath = join(root, target);
    if (!under(dir, linkPath)) continue;
    const stat = await lstat(linkPath).catch(() => null);
    if (!stat?.isSymbolicLink()) continue;
    dir = join(resolve(dirname(linkPath), await readlink(linkPath)), dir.slice(linkPath.length));
  }
  for (const target of TARGETS) {
    if (under(dir, join(root, target))) {
      throw new SettingsError(`${target}: the skill folder resolves to a link path, run link.mjs from the package`);
    }
  }
  return dir;
}

/** Links the skills into the project and optionally installs the guard hook; returns the report lines. */
export async function linkSkill({ root, skillDir, check = false, hooks = false }: LinkOptions): Promise<string[]> {
  skillDir = await unwrapInstalledLink(root, skillDir);
  const skillReal = (await real(skillDir)) ?? skillDir;
  await assertNotInLinkFolders(root, skillReal);
  const skillsRoot = dirname(skillDir);
  const names = await skillNames(skillsRoot);
  const lines: string[] = [];
  for (const name of names) {
    const dir = name === MAIN ? skillDir : join(skillsRoot, name);
    const dirReal = name === MAIN ? skillReal : ((await real(dir)) ?? dir);
    for (const linkDir of LINK_DIRS) lines.push(await linkTarget(root, dir, dirReal, `${linkDir}/${name}`, check));
  }
  lines.push(...(await staleLinks(root, skillsRoot, names, check)));
  if (hooks) {
    lines.push(await installHook(root, check));
    const state = guardState(root);
    if (state !== 'ok') {
      lines.push(
        check
          ? `${SETTINGS}: guard ${state}`
          : `warning: ${TARGETS[0]}/scripts/guard.mjs is ${state}; the hook runs unguarded until it loads (build the skill, run npm install)`,
      );
    }
  }
  return lines;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let check = false;
  let hooks = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') check = true;
    else if (arg === '--hooks') hooks = true;
    else if (arg === '--root' && args[i + 1] !== undefined) root = resolve(args[++i]!);
    else {
      process.stderr.write('usage: link.mjs [--check] [--hooks] [--root <dir>]\n');
      process.exitCode = 2;
      return;
    }
  }
  // process.argv[1] keeps the path as invoked; import.meta.url is realpath'd by Node (pnpm store, /private/var).
  const skillDir = dirname(dirname(resolve(process.argv[1] ?? fileURLToPath(import.meta.url))));
  try {
    const lines = await linkSkill({ root, skillDir, check, hooks });
    process.stdout.write(`${lines.join('\n')}\n`);
    if (
      check &&
      lines.some((line) => /: (missing|hook missing|wrong link|stale link|guard missing|guard broken)$/.test(line))
    )
      process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof SettingsError)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

if (/^link\.(ts|mjs)$/.test(basename(process.argv[1] ?? ''))) await main();
