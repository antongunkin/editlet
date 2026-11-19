import { z } from 'zod';

import { fieldValueSchema } from './fields';
import { EditletError, type Issue } from './issues';
import { isCanonicalPath } from './paths';
import { urlPatternIssues } from './urls';

export type FieldType =
  | 'string'
  | 'text'
  | 'markdown'
  | 'boolean'
  | 'select'
  | 'number'
  | 'datetime'
  | 'json'
  | 'url'
  | 'color'
  | 'image'
  | 'reference'
  | 'object'
  | 'blocks';

interface Base {
  label: string;
  hint?: string;
  required?: boolean;
  /** Top-level fields only: the key of the collection's `groups` entry (its tab in the admin). */
  group?: string;
}

export type Field =
  | (Base & { type: 'string'; list?: boolean; default?: string | string[] })
  | (Base & { type: 'text'; rows?: number; default?: string })
  | (Base & { type: 'markdown' })
  | (Base & { type: 'boolean'; default?: boolean; labels?: { true: string; false: string } })
  | (Base & {
      type: 'select';
      options: { label: string; value: string }[];
      multiple?: boolean;
      default?: string | string[];
    })
  | (Base & { type: 'number'; min?: number; max?: number; step?: number; integer?: boolean; default?: number })
  | (Base & { type: 'datetime'; dateOnly?: boolean; defaultNow?: boolean })
  | (Base & { type: 'json' })
  | (Base & { type: 'url' })
  | (Base & { type: 'color'; default?: string })
  | (Base & { type: 'image' })
  | (Base & { type: 'reference'; collections: string[]; multiple?: boolean; min?: number; max?: number })
  | (Base & { type: 'object'; fields: Record<string, Field>; list?: boolean; min?: number; max?: number })
  | (Base & { type: 'blocks'; blocks: Record<string, BlockDef>; min?: number; max?: number });

/** One kind of block of a `blocks` field: its items carry `block: <key>` plus these fields. */
export interface BlockDef {
  label: string;
  fields: Record<string, Field>;
}

/** Key that names the kind of a `blocks` item; reserved as a field key inside blocks. */
export const BLOCK_KEY = 'block';

/** A field group of a collection: one tab of the entry in the admin. */
export interface FieldGroup {
  label: string;
}

export interface Collection {
  /** The collection's name for one entry (*Post*); a singleton's only name. */
  label: string;
  /** The name for many entries (*Posts*), for headings; not on a singleton. Without it the admin shows `label`. */
  pluralLabel?: string;
  singleton?: boolean;
  /**
   * The path of the collection's page on the site, from its root: `/posts/{slug}` (one page per entry, `{slug}` the
   * only placeholder) or a fixed path where every entry is shown (`/`). Without it the collection has no page.
   * Rules: `urlPatternIssues` (`core/urls.ts`).
   */
  url?: string;
  titleField?: string;
  slugFrom?: string;
  /**
   * Field groups in tab order. A top-level field names its group with `group`; a field without one is in the first
   * group. Without `groups` the entry is one group.
   */
  groups?: Record<string, FieldGroup>;
  fields: Record<string, Field>;
}

/** How the admin and the agent name branches, commits and pull requests. Every key but `baseBranch` is optional. */
export interface GitConfig {
  /** The branch the admin edits and opens pull requests against. */
  baseBranch: string;
  /** Prefix of every branch Editlet creates and lists, ending in `/`. Default `editlet/`. */
  branchPrefix?: string;
  /** Commit message template, one line; placeholders `COMMIT_PLACEHOLDERS`. Default `{Action} {target}`. */
  commitMessage?: string;
  pullRequest?: {
    /** Title template; placeholders `TITLE_PLACEHOLDERS`. Default `Update {branch}`. */
    title?: string;
    /** Labels added to a new pull request. Default `["editlet"]`; `[]` adds none. */
    labels?: string[];
    /** Open new pull requests as drafts. Default `false`. */
    draft?: boolean;
  };
}

export interface Schema {
  /** Editor hint (JSON Schema URL); ignored by Editlet. */
  $schema?: string;
  contentDir: string;
  git: GitConfig;
  collections: Record<string, Collection>;
}

/** Placeholders of `git.commitMessage`. */
export const COMMIT_PLACEHOLDERS = ['action', 'Action', 'collection', 'slug', 'target'] as const;
/** Placeholders of `git.pullRequest.title`. */
export const TITLE_PLACEHOLDERS = ['branch', 'name', 'login'] as const;

/** One or more `/`-separated ref segments (letters, digits, `.`, `_`, `-`; no `..`, no `.lock` segment end). */
const REF_SEGMENTS = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function isRefPath(value: string): boolean {
  return REF_SEGMENTS.test(value) && !value.includes('..') && !value.split('/').some((s) => s.endsWith('.lock'));
}

/** Template text with only the given `{placeholders}`, one line. */
function template(placeholders: readonly string[], max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((t) => !/[\r\n]/.test(t), 'must be one line')
    .superRefine((t, ctx) => {
      for (const [, name] of t.matchAll(/\{([^{}]*)\}/g)) {
        if (!placeholders.includes(name!)) {
          ctx.addIssue({
            code: 'custom',
            message: `unknown placeholder "{${name}}" (use ${placeholders.map((p) => `{${p}}`).join(', ')})`,
          });
        }
      }
    });
}

const gitSchema = z.strictObject({
  baseBranch: z.string().min(1),
  branchPrefix: z
    .string()
    .refine(
      (p) => p.endsWith('/') && isRefPath(p.slice(0, -1)),
      'must be branch name segments ending in "/", for example "editlet/"',
    )
    .optional(),
  commitMessage: template(COMMIT_PLACEHOLDERS, 200).optional(),
  pullRequest: z
    .strictObject({
      title: template(TITLE_PLACEHOLDERS, 256).optional(),
      labels: z
        .array(
          z
            .string()
            .trim()
            .min(1)
            .max(50)
            .refine((l) => !l.includes(','), 'must not contain ","'),
        )
        .max(10)
        .optional(),
      draft: z.boolean().optional(),
    })
    .optional(),
});

const IDENT = /^[a-zA-Z][a-zA-Z0-9]*$/;
const identMsg = 'must start with a letter and contain only letters and digits';

const base = {
  label: z.string(),
  hint: z.string().optional(),
  required: z.boolean().optional(),
  group: z.string().optional(),
};

const strOrList = z.union([z.string(), z.array(z.string())]);

/** Fields of an `object` or of a block: the same field types, nested (`z.lazy`: a field can hold fields). */
const nestedFields: z.ZodType<Record<string, Field>> = z.lazy(() =>
  z
    .record(z.string().regex(IDENT, `field key ${identMsg}`), fieldSchema)
    .refine((o) => Object.keys(o).length > 0, 'fields must not be empty'),
) as z.ZodType<Record<string, Field>>;

const fieldSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...base, type: z.literal('string'), list: z.boolean().optional(), default: strOrList.optional() }),
  z.strictObject({
    ...base,
    type: z.literal('text'),
    rows: z.number().int().positive().optional(),
    default: z.string().optional(),
  }),
  z.strictObject({ ...base, type: z.literal('markdown') }),
  z.strictObject({
    ...base,
    type: z.literal('boolean'),
    default: z.boolean().optional(),
    labels: z.strictObject({ true: z.string(), false: z.string() }).optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('select'),
    options: z.array(z.strictObject({ label: z.string(), value: z.string() })).min(1, 'options must not be empty'),
    multiple: z.boolean().optional(),
    default: strOrList.optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    integer: z.boolean().optional(),
    default: z.number().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('datetime'),
    dateOnly: z.boolean().optional(),
    defaultNow: z.boolean().optional(),
  }),
  z.strictObject({ ...base, type: z.literal('json') }),
  z.strictObject({ ...base, type: z.literal('url') }),
  z.strictObject({ ...base, type: z.literal('color'), default: z.string().optional() }),
  z.strictObject({ ...base, type: z.literal('image') }),
  z.strictObject({
    ...base,
    type: z.literal('reference'),
    collections: z.array(z.string()).min(1, 'collections must not be empty'),
    multiple: z.boolean().optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('object'),
    fields: nestedFields,
    list: z.boolean().optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    ...base,
    type: z.literal('blocks'),
    blocks: z
      .record(
        z.string().regex(IDENT, `block key ${identMsg}`),
        z.strictObject({ label: z.string(), fields: nestedFields }),
      )
      .refine((o) => Object.keys(o).length > 0, 'blocks must not be empty'),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }),
]) as unknown as z.ZodType<Field>;

const collectionSchema = z.strictObject({
  label: z.string(),
  pluralLabel: z.string().max(100).optional(),
  singleton: z.boolean().optional(),
  url: z.string().optional(),
  titleField: z.string().optional(),
  slugFrom: z.string().optional(),
  groups: z
    .record(z.string().regex(IDENT, `group key ${identMsg}`), z.strictObject({ label: z.string().min(1) }))
    .optional(),
  fields: z.record(z.string().regex(IDENT, `field key ${identMsg}`), fieldSchema),
});

type AddIssue = (path: (string | number)[], message: string) => void;

/**
 * Rules for a set of fields, at the top of a collection (`nested: false`) or inside an `object` / a block, where
 * `draft` is an ordinary key and `markdown` is a Markdown string.
 */
function checkFields(
  schema: { collections: Record<string, unknown> },
  fields: Record<string, Field>,
  at: (string | number)[],
  nested: boolean,
  add: AddIssue,
): void {
  for (const [fk, f] of Object.entries(fields)) {
    const path = [...at, fk];
    if (fk === 'draft' && !nested) add(path, 'field key "draft" is reserved for the draft flag');
    if (nested && f.group !== undefined) add([...path, 'group'], 'group is only for top-level fields');
    if ('default' in f && f.default !== undefined) {
      const checked = fieldValueSchema(f)?.safeParse(f.default);
      for (const issue of checked?.success === false ? checked.error.issues : []) {
        add([...path, 'default', ...issue.path.map(String)], `default: ${issue.message}`);
      }
    }
    if (f.type === 'reference') {
      f.collections.forEach((target, i) => {
        if (!Object.hasOwn(schema.collections, target))
          add([...path, 'collections', i], `unknown collection "${target}"`);
      });
      if (!f.multiple && (f.min !== undefined || f.max !== undefined)) add(path, 'min/max require multiple: true');
    }
    if (f.type === 'object') {
      if (!f.list && (f.min !== undefined || f.max !== undefined)) add(path, 'min/max require list: true');
      checkFields(schema, f.fields, [...path, 'fields'], true, add);
    }
    if (f.type === 'blocks') {
      for (const [bk, block] of Object.entries(f.blocks)) {
        if (Object.hasOwn(block.fields, BLOCK_KEY)) {
          add([...path, 'blocks', bk, 'fields', BLOCK_KEY], `field key "${BLOCK_KEY}" is reserved for the block type`);
        }
        checkFields(schema, block.fields, [...path, 'blocks', bk, 'fields'], true, add);
      }
    }
    if (
      (f.type === 'reference' || f.type === 'object' || f.type === 'blocks') &&
      f.min !== undefined &&
      f.max !== undefined &&
      f.min > f.max
    ) {
      add([...path, 'min'], 'min must not exceed max');
    }
  }
}

const schemaSchema = z
  .strictObject({
    $schema: z.string().optional(),
    contentDir: z
      .string()
      .min(1)
      .refine(
        isCanonicalPath,
        'must be a relative posix path without empty, "." or ".." segments, backslashes, NUL or ":"',
      ),
    git: gitSchema,
    collections: z.record(z.string().regex(IDENT, `collection key ${identMsg}`), collectionSchema),
  })
  .superRefine((schema, ctx) => {
    const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
    const { baseBranch, branchPrefix } = schema.git;
    if (
      branchPrefix !== undefined &&
      (baseBranch.startsWith(branchPrefix) || branchPrefix.startsWith(`${baseBranch}/`))
    ) {
      // Git cannot hold both refs/heads/main and refs/heads/main/x, and the base must never look like an edit branch.
      add(['git', 'branchPrefix'], `branchPrefix "${branchPrefix}" clashes with the base branch "${baseBranch}"`);
    }
    const lowerKeys = new Map<string, string>();
    for (const [ck, col] of Object.entries(schema.collections)) {
      const other = lowerKeys.get(ck.toLowerCase());
      if (other !== undefined) add(['collections', ck], `collection key "${ck}" differs from "${other}" only in case`);
      else lowerKeys.set(ck.toLowerCase(), ck);
      const fields = Object.entries(col.fields);
      if (fields.filter(([, f]) => f.type === 'markdown').length > 1) {
        add(['collections', ck, 'fields'], 'a collection can have at most one markdown field');
      }
      if (col.pluralLabel !== undefined) {
        if (col.pluralLabel.trim() === '') add(['collections', ck, 'pluralLabel'], 'pluralLabel must not be empty');
        if (col.singleton) {
          add(['collections', ck, 'pluralLabel'], 'pluralLabel is only for collections with many entries');
        }
      }
      if (col.url !== undefined) {
        for (const message of urlPatternIssues(col.url, col.singleton === true))
          add(['collections', ck, 'url'], message);
      }
      if (col.titleField !== undefined && !Object.hasOwn(col.fields, col.titleField)) {
        add(['collections', ck, 'titleField'], `titleField "${col.titleField}" is not a field of ${ck}`);
      }
      if (col.slugFrom !== undefined && !Object.hasOwn(col.fields, col.slugFrom)) {
        add(['collections', ck, 'slugFrom'], `slugFrom "${col.slugFrom}" is not a field of ${ck}`);
      }
      for (const [fk, f] of fields) {
        if (f.group !== undefined && !(col.groups && Object.hasOwn(col.groups, f.group))) {
          add(['collections', ck, 'fields', fk, 'group'], `unknown group "${f.group}" (add it to ${ck}.groups)`);
        }
      }
      checkFields(schema, col.fields, ['collections', ck, 'fields'], false, add);
    }
  });

function toIssues(error: z.ZodError): Issue[] {
  const out: Issue[] = [];
  for (const issue of error.issues) {
    let path = issue.path.map(String);
    let message = issue.message;
    if (issue.code === 'invalid_union' && ('discriminator' in issue || path.at(-1) !== 'type')) {
      // Discriminator mismatch (at any depth, nested fields too): report on the `type` key.
      if (path.at(-1) !== 'type') path = [...path, 'type'];
      message = 'unknown field type';
    }
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) out.push({ path: [...path, key].join('.'), message: `unknown key "${key}"` });
      continue;
    }
    out.push({ path: path.join('.'), message });
  }
  return out;
}

export function loadSchema(input: unknown): Schema {
  const parsed = schemaSchema.safeParse(input);
  if (!parsed.success) throw new EditletError(toIssues(parsed.error));
  return parsed.data as Schema;
}

/** Parses schema JSON text; issues (bad JSON or bad schema) carry `file`. */
export function parseSchemaText(text: string, file: string): Schema {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new EditletError([
      { file, path: '', message: `Invalid JSON: ${error instanceof Error ? error.message : error}` },
    ]);
  }
  try {
    return loadSchema(json);
  } catch (error) {
    if (error instanceof EditletError) throw new EditletError(error.issues.map((issue) => ({ ...issue, file })));
    throw error;
  }
}

/** The collection's names: `one` for an entry (`label`), `many` for headings (`pluralLabel`, else `label`). */
export function collectionNames(collection: Collection): { one: string; many: string } {
  return { one: collection.label, many: collection.pluralLabel ?? collection.label };
}

export function markdownFieldKey(collection: Collection): string | undefined {
  return Object.entries(collection.fields).find(([, f]) => f.type === 'markdown')?.[0];
}

/** One tab of an entry: the group's key and label and its top-level field keys, in schema order. */
export interface FieldGroupFields {
  /** The `groups` key; `''` for a collection without `groups`. */
  key: string;
  label: string;
  fields: string[];
}

/**
 * The collection's field groups in tab order, each with its fields in schema order. A field without `group` is in the
 * first group; a group with no fields is left out. Without `groups`: one group of every field (`key` and `label` `''`).
 */
export function fieldGroups(collection: Collection): FieldGroupFields[] {
  const declared = Object.entries(collection.groups ?? {});
  if (declared.length === 0) return [{ key: '', label: '', fields: Object.keys(collection.fields) }];
  const first = declared[0]![0];
  const groups = declared.map(([key, g]) => ({ key, label: g.label, fields: [] as string[] }));
  for (const [fk, f] of Object.entries(collection.fields)) {
    const key = f.group !== undefined && Object.hasOwn(collection.groups!, f.group) ? f.group : first;
    groups.find((g) => g.key === key)!.fields.push(fk);
  }
  return groups.filter((g) => g.fields.length > 0);
}
