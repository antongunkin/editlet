import { isValidSlug } from './paths';
import type { Schema } from './schema';

/** The placeholders a collection's `url` may use. */
export const URL_PLACEHOLDERS = ['slug'] as const;

const URL_MAX = 200;
const PLACEHOLDER = /\{([^{}]*)\}/g;
/** Printable ASCII without a space and without the characters a path pattern cannot hold. */
const ALLOWED = /^[\x21-\x7e]*$/;
/** `?`, `#`, `\`, `%`, and what `location.pathname` percent-encodes (`"`, `<`, `>`, `` ` ``): such a path never matches. */
const FORBIDDEN = /[?#\\%"<>`]/;
/** A framework's route syntax (`[slug]`, `[...slug]`, `:slug`) written instead of `{slug}`. */
const ROUTE_SYNTAX = /\/(?:\[[^/]*\]|:[^/]+)(?:\/|$)/;

/**
 * Problems of a collection's `url` pattern, as messages (empty when it is valid): a path from the site's root, at most
 * 200 printable ASCII characters without `?`, `#`, `\`, `%`, `"`, `<`, `>`, `` ` ``, `//` or a `.` / `..` segment; no
 * `[slug]` / `:slug` route segment; not `/editlet` or `/__editlet` or under them; only `{slug}`, at most once, and
 * never in a singleton's.
 */
export function urlPatternIssues(pattern: string, singleton: boolean): string[] {
  const issues: string[] = [];
  const names = [...pattern.matchAll(PLACEHOLDER)].map((m) => m[1]!);
  const literal = pattern.replace(PLACEHOLDER, 'x');
  const segments = pattern.split('/').slice(1);
  if (
    !pattern.startsWith('/') ||
    pattern.length > URL_MAX ||
    !ALLOWED.test(pattern) ||
    FORBIDDEN.test(pattern) ||
    /[{}]/.test(literal) ||
    pattern.includes('//') ||
    segments.some((s) => s === '.' || s === '..')
  ) {
    issues.push(`url must be a path from the site's root, for example "/posts/{slug}"`);
  }
  if (ROUTE_SYNTAX.test(pattern)) issues.push('write the slug as {slug}, not as a route segment like [slug] or :slug');
  if (/^\/(?:editlet|__editlet)(?:\/|$)/.test(pattern)) {
    issues.push('url cannot be under /editlet/ or /__editlet');
  }
  for (const name of new Set(names)) {
    if (!(URL_PLACEHOLDERS as readonly string[]).includes(name)) {
      issues.push(`unknown placeholder "{${name}}" (use ${URL_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')})`);
    }
  }
  const slugs = names.filter((n) => n === 'slug').length;
  if (slugs > 1) issues.push('{slug} can appear only once');
  if (singleton && slugs > 0) issues.push('a singleton has one page: url cannot use {slug}');
  return issues;
}

/**
 * The path of an entry's page on the site (`url` with `{slug}` filled in); `null` when the collection has no `url`,
 * or its `url` has `{slug}` and `slug` is not a valid slug (so a half-typed name never makes `//x` or `/a/b`).
 */
export function entryUrl(schema: Schema, collection: string, slug: string): string | null {
  const url = schema.collections[collection]?.url;
  if (url === undefined) return null;
  if (!url.includes('{slug}')) return url;
  return isValidSlug(slug) ? url.replace('{slug}', () => slug) : null;
}

/** An entry (or, for a many-entry page without `{slug}`, a whole collection) shown at a path. */
export interface EntryUrlMatch {
  collection: string;
  /** The entry's slug; `index` for a singleton; absent for a collection whose every entry is on one page. */
  slug?: string;
}

/** `/posts/` and `/posts` are the same page; `/` stays `/`. */
function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The entries whose `url` gives `pathname` (no query, no hash; a trailing `/` is ignored on both sides), in schema
 * order. `{slug}` matches one valid slug. Patterns can overlap (`/{slug}` also matches an index page such as `/posts/`),
 * so a caller checks that the entry exists before naming it.
 */
export function matchEntryUrls(schema: Schema, pathname: string): EntryUrlMatch[] {
  const path = trimSlash(pathname);
  const matches: EntryUrlMatch[] = [];
  for (const [collection, col] of Object.entries(schema.collections)) {
    if (col.url === undefined) continue;
    const pattern = trimSlash(col.url);
    if (!pattern.includes('{slug}')) {
      if (pattern === path) matches.push(col.singleton ? { collection, slug: 'index' } : { collection });
      continue;
    }
    const [before, after] = pattern.split('{slug}') as [string, string];
    const slug = new RegExp(`^${escapeRegExp(before)}([^/]+)${escapeRegExp(after)}$`).exec(path)?.[1];
    if (slug !== undefined && isValidSlug(slug)) matches.push({ collection, slug });
  }
  return matches;
}
