/**
 * Walking entry data together with its fields, into `object` fields, their lists and `blocks` items. Leaf values (every
 * other field type) are what callers see; containers are handled here. Data that does not match the schema (a list
 * that is not an array, an item that is not an object, an unknown block kind) is skipped, never thrown on.
 */
import { BLOCK_KEY, type Field } from './schema';

export type FieldPath = (string | number)[];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The fields of one `blocks` item (by its `block` key), or `undefined` for an unknown kind. */
export function blockFields(
  field: Extract<Field, { type: 'blocks' }>,
  item: unknown,
): Record<string, Field> | undefined {
  if (!isPlainObject(item)) return undefined;
  const kind = item[BLOCK_KEY];
  return typeof kind === 'string' && Object.hasOwn(field.blocks, kind) ? field.blocks[kind]!.fields : undefined;
}

/** Each container's child data with its fields and path: one object, or every item of a list. */
function children(
  field: Field,
  value: unknown,
  path: FieldPath,
): [Record<string, Field>, Record<string, unknown>, FieldPath][] {
  if (field.type === 'object') {
    if (!field.list) return isPlainObject(value) ? [[field.fields, value, path]] : [];
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => (isPlainObject(item) ? [[field.fields, item, [...path, i]]] : []));
  }
  if (field.type === 'blocks') {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, i) => {
      const fields = blockFields(field, item);
      return fields ? [[fields, item as Record<string, unknown>, [...path, i]]] : [];
    });
  }
  return [];
}

const isContainer = (field: Field) => field.type === 'object' || field.type === 'blocks';

/**
 * Calls `visit` for every leaf value present in `data` (keys of `fields` that `data` has), depth first in field order:
 * `path` is the dot path parts from the entry's data (`['content', 2, 'image']`).
 */
export function visitFields(
  fields: Record<string, Field>,
  data: Record<string, unknown>,
  visit: (field: Field, value: unknown, path: FieldPath) => void,
  at: FieldPath = [],
): void {
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(data, key)) continue;
    const path = [...at, key];
    if (!isContainer(field)) {
      visit(field, data[key], path);
      continue;
    }
    for (const [childFields, child, childPath] of children(field, data[key], path)) {
      visitFields(childFields, child, visit, childPath);
    }
  }
}

/**
 * A copy of `data` with every leaf value replaced by `map(field, value, path)`; `undefined` drops the key. Containers
 * are copied (objects, lists, block items keep their `block` key); keys outside `fields` are kept as they are.
 */
export function mapFields(
  fields: Record<string, Field>,
  data: Record<string, unknown>,
  map: (field: Field, value: unknown, path: FieldPath) => unknown,
  at: FieldPath = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(data, key)) continue;
    const path = [...at, key];
    const value = data[key];
    let next: unknown;
    if (field.type === 'object' && !field.list) {
      next = isPlainObject(value) ? mapFields(field.fields, value, map, path) : value;
    } else if (field.type === 'object' && Array.isArray(value)) {
      next = value.map((item, i) => (isPlainObject(item) ? mapFields(field.fields, item, map, [...path, i]) : item));
    } else if (field.type === 'blocks' && Array.isArray(value)) {
      next = value.map((item, i) => {
        const child = blockFields(field, item);
        return child ? mapFields(child, item as Record<string, unknown>, map, [...path, i]) : item;
      });
    } else if (isContainer(field)) {
      next = value;
    } else {
      next = map(field, value, path);
    }
    if (next === undefined) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Every field, nested ones too, with its path in the schema's field tree (`['content', 'hero', 'title']`). */
export function allFields(fields: Record<string, Field>, at: string[] = []): [string[], Field][] {
  const out: [string[], Field][] = [];
  for (const [key, field] of Object.entries(fields)) {
    const path = [...at, key];
    out.push([path, field]);
    if (field.type === 'object') out.push(...allFields(field.fields, path));
    if (field.type === 'blocks') {
      for (const [kind, block] of Object.entries(field.blocks)) out.push(...allFields(block.fields, [...path, kind]));
    }
  }
  return out;
}
