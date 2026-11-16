import { GitHubError, type GitHubClient } from './client.ts';

/** One valid `CODEOWNERS` line: its pattern and owners (`@login`, `@org/team` or an email; may be empty). */
export interface CodeownersRule {
  pattern: string;
  owners: string[];
  /** 1-based line number in the file. */
  line: number;
  regex: RegExp;
}

/** Where GitHub looks, first found wins. */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'] as const;

const escape = (c: string) => c.replace(/[.+^${}()|\\]/g, '\\$&');

/**
 * A `.gitignore`-style pattern as GitHub reads `CODEOWNERS`: `!`, `[ ]` and `\` escapes are not supported (`null`).
 * A pattern without an inner `/` matches at any depth; a leading `/` or an inner one anchors it at the root; a trailing
 * `/` matches everything inside the directory; a last segment without wildcards also matches a directory and its
 * contents (`docs/*` matches `docs/a.md`, not `docs/a/b.md`).
 */
export function compilePattern(pattern: string): RegExp | null {
  if (pattern.startsWith('!') || /[[\]\\]/.test(pattern)) return null;
  let p = pattern;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.includes('/');
  if (p.startsWith('/')) p = p.slice(1);
  if (p === '') return null;
  let re = '';
  for (let i = 0; i < p.length;) {
    if (p.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
    } else if (p.startsWith('/**', i) && i + 3 === p.length) {
      re += '(?:/.*)?';
      i += 3;
    } else if (p.startsWith('**', i)) {
      re += '.*';
      i += 2;
    } else if (p[i] === '*') {
      re += '[^/]*';
      i += 1;
    } else if (p[i] === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += escape(p[i]!);
      i += 1;
    }
  }
  const literalLast = !/[*?]/.test(p.split('/').pop()!);
  const tail = dirOnly ? '/.*' : literalLast ? '(?:/.*)?' : '';
  return new RegExp(`^${anchored ? '' : '(?:.*/)?'}${re}${tail}$`);
}

/** The valid rules of a `CODEOWNERS` file, in file order. Comment, blank and unsupported lines are skipped, as GitHub does. */
export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const tokens = raw.trim().split(/\s+/);
    const [pattern, ...rest] = tokens;
    if (!pattern || pattern.startsWith('#')) return;
    const regex = compilePattern(pattern);
    if (!regex) return;
    const comment = rest.findIndex((t) => t.startsWith('#'));
    const owners = (comment < 0 ? rest : rest.slice(0, comment)).filter((t) => t.includes('@'));
    rules.push({ pattern, owners, line: i + 1, regex });
  });
  return rules;
}

/** Owners of `path` by the last matching rule; `[]` when that rule names none, `null` when no rule matches. */
export function ownersOf(rules: CodeownersRule[], path: string): string[] | null {
  for (let i = rules.length - 1; i >= 0; i--) if (rules[i]!.regex.test(path)) return rules[i]!.owners;
  return null;
}

/** The owners of several paths, deduplicated, in first-seen order. */
export function ownersOfAll(rules: CodeownersRule[], paths: string[]): string[] {
  return [...new Set(paths.flatMap((p) => ownersOf(rules, p) ?? []))];
}

/**
 * The `CODEOWNERS` file GitHub uses on `ref` (`.github/`, then the root, then `docs/`), or `null` when there is none.
 * One `GET contents` per location tried; needs Contents read.
 */
export async function readCodeowners(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
): Promise<{ path: string; text: string } | null> {
  for (const path of CODEOWNERS_PATHS) {
    try {
      const body = await client.rest<Uint8Array>('GET', `/repos/${owner}/${repo}/contents/${path}`, {
        query: { ref },
        raw: true,
        accept: 'application/vnd.github.raw+json',
      });
      return { path, text: new TextDecoder().decode(body) };
    } catch (error) {
      if (error instanceof GitHubError && error.code === 'not_found') continue;
      throw error;
    }
  }
  return null;
}
