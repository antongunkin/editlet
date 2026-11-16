/**
 * References between entries: which fields hold them, who points at an entry, and replacing `collection/slug`
 * values with the entries themselves, a bounded number of levels deep.
 */
import type { Collection, Field, Schema } from './schema';
import type { Entry } from './validate';
import { allFields, mapFields, visitFields } from './walk';

export type ReferenceField = Extract<Field, { type: 'reference' }>;

/** Deepest `depth` the readers accept. */
export const MAX_REFERENCE_DEPTH = 10;

/**
 * The `reference` fields of a collection, nested ones inside `object` and `blocks` too, in schema order. The key is
 * the field's path in the schema tree joined by dots (`content.survey.survey` for a block kind's field).
 */
export function referenceFields(collection: Collection): [string, ReferenceField][] {
  return allFields(collection.fields)
    .filter((e): e is [string[], ReferenceField] => e[1].type === 'reference')
    .map(([path, field]) => [path.join('.'), field]);
}

/** True when some reference field of `collection` (nested ones too) may point at `target`. */
export function canReference(collection: Collection, target: string): boolean {
  return referenceFields(collection).some(([, f]) => f.collections.includes(target));
}

/**
 * Every `collection/slug` value in `data`, in field order and list order, nested ones too. `field` is the value's dot
 * path in the data (`author`, `content.2.survey`). Non-string values are skipped.
 */
export function entryReferences(
  collection: Collection,
  data: Record<string, unknown>,
): { field: string; ref: string }[] {
  const out: { field: string; ref: string }[] = [];
  visitFields(collection.fields, data, (field, value, at) => {
    if (field.type !== 'reference') return;
    for (const ref of Array.isArray(value) ? value : [value]) {
      if (typeof ref === 'string' && ref !== '') out.push({ field: at.join('.'), ref });
    }
  });
  return out;
}

/**
 * `data` with every reference to `from` replaced by `to` (rename), or removed when `to` is `null`: a list loses the
 * item (and the key when it is left empty), a single field loses its key. At any depth (inside `object` and `blocks`). `null` when nothing changed.
 */
export function replaceReference(
  collection: Collection,
  data: Record<string, unknown>,
  from: string,
  to: string | null,
): Record<string, unknown> | null {
  let changed = false;
  const out = mapFields(collection.fields, data, (field, value) => {
    if (field.type !== 'reference') return value;
    if (Array.isArray(value)) {
      if (!value.includes(from)) return value;
      changed = true;
      if (to !== null) return value.map((r) => (r === from ? to : r));
      const rest = value.filter((r) => r !== from);
      // An emptied list is left out, as the editor writes it.
      return rest.length > 0 ? rest : undefined;
    }
    if (value !== from) return value;
    changed = true;
    return to ?? undefined;
  });
  return changed ? out : null;
}

export interface Referrer<E extends Entry = Entry> {
  entry: E;
  /** The fields of `entry` that hold the reference, in field order: dot paths for nested ones (`content.2.survey`). */
  fields: string[];
}

/** Entries with a reference to `ref`, in the order of `entries`. An entry pointing at itself counts. */
export function findReferrers<E extends Entry>(schema: Schema, entries: Iterable<E>, ref: string): Referrer<E>[] {
  const out: Referrer<E>[] = [];
  for (const entry of entries) {
    if (!Object.hasOwn(schema.collections, entry.collection)) continue;
    const fields = entryReferences(schema.collections[entry.collection], entry.data)
      .filter((r) => r.ref === ref)
      .map((r) => r.field);
    if (fields.length > 0) out.push({ entry, fields: [...new Set(fields)] });
  }
  return out;
}

/** Throws `RangeError` unless `depth` is a whole number from 0 to `MAX_REFERENCE_DEPTH`. */
export function checkReferenceDepth(depth: number): void {
  if (!Number.isInteger(depth) || depth < 0 || depth > MAX_REFERENCE_DEPTH) {
    throw new RangeError(`depth must be a whole number from 0 to ${MAX_REFERENCE_DEPTH}, got ${depth}`);
  }
}

/**
 * A function that replaces reference values with the entries `lookup` finds, `depth` levels deep: at `depth` 1 the
 * entry's own references become entries (whose references stay strings), and so on. A reference `lookup` does not
 * find (a hidden draft) is dropped: a list loses the item, a single field loses the key. A cycle (A → B → A) just
 * repeats until the depth runs out, so the result is always a finite tree. Results are cached by entry and depth,
 * so one resolver shares subtrees between calls; build a new one when the entries change.
 */
export function createResolver<E extends Entry>(
  schema: Schema,
  lookup: (ref: string) => E | undefined,
): (entry: E, depth: number) => E {
  const memo = new Map<string, E>();
  const resolve = (entry: E, depth: number): E => {
    if (depth === 0 || !Object.hasOwn(schema.collections, entry.collection)) return entry;
    const key = `${depth}:${entry.collection}/${entry.slug}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const target = (ref: unknown) => {
      const found = typeof ref === 'string' ? lookup(ref) : undefined;
      return found === undefined ? undefined : resolve(found, depth - 1);
    };
    // References inside `object` and `blocks` resolve on the same level as the entry's own fields.
    const data = mapFields(schema.collections[entry.collection].fields, entry.data, (field, value) => {
      if (field.type !== 'reference') return value;
      return Array.isArray(value) ? value.flatMap((ref) => target(ref) ?? []) : target(value);
    });
    const out = { ...entry, data };
    memo.set(key, out);
    return out;
  };
  return (entry, depth) => {
    checkReferenceDepth(depth);
    return resolve(entry, depth);
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Types: the shape of a resolved entry, computed from the generated `EntryMap` (`.editlet/content.d.ts`).

type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * The collection a value type refers to: `` `section/${string}` `` gives `'section'`. Only the whole template
 * counts, so a select option value like `'post/x'` is not a reference.
 */
type TargetOf<M, V> = V extends `${infer C}/${string}`
  ? C extends keyof M & string
    ? `${C}/${string}` extends V
      ? C
      : never
    : never
  : never;

type ResolveRef<M, V, D extends number> = V extends unknown
  ? [TargetOf<M, V>] extends [never]
    ? V
    : number extends D
      ? V | Resolved<M, M[TargetOf<M, V>], D>
      : Resolved<M, M[TargetOf<M, V>], Prev[D]>
  : never;

/** A list item: a reference becomes an entry, an object (an `object` item or a block) is resolved inside. */
type ResolveItem<M, V, D extends number> = V extends string
  ? ResolveRef<M, V, D>
  : V extends readonly unknown[]
    ? ResolveValue<M, V, D>
    : V extends object
      ? ResolvedData<M, V, D>
      : V;

type ResolveValue<M, V, D extends number> = V extends readonly (infer I)[]
  ? ResolveItem<M, I, D>[]
  : V extends string
    ? // A single reference to a hidden draft is dropped, so a resolved single reference may be missing.
      ResolveRef<M, V, D> | ([TargetOf<M, V>] extends [never] ? never : undefined)
    : V extends object
      ? ResolvedData<M, V, D>
      : V;

/**
 * The entry type `E` (an `EntryMap` value) after reading it with `depth: D`: every reference field becomes the
 * referenced entry type, resolved with `D - 1`; at `D` 0 the type is `E` itself. With a non-literal `number` depth
 * each level is "entry or `collection/slug`".
 */
export type Resolved<M, E, D extends number = 1> = D extends 0
  ? E
  : { [K in keyof E]: K extends 'data' ? ResolvedData<M, E[K], D> : E[K] };

/** `data` of a resolved entry; keeps each field's `?`. */
export type ResolvedData<M, T, D extends number> = { [F in keyof T]: ResolveValue<M, T[F], D> };
