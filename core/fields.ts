import { z } from 'zod';

import { SLUG_RE } from './paths';
import { BLOCK_KEY, type Field } from './schema';

/** Field kinds whose value is a single string. Only for these an empty string means "no value". */
function isStringValued(field: Field): boolean {
  switch (field.type) {
    case 'string':
      return !field.list;
    case 'select':
    case 'reference':
      return !field.multiple;
    case 'text':
    case 'datetime':
    case 'url':
    case 'color':
      return true;
    default:
      return false;
  }
}

/**
 * The one "absent" rule: `undefined`, `null`, or `''` for a string-valued field. Validation accepts exactly these
 * for an optional field (and reports "Required" for a required one); `normalizeData` drops them.
 */
export function isAbsentValue(field: Field, value: unknown): boolean {
  return value === undefined || value === null || (value === '' && isStringValued(field));
}

/** Error map: absent-looking input reads as "Required" only when the field is required. */
function err(field: Field, message: string) {
  return (iss: { input?: unknown }) => (field.required && isAbsentValue(field, iss.input) ? 'Required' : message);
}

/** Optional values: absent per `isAbsentValue` is fine. */
function optional(field: Field, schema: z.ZodType, message: string): z.ZodType {
  if (field.required) return schema;
  return isStringValued(field) ? z.union([schema, z.literal('')], { error: message }).nullish() : schema.nullish();
}

function isUrl(v: string): boolean {
  return v.startsWith('/') || URL.canParse(v);
}

/** Reports each repeat of an earlier item at its own index (`related.2`), named by `message`. */
function noRepeats(message: (item: unknown) => string) {
  return (items: unknown[], ctx: z.RefinementCtx) => {
    const seen = new Set<unknown>();
    items.forEach((item, i) => {
      if (seen.has(item)) ctx.addIssue({ code: 'custom', path: [i], message: message(item) });
      seen.add(item);
    });
  };
}

function listField(field: Field, item: z.ZodType, min: number, max?: number, unique?: (item: unknown) => string) {
  const effective = Math.max(field.required ? 1 : 0, min);
  let arr = z.array(item, { error: err(field, 'Expected a list') });
  if (effective > 0) {
    arr = arr.min(effective, {
      error: (iss) =>
        Array.isArray(iss.input) && iss.input.length === 0 && field.required
          ? 'Required'
          : `Must have at least ${effective}`,
    });
  }
  if (max !== undefined) arr = arr.max(max, { error: `Must have at most ${max}` });
  return optional(field, unique ? arr.superRefine(noRepeats(unique)) : arr, 'Expected a list');
}

const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strict object of `fields` (inside an `object` or a block): a `markdown` field there is a Markdown string. */
function fieldsShape(fields: Record<string, Field>): Record<string, z.ZodType> {
  const shape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) shape[key] = nestedValueSchema(field);
  return shape;
}

/** A field's value schema inside an `object` or a block, where `markdown` is a string like `text`. */
export function nestedValueSchema(field: Field): z.ZodType {
  if (field.type !== 'markdown') return fieldValueSchema(field)!;
  const base = z.string({ error: err(field, 'Expected text') });
  return field.required ? base.regex(/\S/, 'Required') : base.nullish();
}

/** Zod schema of one field's frontmatter value; `null` for the markdown field (it is the body). */
export function fieldValueSchema(field: Field): z.ZodType | null {
  switch (field.type) {
    case 'markdown':
      return null;
    case 'object': {
      const obj = z.strictObject(fieldsShape(field.fields), { error: err(field, 'Expected an object') });
      if (field.list) return listField(field, obj, field.min ?? 0, field.max);
      return optional(field, obj, '');
    }
    case 'blocks': {
      const kinds = Object.keys(field.blocks);
      const message = `Expected ${BLOCK_KEY}: ${kinds.join(', ')}`;
      const options = Object.entries(field.blocks).map(([kind, block]) =>
        z.strictObject({ [BLOCK_KEY]: z.literal(kind), ...fieldsShape(block.fields) }),
      );
      const item = z.discriminatedUnion(BLOCK_KEY, options as unknown as [z.ZodObject, ...z.ZodObject[]], {
        error: message,
      });
      return listField(field, item, field.min ?? 0, field.max);
    }
    case 'string':
    case 'text': {
      if (field.type === 'string' && field.list) return listField(field, z.string({ error: 'Expected text' }), 0);
      const base = z.string({ error: err(field, 'Expected text') });
      return field.required ? base.regex(/\S/, 'Required') : base.nullish();
    }
    case 'boolean':
      return optional(field, z.boolean({ error: err(field, 'Expected true or false') }), '');
    case 'select': {
      const values = field.options.map((o) => o.value) as [string, ...string[]];
      const message = `Expected one of: ${values.join(', ')}`;
      if (field.multiple) return listField(field, z.enum(values, { error: message }), 0);
      return optional(field, z.enum(values, { error: err(field, message) }), message);
    }
    case 'number': {
      let n = z.number({ error: err(field, 'Expected a number') });
      if (field.integer) n = n.int('Must be a whole number');
      if (field.min !== undefined) n = n.min(field.min, `Must be at least ${field.min}`);
      if (field.max !== undefined) n = n.max(field.max, `Must be at most ${field.max}`);
      return optional(field, n, '');
    }
    case 'datetime': {
      const base = field.dateOnly
        ? z.iso.date({ error: err(field, 'Invalid date') })
        : z.iso.datetime({ offset: true, local: true, error: err(field, 'Invalid date') });
      return optional(field, base, 'Invalid date');
    }
    case 'json': {
      if (!field.required) return z.unknown().optional();
      return z.union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.string(), z.unknown())], {
        error: 'Required',
      });
    }
    case 'url': {
      const message = 'Must be an http(s) URL or start with /';
      const base = z
        .string({ error: err(field, 'Expected text') })
        .regex(/^(?:https?:\/\/|\/(?!\/))/i, { error: err(field, message) })
        .refine(isUrl, { error: message });
      return optional(field, base, message);
    }
    case 'color': {
      const message = 'Must be a hex color like #a1b2c3';
      const base = z
        .string({ error: err(field, 'Expected text') })
        .regex(/^#[0-9a-fA-F]{6}$/, { error: err(field, message) });
      return optional(field, base, message);
    }
    case 'image': {
      const nonEmpty = z
        .string({ error: (iss) => (iss.input === undefined || iss.input === null ? 'Required' : 'Expected text') })
        .regex(/\S/, 'Required');
      const obj = z.strictObject({ src: nonEmpty, alt: nonEmpty }, { error: err(field, 'Expected { src, alt }') });
      return optional(field, obj, '');
    }
    case 'reference': {
      const message = `Must reference an entry in: ${field.collections.join(', ')}`;
      const slug = SLUG_RE.source.slice(1, -1);
      const ref = z
        .string({ error: err(field, 'Expected a reference like "collection/slug"') })
        .regex(new RegExp(`^(?:${field.collections.map(escapeRegex).join('|')})/${slug}$`), {
          error: err(field, message),
        });
      if (field.multiple) return listField(field, ref, field.min ?? 0, field.max, (r) => `Duplicate reference: ${r}`);
      return optional(field, ref, message);
    }
  }
}
