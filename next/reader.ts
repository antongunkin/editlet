import { cache } from 'react';

import { assetUrl } from './assetUrl';
import type { PreviewRef } from './previewCookie';
import { readPreviewEnv } from './previewEnv';

import { EditletError, type Issue } from '../core/issues';
import { refKey } from '../core/paths';
import { entriesFromFiles } from '../core/project';
import { checkReferenceDepth, createResolver, findReferrers, type Resolved } from '../core/references';
import type { Schema } from '../core/schema';
import { normalizeData, validateEntry, type Entry } from '../core/validate';
import { mapFields } from '../core/walk';
import { DEFAULT_SCHEMA_PATH, listFiles } from '../node/fs';
import { readProject } from '../node/project';

export type AnyEntry = { collection: string; slug: string; data: object; body: string; ref?: PreviewRef };
export type RefKey<M> = { [C in keyof M & string]: `${C}/${string}` }[keyof M & string];
export type CollectionOf<R> = R extends `${infer C}/${string}` ? C : never;
export type { Resolved };

export interface ReaderOptions {
  root?: string;
  schemaPath?: string;
  /** Include entries with `draft: true`. Defaults to true outside production. */
  drafts?: boolean;
}

/**
 * Per-call options. `ref` (from `previewRef()`) makes a draft render read that commit from GitHub, not the disk, and
 * include `draft: true` entries (only a verified editor's render has a ref).
 */
export interface ReadOptions {
  ref?: PreviewRef;
  /**
   * Replace references with the entries they point at, this many levels deep (0–10, default 0: keep the
   * `collection/slug` strings). A reference to an entry this read does not show (a draft in production) is dropped.
   */
  depth?: number;
}

/** `getReferrers` options: `from` keeps only entries of one collection. */
export interface ReferrerOptions<C extends string = string> extends ReadOptions {
  from?: C;
}

type LoadedEntry = Entry & { ref?: PreviewRef };

interface Loaded {
  schema: Schema;
  /** Entries per collection, in file order. */
  byCollection: Map<string, LoadedEntry[]>;
  byRef: Map<string, LoadedEntry>;
}

const production = new Map<string, Promise<Loaded>>();

const describeIssue = (i: Issue) => `${i.file ?? ''}${i.file ? ': ' : ''}${i.path ? `${i.path} — ` : ''}${i.message}`;

function buildLoaded(
  schema: Schema,
  entries: Entry[],
  baseIssues: Issue[],
  fileExists: (path: string) => boolean,
  ref?: PreviewRef,
): Loaded {
  const issues = [...baseIssues];
  const refs = new Set(entries.map((e) => refKey(e.collection, e.slug)));
  for (const entry of entries) {
    issues.push(...validateEntry(schema, entry, { entryExists: (r) => refs.has(r), fileExists }));
  }
  if (issues.length > 0) {
    throw new EditletError(issues, `Invalid content:\n${issues.map(describeIssue).join('\n')}`);
  }

  const out: Loaded = { schema, byCollection: new Map(), byRef: new Map() };
  for (const entry of entries) {
    const collection = schema.collections[entry.collection];
    // Image sources become public URLs at any depth (inside `object` and `blocks` too).
    const data = mapFields(collection.fields, normalizeData(collection, entry.data), (field, value) => {
      const image = value as { src?: unknown } | undefined;
      return field.type === 'image' && image && typeof image.src === 'string'
        ? { ...image, src: assetUrl(entry, image.src) }
        : value;
    });
    const loaded = ref ? { ...entry, data, ref } : { ...entry, data };
    const list = out.byCollection.get(entry.collection) ?? [];
    list.push(loaded);
    out.byCollection.set(entry.collection, list);
    out.byRef.set(refKey(entry.collection, entry.slug), loaded);
  }
  return out;
}

async function load(root: string, schemaPath: string): Promise<Loaded> {
  const project = await readProject(root, schemaPath);
  const { schema, entries } = project;
  const files = new Set(await listFiles(root, schema.contentDir));
  return buildLoaded(schema, entries, project.issues, (p) => files.has(p));
}

const MAX_PREVIEW_SHAS = 20;
const previews = new Map<string, Promise<Loaded>>();

async function loadCommit(ref: PreviewRef): Promise<Loaded> {
  const token = process.env.CMS_GITHUB_TOKEN;
  if (!token) throw new Error('Draft render needs CMS_GITHUB_TOKEN in the server environment.');
  const env = readPreviewEnv();
  if (!env) throw new Error('Draft render needs the EDITLET_PREVIEW config; enable `admin.preview` in withEditlet.');
  const { readCommit } = await import('../github/commitReader');
  const { schema, files, paths } = await readCommit({
    token,
    owner: env.owner,
    repo: env.repo,
    schemaPath: env.schemaPath,
    sha: ref.sha,
  });
  const { entries, issues } = entriesFromFiles(schema, env.schemaPath, files);
  return buildLoaded(schema, entries, issues, (p) => paths.has(p), ref);
}

function loadPreview(ref: PreviewRef): Promise<Loaded> {
  let promise = previews.get(ref.sha);
  if (promise) {
    // Refresh recency so the oldest-used sha is the one evicted.
    previews.delete(ref.sha);
    previews.set(ref.sha, promise);
    return promise;
  }
  promise = loadCommit(ref);
  previews.set(ref.sha, promise);
  // A failed read must not stay memoised.
  promise.catch(() => {
    if (previews.get(ref.sha) === promise) previews.delete(ref.sha);
  });
  while (previews.size > MAX_PREVIEW_SHAS) previews.delete(previews.keys().next().value!);
  return promise;
}

const loadCached = cache((root: string, schemaPath: string): Promise<Loaded> => {
  if (process.env.NODE_ENV !== 'production') return load(root, schemaPath);
  const key = `${root}|${schemaPath}`;
  let promise = production.get(key);
  if (!promise) {
    promise = load(root, schemaPath);
    production.set(key, promise);
  }
  return promise;
});

const bySlug = (a: LoadedEntry, b: LoadedEntry) => a.slug.localeCompare(b.slug);

// Mapped constraint, not `Record<string, AnyEntry>`: the generated `EntryMap` is an interface (no index signature).
export function createReader<M extends { [K in keyof M]: AnyEntry } = Record<string, Entry>>(
  options: ReaderOptions = {},
) {
  const root = options.root ?? process.cwd();
  const schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const drafts = options.drafts ?? process.env.NODE_ENV !== 'production';
  // A `ref` render is a verified editor's draft render (the preview cookie): it shows `draft: true` entries too.
  const visible = (e: LoadedEntry) => drafts || e.ref !== undefined || e.data.draft !== true;

  // One resolver per loaded project: resolved subtrees are shared between reads of the same content.
  const resolvers = new WeakMap<Loaded, (entry: LoadedEntry, depth: number) => LoadedEntry>();
  function resolverOf(loaded: Loaded) {
    let resolve = resolvers.get(loaded);
    if (!resolve) {
      resolve = createResolver<LoadedEntry>(loaded.schema, (r) => {
        const found = loaded.byRef.get(r);
        return found && visible(found) ? found : undefined;
      });
      resolvers.set(loaded, resolve);
    }
    return resolve;
  }

  /** The source for a read, and how to hand its entries out (`depth` checked before anything loads). */
  async function open(read: ReadOptions) {
    const depth = read.depth ?? 0;
    checkReferenceDepth(depth);
    const loaded = await (read.ref ? loadPreview(read.ref) : loadCached(root, schemaPath));
    const resolve = resolverOf(loaded);
    return { loaded, out: (entry: LoadedEntry) => resolve(entry, depth) };
  }

  async function getEntries<C extends keyof M & string, D extends number = 0>(
    collection: C,
    read: ReadOptions & { depth?: D } = {},
  ): Promise<Resolved<M, M[C], D>[]> {
    const { loaded, out } = await open(read);
    const list = (loaded.byCollection.get(collection) ?? []).filter(visible);
    return list.toSorted(bySlug).map(out) as unknown as Resolved<M, M[C], D>[];
  }

  async function getEntry<C extends keyof M & string, D extends number = 0>(
    collection: C,
    slug = 'index',
    read: ReadOptions & { depth?: D } = {},
  ): Promise<Resolved<M, M[C], D> | undefined> {
    const { loaded, out } = await open(read);
    const found = (loaded.byCollection.get(collection) ?? []).find((e) => e.slug === slug && visible(e));
    return (found && out(found)) as unknown as Resolved<M, M[C], D> | undefined;
  }

  async function getRef<R extends RefKey<M>, D extends number = 0>(
    ref: R,
    read: ReadOptions & { depth?: D } = {},
  ): Promise<Resolved<M, M[CollectionOf<R> & keyof M], D> | undefined> {
    const i = ref.indexOf('/');
    return getEntry(ref.slice(0, i) as CollectionOf<R> & keyof M & string, ref.slice(i + 1), read) as Promise<
      Resolved<M, M[CollectionOf<R> & keyof M], D> | undefined
    >;
  }

  /**
   * Visible entries with a reference field pointing at `ref` ("used by"), sorted by collection, then slug. `from`
   * keeps one collection; `depth` resolves the referrers like the other reads do.
   */
  async function getReferrers<C extends keyof M & string = keyof M & string, D extends number = 0>(
    ref: RefKey<M>,
    read: ReferrerOptions<C> & { depth?: D } = {},
  ): Promise<Resolved<M, M[C], D>[]> {
    const { loaded, out } = await open(read);
    const pool =
      read.from === undefined ? [...loaded.byCollection.values()].flat() : (loaded.byCollection.get(read.from) ?? []);
    const found = findReferrers(loaded.schema, pool.filter(visible), ref).map((r) => r.entry);
    found.sort((a, b) => a.collection.localeCompare(b.collection) || bySlug(a, b));
    return found.map(out) as unknown as Resolved<M, M[C], D>[];
  }

  return { getEntries, getEntry, getRef, getReferrers };
}
