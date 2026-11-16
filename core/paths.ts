import { EditletError } from './issues';
import type { Schema } from './schema';

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fail(message: string): never {
  throw new EditletError([{ path: '', message }]);
}

function hasCollection(schema: Schema, collection: string): boolean {
  return Object.hasOwn(schema.collections, collection);
}

/**
 * `<contentDir>/<collection>/<slug>.md` (`index.md` for a singleton) without any validation; never throws. Use
 * `entryPath` when the collection and slug come from outside.
 */
export function entryFilePath(schema: Schema, collection: string, slug: string): string {
  const singleton = hasCollection(schema, collection) && schema.collections[collection].singleton;
  return `${schema.contentDir}/${collection}/${singleton ? 'index' : slug}.md`;
}

export function entryPath(schema: Schema, collection: string, slug?: string): string {
  if (!hasCollection(schema, collection)) return fail(`Unknown collection "${collection}"`);
  if (!schema.collections[collection].singleton && (slug === undefined || !isValidSlug(slug)))
    return fail(`Invalid slug "${slug ?? ''}" for collection "${collection}"`);
  return entryFilePath(schema, collection, slug ?? 'index');
}

/**
 * A relative posix path: no empty, `.` or `..` segments (so no leading or trailing slash), no backslash, NUL or
 * `:` (rules out drive letters and URL schemes).
 */
export function isCanonicalPath(path: string): boolean {
  if (path === '' || /[\\\0:]/.test(path)) return false;
  return path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** True when a segment below `contentDir` starts with `.`: dot files and dot directories are hidden. */
export function isHiddenContentPath(schema: Schema, path: string): boolean {
  const prefix = `${schema.contentDir}/`;
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return rest.split('/').some((seg) => seg.startsWith('.'));
}

export function parseEntryPath(schema: Schema, path: string): { collection: string; slug: string } | null {
  const prefix = `${schema.contentDir}/`;
  if (!path.startsWith(prefix) || !isCanonicalPath(path)) return null;
  const parts = path.slice(prefix.length).split('/');
  if (parts.length !== 2) return null;
  const [collection, file] = parts;
  if (!hasCollection(schema, collection) || !file.endsWith('.md')) return null;
  const name = file.slice(0, -3);
  if (name === '') return null;
  if (schema.collections[collection].singleton) return file === 'index.md' ? { collection, slug: 'index' } : null;
  return { collection, slug: name };
}

export function resolveAssetPath(schema: Schema, entryFile: string, src: string): string | null {
  if (src === '' || src.startsWith('/') || src.includes('\\') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return null;
  const srcSegs = src.split('/');
  const last = srcSegs[srcSegs.length - 1];
  if (last === '' || last === '.' || last === '..') return null;
  const out = entryFile.split('/').slice(0, -1);
  for (const seg of srcSegs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(seg);
  }
  const result = out.join('/');
  return result.startsWith(`${schema.contentDir}/`) ? result : null;
}

/** Inverse of `resolveAssetPath`: the `src` for `assetPath` relative to the entry file's folder. */
export function relativeAssetSrc(entryFile: string, assetPath: string): string {
  const from = entryFile.split('/').slice(0, -1);
  const to = assetPath.split('/');
  let common = 0;
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++;
  return '../'.repeat(from.length - common) + to.slice(common).join('/');
}

export function refKey(collection: string, slug: string): string {
  return `${collection}/${slug}`;
}

export function parseRefKey(ref: string): { collection: string; slug: string } | null {
  const parts = ref.split('/');
  if (parts.length !== 2) return null;
  const [collection, slug] = parts;
  if (collection === '' || !isValidSlug(slug)) return null;
  return { collection, slug };
}

export const IMAGE_EXTENSIONS: readonly string[] = ['webp', 'png', 'jpg', 'jpeg', 'avif', 'gif', 'svg'];

export function isImagePath(path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 && IMAGE_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase());
}
