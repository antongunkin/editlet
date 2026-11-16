/**
 * Renaming an entry's slug and deleting an entry, with every reference to it rewritten in the same change (P21).
 * Pure planning: the caller reads files, serializes the rewritten entries and commits (admin) or writes (skill).
 */
import { applyImageEdits, findImageRefs, type ImageUseEdit } from './assets';
import { EditletError } from './issues';
import { entryFilePath, isValidSlug, refKey, relativeAssetSrc } from './paths';
import { replaceReference } from './references';
import type { Schema } from './schema';

/** One entry file as the planner needs it; `E` carries the caller's own fields (sha, key order, text) through. */
export interface PlanEntry {
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
}

/** An entry to write: `entry` is the input it comes from; `path` is where it goes (new for the renamed entry). */
export interface EntryRewrite<E extends PlanEntry> {
  entry: E;
  path: string;
  data: Record<string, unknown>;
  body: string;
  /** Why it changes: `renamed` (the entry itself), `references` (a reference to it), `images` (an image `src`). */
  reasons: ('renamed' | 'references' | 'images')[];
  /**
   * The values that change, as text: a reference (`question/role` → `question/team-role`, or `to: null` when it is
   * removed) and image sources (`role/a.webp` → `team-role/a.webp`). A text editor can try exactly these edits and
   * check the result against `data` and `body`.
   */
  replacements: { from: string; to: string | null }[];
}

export interface RenamePlan<E extends PlanEntry> {
  from: string;
  to: string;
  /** The renamed entry at its new path first, then every other entry that changes, in input order. */
  write: EntryRewrite<E>[];
  /** Files to delete: the old entry file. Moved assets' old paths are in `move`. */
  remove: string[];
  /** Files of the entry's folder to move (read `from`, write `to`, delete `from`). */
  move: { from: string; to: string }[];
}

export interface RemovePlan<E extends PlanEntry> {
  ref: string;
  /** Entries whose references to `ref` are removed. */
  write: EntryRewrite<E>[];
  /** The entry file. Its images stay, as with a plain delete. */
  remove: string[];
}

const fail = (message: string): never => {
  throw new EditletError([{ path: '', message }]);
};

function entryOf<E extends PlanEntry>(schema: Schema, entries: E[], ref: string): E {
  const i = ref.indexOf('/');
  const collection = ref.slice(0, i);
  const slug = ref.slice(i + 1);
  if (!Object.hasOwn(schema.collections, collection)) fail(`Unknown collection "${collection}"`);
  const entry = entries.find((e) => e.collection === collection && e.slug === slug);
  return entry ?? fail(`Entry not found: ${ref}`);
}

/**
 * Plans renaming `ref` (`collection/slug`) to the slug `to`: the entry moves to `<to>.md`, the files of its folder
 * `<slug>/` move to `<to>/`, every reference to it (in `entries`, at any depth, the entry's own included) points at
 * the new ref, and every image `src` (in `entries`) that pointed into the moved folder points at the new path.
 * `files` are the repository paths that exist (to find the folder's files and to check the new slug is free).
 * Throws `EditletError` for a singleton, an invalid or taken slug, or an unknown entry.
 */
export function planRename<E extends PlanEntry>(
  schema: Schema,
  entries: E[],
  files: Iterable<string>,
  ref: string,
  to: string,
): RenamePlan<E> {
  const entry = entryOf(schema, entries, ref);
  const { collection, slug } = entry;
  if (schema.collections[collection]!.singleton) fail('A singleton cannot be renamed: its slug is always "index"');
  if (!isValidSlug(to)) fail(`Invalid slug "${to}": use lowercase letters, digits and single hyphens`);
  if (to === slug) fail('The new slug is the same as the old one');
  const oldPath = entryFilePath(schema, collection, slug);
  const newPath = entryFilePath(schema, collection, to);
  const oldDir = `${schema.contentDir}/${collection}/${slug}/`;
  const newDir = `${schema.contentDir}/${collection}/${to}/`;
  const paths = [...files];
  if (paths.some((p) => p === newPath || p.startsWith(newDir))) fail(`${collection}/${to} is taken`);

  const move = paths.filter((p) => p.startsWith(oldDir)).map((p) => ({ from: p, to: newDir + p.slice(oldDir.length) }));
  const moved = new Map(move.map((m) => [m.from, m.to]));
  const newRef = refKey(collection, to);

  const write: EntryRewrite<E>[] = [];
  for (const e of entries) {
    const isSelf = e === entry;
    const path = isSelf ? newPath : entryFilePath(schema, e.collection, e.slug);
    const def = schema.collections[e.collection];
    if (!def) continue;
    const reasons: EntryRewrite<E>['reasons'] = isSelf ? ['renamed'] : [];
    const replacements: EntryRewrite<E>['replacements'] = [];
    let data = e.data;
    const replaced = replaceReference(def, data, ref, newRef);
    if (replaced) {
      data = replaced;
      reasons.push('references');
      replacements.push({ from: ref, to: newRef });
    }
    // Sources resolve against the file's old path; the new `src` is relative to where the file will be.
    const edits: ImageUseEdit[] = findImageRefs(schema, def, isSelf ? oldPath : path, data, e.body).flatMap((use) => {
      const target = use.path === null ? undefined : moved.get(use.path);
      return target === undefined ? [] : [{ use, src: relativeAssetSrc(path, target) }];
    });
    let body = e.body;
    if (edits.length > 0) {
      ({ data, body } = applyImageEdits(data, body, edits));
      reasons.push('images');
      for (const { use, src } of edits) {
        if (!replacements.some((r) => r.from === use.src)) replacements.push({ from: use.src, to: src! });
      }
    }
    if (reasons.length > 0) write.push({ entry: e, path, data, body, reasons, replacements });
  }
  write.sort((a, b) => Number(b.entry === entry) - Number(a.entry === entry));
  return { from: ref, to: newRef, write, remove: [oldPath], move };
}

/**
 * Plans deleting `ref` with every reference to it removed from `entries` (a list loses the item, a single field its
 * key; at any depth). The rewritten entries may now break the schema (a required reference, `min`): validate them
 * before committing. Throws `EditletError` for an unknown entry.
 */
export function planRemove<E extends PlanEntry>(schema: Schema, entries: E[], ref: string): RemovePlan<E> {
  const entry = entryOf(schema, entries, ref);
  const write: EntryRewrite<E>[] = [];
  for (const e of entries) {
    if (e === entry) continue;
    const def = schema.collections[e.collection];
    const data = def ? replaceReference(def, e.data, ref, null) : null;
    if (data) {
      const path = entryFilePath(schema, e.collection, e.slug);
      write.push({
        entry: e,
        path,
        data,
        body: e.body,
        reasons: ['references'],
        replacements: [{ from: ref, to: null }],
      });
    }
  }
  return { ref, write, remove: [entryFilePath(schema, entry.collection, entry.slug)] };
}
