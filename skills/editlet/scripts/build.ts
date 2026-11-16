import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/** Entry scripts of the `editlet` skill. */
export const ENTRY_SCRIPTS = ['validate', 'types', 'schema', 'refs', 'guard', 'link', 'style'];

/** Entry scripts per skill folder under `skills/`; each is bundled into that skill's own `scripts/`. */
export const SKILL_SCRIPTS: Record<string, string[]> = {
  editlet: ENTRY_SCRIPTS,
  'editlet-setup': ['doctor'],
};

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const skillsDir = dirname(dirname(scriptsDir));

/** Bundles each existing entry script of `skill` into `<outdir>/<name>.mjs`; returns the written paths. */
export async function buildSkillScripts(outdir?: string, skill = 'editlet'): Promise<string[]> {
  const sourceDir = join(skillsDir, skill, 'scripts');
  const out = outdir ?? sourceDir;
  const names = (SKILL_SCRIPTS[skill] ?? []).filter((name) => existsSync(join(sourceDir, `${name}.ts`)));
  await build({
    entryPoints: names.map((name) => join(sourceDir, `${name}.ts`)),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['yaml', 'zod'],
    outdir: out,
    outExtension: { '.js': '.mjs' },
    logLevel: 'warning',
  });
  return names.map((name) => join(out, `${name}.mjs`));
}

if (import.meta.main) {
  for (const skill of Object.keys(SKILL_SCRIPTS)) {
    const written = await buildSkillScripts(undefined, skill);
    process.stdout.write(`${written.join('\n')}\n`);
  }
}
