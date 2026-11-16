import { z } from 'zod';

import { fieldValueSchema, isAbsentValue } from './fields';
import type { Issue } from './issues';
import { entryFilePath, isHiddenContentPath, isImagePath, isValidSlug, resolveAssetPath } from './paths';
import { BLOCK_KEY, markdownFieldKey, type Collection, type Field, type Schema } from './schema';
import { blockFields, visitFields } from './walk';

export interface Entry {
  collection: string;
  slug: string;
  data: Record<string, unknown>;
  body: string;
}

export interface ValidateContext {
  entryExists?: (ref: string) => boolean;
  fileExists?: (path: string) => boolean;
}

type Shape = Record<string, z.ZodType>;

export function buildDataSchema(collection: Collection): z.ZodObject {
  const shape: Shape = {};
  for (const [key, field] of Object.entries(collection.fields)) {
    const s = fieldValueSchema(field);
    if (s) shape[key] = s;
  }
  shape.draft = z.boolean({ error: 'Expected true or false' }).optional();
  return z.strictObject(shape);
}

function toIssues(error: z.ZodError, file: string): Issue[] {
  const out: Issue[] = [];
  for (const issue of error.issues) {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) out.push({ file, path: [...path, key].join('.'), message: 'Unknown field' });
      continue;
    }
    out.push({ file, path: path.join('.'), message: issue.message });
  }
  return out;
}

export function validateEntry(schema: Schema, entry: Entry, ctx: ValidateContext = {}): Issue[] {
  if (!Object.hasOwn(schema.collections, entry.collection)) {
    return [{ path: '', message: `Unknown collection "${entry.collection}"` }];
  }
  const collection = schema.collections[entry.collection];
  const file = entryFilePath(schema, entry.collection, entry.slug);
  if (collection.singleton ? entry.slug !== 'index' : !isValidSlug(entry.slug)) {
    const message = collection.singleton
      ? 'Slug of a singleton must be "index"'
      : `Invalid slug "${entry.slug}": use lowercase letters, digits and single hyphens`;
    return [{ file, path: '', message }];
  }

  if (typeof entry.data !== 'object' || entry.data === null || Array.isArray(entry.data)) {
    return [{ file, path: '', message: 'Entry data must be an object' }];
  }
  const parsed = buildDataSchema(collection).safeParse(entry.data);
  const issues = parsed.success ? [] : toIssues(parsed.error, file);

  const mdKey = markdownFieldKey(collection);
  if (mdKey === undefined) {
    if (entry.body.trim() !== '') {
      issues.push({ file, path: '', message: 'This collection has no markdown field, but the entry has body content' });
    }
  } else if (collection.fields[mdKey].required && entry.body.trim() === '') {
    issues.push({ file, path: mdKey, message: 'Required' });
  }

  // A value with an issue of its own, inside it or on a container around it is not checked against the project.
  const shapeIssues = [...issues];
  const bad = (key: string) =>
    shapeIssues.some((i) => i.path === key || i.path.startsWith(`${key}.`) || key.startsWith(`${i.path}.`));
  visitFields(collection.fields, entry.data, (field, value, at) => {
    const key = at.join('.');
    if (bad(key)) return;
    if (field.type === 'image' && value !== null && value !== undefined) {
      const src = (value as { src: string }).src;
      const resolved = resolveAssetPath(schema, file, src);
      if (resolved === null) {
        issues.push({ file, path: `${key}.src`, message: 'Image path points outside the content directory' });
      } else if (!isImagePath(resolved)) {
        issues.push({ file, path: `${key}.src`, message: 'Image path must end in an image extension' });
      } else if (isHiddenContentPath(schema, resolved)) {
        issues.push({ file, path: `${key}.src`, message: 'Image path must not be hidden (a segment starts with ".")' });
      } else if (ctx.fileExists?.(resolved) === false) {
        issues.push({ file, path: `${key}.src`, message: `Image file not found: ${resolved}` });
      }
    } else if (field.type === 'reference' && !isAbsentValue(field, value)) {
      const refs = Array.isArray(value) ? (value as string[]) : [value as string];
      refs.forEach((ref, i) => {
        if (ctx.entryExists?.(ref) === false) {
          issues.push({
            file,
            path: Array.isArray(value) ? `${key}.${i}` : key,
            message: `Referenced entry not found: ${ref}`,
          });
        }
      });
    }
  });
  return issues;
}

/**
 * Copy of `data` without absent values: keys whose value is `null` (any field) or `''` (string-valued fields), by
 * the same rule validation uses to accept them on optional fields. For a valid entry the result matches the
 * generated `<Collection>Data` type (`generateTypes`), so adapters and the admin read entry data through this.
 */
export function normalizeData(collection: Collection, data: Record<string, unknown>): Record<string, unknown> {
  return normalizeFields(collection.fields, data);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `normalizeData` for one level of fields: absent values go, `object` and `blocks` values are normalized inside. */
function normalizeFields(fields: Record<string, Field>, data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const field = Object.hasOwn(fields, key) ? fields[key] : undefined;
    if (value === null || (field !== undefined && isAbsentValue(field, value))) continue;
    out[key] = field === undefined ? value : normalizeValue(field, value);
  }
  return out;
}

function normalizeValue(field: Field, value: unknown): unknown {
  if (field.type === 'object') {
    const one = (v: unknown) => (isPlainObject(v) ? normalizeFields(field.fields, v) : v);
    return field.list && Array.isArray(value) ? value.map(one) : one(value);
  }
  if (field.type === 'blocks' && Array.isArray(value)) {
    return value.map((item) => {
      const fields = blockFields(field, item);
      if (!fields) return item;
      // The kind first, as it is written in files.
      const { [BLOCK_KEY]: kind, ...rest } = item as Record<string, unknown>;
      return { [BLOCK_KEY]: kind, ...normalizeFields(fields, rest) };
    });
  }
  return value;
}

export function initialData(collection: Collection, now: Date = new Date()): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(collection.fields)) {
    if (field.type === 'datetime') {
      if (field.defaultNow) data[key] = field.dateOnly ? now.toISOString().slice(0, 10) : now.toISOString();
    } else if ('default' in field && field.default !== undefined) {
      data[key] = structuredClone(field.default);
    }
  }
  data.draft = true;
  return data;
}
