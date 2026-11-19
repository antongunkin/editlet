import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Anything that finds admin elements from outside the admin's own components (jsdom tests, Playwright e2e, the demo
 * sandbox's shim) uses roles, accessible names or `data-editlet="…"` hooks, never `.editlet-*` classes: the BEM
 * classes go away with the redesign (docs/admin/screens.md, Run).
 */
const REPO = join(import.meta.dirname, '../../../..');

const ROOTS = ['packages/editlet/admin/src', 'packages/editlet/admin/e2e', 'e2e', 'src/sandbox'];
const TEST_FILE = /(\.test\.tsx?|\.e2e\.ts|\/e2e\/site\.ts|\/test\/render\.tsx|\/shim\.ts)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === '__screenshots__') return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

describe('stable hooks', () => {
  it('no test, e2e or sandbox file selects an admin element by a .editlet-* class', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((root) => walk(join(REPO, root))).filter((f) => f !== import.meta.filename)) {
      if (!TEST_FILE.test(file)) continue;
      const found = new Set<string>();
      for (const m of readFileSync(file, 'utf8').matchAll(/\.editlet-[a-z][\w-]*/g)) found.add(m[0]);
      for (const m of readFileSync(file, 'utf8').matchAll(/className\)\.(?:toBe|toContain)\(\s*'(editlet-[\w -]*)'/g)) {
        found.add(`.${m[1]}`);
      }
      if (found.size) offenders.push(`${relative(REPO, file)}: ${[...found].join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
