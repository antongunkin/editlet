/**
 * Astro content layer for Editlet (`editlet/astro/content`): one loader per schema collection. Entries are
 * validated with the core rules (the same as the admin and `editlet:validate`), not with Astro's `parseData`.
 */
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineCollection } from 'astro/content/config';
import type { Loader, LoaderContext } from 'astro/loaders';
import { z } from 'zod';

import { DEFAULT_SCHEMA_PATH, getAstroState } from './shared';

import { EditletError, type Issue } from '../core/issues';
import { entryFilePath, parseRefKey, refKey } from '../core/paths';
import { BLOCK_KEY, parseSchemaText, type Collection, type Field, type Schema } from '../core/schema';
import { normalizeData, validateEntry } from '../core/validate';
import { mapFields } from '../core/walk';
import { listFiles } from '../node/fs';
import { readProject } from '../node/project';

export interface EditletLoaderOptions {
  /** Schema file relative to the Astro root; defaults to the integration's `schemaPath`, then `cms/schema.json`. */
  schemaPath?: string;
}

function toAstroRef(ref: unknown): unknown {
  if (typeof ref !== 'string') return ref;
  const parsed = parseRefKey(ref);
  return parsed ? { collection: parsed.collection, id: parsed.slug } : ref;
}

/**
 * `normalizeData` output in the shape Astro expects: image `src` becomes an `__ASTRO_IMAGE_` import (resolved by the
 * store relative to the entry file), references become `{ collection, id }` like Astro's `reference()`.
 */
export function toAstroData(collection: Collection, data: Record<string, unknown>): Record<string, unknown> {
  // At any depth: images and references inside `object` and `blocks` get the same shapes.
  return mapFields(collection.fields, normalizeData(collection, data), (field, value) => {
    if (field.type === 'image' && typeof value === 'object' && value !== null) {
      const image = value as { src?: unknown };
      if (typeof image.src !== 'string') return value;
      const src = image.src.startsWith('.') ? image.src : `./${image.src}`;
      return { ...image, src: `__ASTRO_IMAGE_${src}` };
    }
    if (field.type === 'reference') return Array.isArray(value) ? value.map(toAstroRef) : toAstroRef(value);
    return value;
  });
}

const quote = (v: string) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const array = (type: string) => (type.includes(' | ') ? `(${type})[]` : `${type}[]`);

function fieldType(field: Field): string {
  switch (field.type) {
    case 'string':
      return field.list ? 'string[]' : 'string';
    case 'text':
    case 'url':
    case 'color':
    case 'datetime':
    case 'markdown':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'json':
      return 'unknown';
    case 'select': {
      const union = field.options.map((o) => quote(o.value)).join(' | ');
      return field.multiple ? array(union) : union;
    }
    case 'image':
      return "{ src: import('astro').ImageMetadata; alt: string }";
    case 'reference': {
      const union = field.collections.map((c) => `{ collection: ${quote(c)}; id: string }`).join(' | ');
      return field.multiple ? array(union) : union;
    }
    case 'object': {
      const type = objectType(field.fields);
      return field.list ? `${type}[]` : type;
    }
    case 'blocks':
      return array(
        Object.entries(field.blocks)
          .map(([kind, block]) => objectType(block.fields, `${BLOCK_KEY}: ${quote(kind)}`))
          .join(' | '),
      );
  }
}

/** Inline type of nested fields; a nested `markdown` is a string. */
function objectType(fields: Record<string, Field>, first?: string): string {
  const parts = first === undefined ? [] : [first];
  for (const [key, field] of Object.entries(fields))
    parts.push(`${key}${field.required ? '' : '?'}: ${fieldType(field)}`);
  return `{ ${parts.join('; ')} }`;
}

/** TS module source for `createSchema().types`: the `Entry` type is what `CollectionEntry<…>['data']` becomes. */
export function astroTypes(collection: Collection): string {
  const lines = ['export type Entry = {'];
  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type === 'markdown') continue;
    lines.push(`  ${key}${field.required ? '' : '?'}: ${fieldType(field)};`);
  }
  lines.push('  draft?: boolean;', '};');
  return `${lines.join('\n')}\n`;
}

function formatIssue(issue: Issue): string {
  if (!issue.file) return `${issue.path || '(schema)'} — ${issue.message}`;
  return issue.path ? `${issue.file}: ${issue.path} — ${issue.message}` : `${issue.file} — ${issue.message}`;
}

/** One issue per line, `<file>: <path> — <message>` (the `editlet:validate` format). */
export function formatIssues(issues: Issue[]): string {
  return issues.map(formatIssue).join('\n');
}

function schemaPathOf(options: EditletLoaderOptions): string {
  return options.schemaPath ?? getAstroState()?.schemaPath ?? DEFAULT_SCHEMA_PATH;
}

function schemaError(issues: Issue[]): Error {
  return new Error(`Editlet: invalid schema\n${formatIssues(issues)}`);
}

function readSchemaSync(root: string, schemaPath: string): Schema {
  let text: string;
  try {
    text = readFileSync(join(root, schemaPath), 'utf8');
  } catch (error) {
    throw new Error(`Editlet: cannot read schema ${schemaPath}: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
  try {
    return parseSchemaText(text, schemaPath);
  } catch (error) {
    if (error instanceof EditletError) throw schemaError(error.issues);
    throw error;
  }
}

function collectionOf(schema: Schema, collection: string, schemaPath: string): Collection {
  if (!Object.hasOwn(schema.collections, collection)) {
    throw new Error(`Editlet: unknown collection "${collection}" in ${schemaPath}`);
  }
  return schema.collections[collection];
}

type Watcher = NonNullable<LoaderContext['watcher']>;

/** Per watcher: one set of listeners, re-sync callbacks keyed by Astro collection (repeated `load()` replaces). */
const watched = new WeakMap<Watcher, Map<string, { dir: string; resync: () => void }>>();

function watch(watcher: Watcher, key: string, dir: string, resync: () => void): void {
  let subs = watched.get(watcher);
  if (!subs) {
    const all = new Map<string, { dir: string; resync: () => void }>();
    const onEvent = (path: string) => {
      const abs = resolve(path);
      for (const sub of all.values()) if (abs === sub.dir || abs.startsWith(sub.dir + sep)) sub.resync();
    };
    for (const event of ['add', 'change', 'unlink'] as const) watcher.on(event, onEvent);
    watched.set(watcher, all);
    subs = all;
  }
  subs.set(key, { dir, resync });
  watcher.add(dir);
}

/** Content loader for one Editlet collection. Do not give the Astro collection a `schema`. */
export function editletLoader(collection: string, options: EditletLoaderOptions = {}): Loader {
  /** Absolute content directory, known once the schema has been read (even if the entries then fail). */
  let contentDir: string | undefined;

  async function sync(ctx: LoaderContext, root: string): Promise<void> {
    const schemaPath = schemaPathOf(options);
    let project;
    try {
      project = await readProject(root, schemaPath);
    } catch (error) {
      if (error instanceof EditletError) throw schemaError(error.issues);
      throw error;
    }
    const { schema } = project;
    contentDir = join(root, schema.contentDir);
    const col = collectionOf(schema, collection, schemaPath);
    const prefix = `${schema.contentDir}/${collection}/`;
    const refs = new Set(project.entries.map((e) => refKey(e.collection, e.slug)));
    const files = new Set(await listFiles(root, schema.contentDir));
    const own = project.entries.filter((e) => e.collection === collection);

    const issues = project.issues.filter((i) => i.file?.startsWith(prefix));
    for (const entry of own) {
      issues.push(
        ...validateEntry(schema, entry, { entryExists: (ref) => refs.has(ref), fileExists: (p) => files.has(p) }),
      );
    }
    if (issues.length > 0) {
      const sorted = issues.toSorted((a, b) => (a.file ?? '').localeCompare(b.file ?? ''));
      throw new Error(`Editlet: invalid content in "${collection}"\n${formatIssues(sorted)}`);
    }

    const dev = getAstroState()?.command === 'dev';
    // The digest covers the collection's schema too: the same file maps to other data after a schema change, and
    // Astro skips `store.set` when the digest is unchanged (its store survives restarts).
    const schemaText = JSON.stringify(col);
    const records = [];
    for (const entry of own) {
      if (entry.data.draft === true && !dev) continue;
      const filePath = entryFilePath(schema, collection, entry.slug);
      const fileText = await readFile(join(root, filePath), 'utf8');
      const rendered =
        entry.body.trim() !== ''
          ? await ctx.renderMarkdown(entry.body, { fileURL: pathToFileURL(join(root, filePath)) })
          : undefined;
      records.push({
        id: entry.slug,
        data: toAstroData(col, entry.data),
        body: entry.body,
        filePath,
        digest: ctx.generateDigest(`${schemaText}\n${fileText}`),
        rendered,
        assetImports: rendered?.metadata?.imagePaths,
      });
    }

    // Everything is validated and rendered: only now touch the store, so a failed re-sync keeps the old data.
    const seen = new Set(records.map((r) => r.id));
    for (const record of records) {
      // Astro rebuilds .astro/content-assets.mjs on `delete`, but on `set` only when the entry adds an image. So an
      // entry that lost an image would keep its import, and once the file is deleted every page fails. A changed entry
      // that had images is deleted first: the rebuild then keeps only the images still in use.
      const old = ctx.store.get(record.id);
      if (old?.assetImports?.length && old.digest !== record.digest) ctx.store.delete(record.id);
      ctx.store.set(record);
    }
    for (const id of ctx.store.keys()) if (!seen.has(id)) ctx.store.delete(id);
  }

  return {
    name: 'editlet',
    createSchema: async () => {
      const root = getAstroState()?.root ?? process.cwd();
      const schemaPath = schemaPathOf(options);
      const col = collectionOf(readSchemaSync(root, schemaPath), collection, schemaPath);
      return { schema: z.record(z.string(), z.unknown()), types: astroTypes(col) };
    },
    load: async (ctx) => {
      const root = fileURLToPath(ctx.config.root);
      try {
        await sync(ctx, root);
      } finally {
        // Watch even when the first sync fails, so fixing the file in dev reloads the collection.
        if (ctx.watcher && contentDir !== undefined) {
          let queue = Promise.resolve();
          const resync = () => {
            queue = queue.then(() =>
              sync(ctx, root).catch((error: unknown) =>
                ctx.logger.error(error instanceof Error ? error.message : String(error)),
              ),
            );
          };
          watch(ctx.watcher, ctx.collection, contentDir, resync);
        }
      }
    },
  };
}

/** One Astro collection per schema collection, for `export const collections = editletCollections()`. */
export function editletCollections(
  options: EditletLoaderOptions = {},
): Record<string, ReturnType<typeof defineCollection>> {
  const root = getAstroState()?.root ?? process.cwd();
  const schema = readSchemaSync(root, schemaPathOf(options));
  return Object.fromEntries(
    Object.keys(schema.collections).map((key) => [key, defineCollection({ loader: editletLoader(key, options) })]),
  );
}
