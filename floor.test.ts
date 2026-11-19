// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The package's runtime floor is Node 22.12 (`engines.node`), but the repo runs on Node 26 and CI too. The shipped
 * code is type-checked against the floor (`tsconfig.build.json`, `npm run ts-check:floor`); this test covers what
 * types cannot: test files, scripts and the Node-only APIs `@types/node` 26 knows. It scans the package's sources for
 * a short list of APIs that arrived after Node 22.12 (the version names are the first Node release that has them).
 */
const BANNED: { name: string; pattern: RegExp }[] = [
  // Uint8Array base64 and hex: Node 25.
  { name: 'Uint8Array base64/hex methods (Node 25)', pattern: /\.(toBase64|fromBase64|setFromBase64|toHex|fromHex)\(/ },
  // RegExp.escape: Node 24.
  { name: 'RegExp.escape (Node 24)', pattern: /RegExp\.escape\(/ },
  // Promise.try: Node 23.
  { name: 'Promise.try (Node 23)', pattern: /Promise\.try\(/ },
  // Error.isError: Node 24.
  { name: 'Error.isError (Node 24)', pattern: /Error\.isError\(/ },
  // Float16Array, Math.f16round: Node 24.
  { name: 'Float16Array (Node 24)', pattern: /Float16Array/ },
  // Math.sumPrecise and Iterator.concat: not in Node 22 or 24.
  { name: 'Math.sumPrecise (after Node 24)', pattern: /Math\.sumPrecise\(/ },
  { name: 'Iterator.concat (after Node 24)', pattern: /Iterator\.concat\(/ },
  // Explicit resource management, `using x = …`: Node 24.
  { name: '`using` declaration (Node 24)', pattern: /^\s*(await\s+)?using\s+\w+\s*=/ },
];

const ROOT = import.meta.dirname;
const SKIP_DIRS = new Set(['dist', 'node_modules', '__fixtures__']);
const SOURCE = /\.(ts|tsx|mjs)$/;
/** The skills' `scripts/*.mjs` are bundled output of the `.ts` next to them (git-ignored, absent before `skill:build`). */
const BUNDLED = /^skills\/[^/]+\/scripts\/[^/]+\.mjs$/;

function* sources(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sources(path);
    } else if (SOURCE.test(entry.name) && path !== import.meta.filename && !BUNDLED.test(relative(ROOT, path))) {
      yield path;
    }
  }
}

/** Every banned API used in `text`, as `file:line: name`. */
export function findBanned(file: string, text: string): string[] {
  const found: string[] = [];
  text.split('\n').forEach((line, i) => {
    for (const { name, pattern } of BANNED) {
      if (pattern.test(line)) found.push(`${file}:${i + 1}: ${name}`);
    }
  });
  return found;
}

describe("the package's Node 22.12 floor", () => {
  it('uses no API that arrived after Node 22.12', () => {
    const found = [...sources(ROOT)].flatMap((path) => findBanned(relative(ROOT, path), readFileSync(path, 'utf8')));
    expect(found).toEqual([]);
  });

  it('finds each banned API in a sample, and not the package’s own base64 functions', () => {
    const sample = [
      'bytes.toBase64()',
      'Uint8Array.fromHex(s)',
      'RegExp.escape(x)',
      'await Promise.try(f)',
      'Error.isError(e)',
      'new Float16Array(2)',
      'Math.sumPrecise(xs)',
      'Iterator.concat(a, b)',
      '  using handle = open()',
    ];
    expect(sample.flatMap((line) => findBanned('sample.ts', line))).toHaveLength(sample.length);
    expect(findBanned('base64.ts', 'const b = toBase64(bytes); fromBase64(text); reusing = 1')).toEqual([]);
  });
});
