import { referenceFields } from '../../../core/references';
import { fieldGroups, type Collection, type Field, type Schema } from '../../../core/schema';
import { allFields } from '../../../core/walk';

export type FieldBadge = 'title' | 'slugSource' | 'body';

export type FieldRow = {
  key: string;
  label: string;
  hint?: string;
  required: boolean;
  /** `string`, `string, list`, `select, multiple`, `reference`. Never includes reference targets. */
  type: string;
  /** Reference targets (collection keys); empty for other types. */
  targets: string[];
  /** A reference field with `multiple: true`. */
  many: boolean;
  /** Short `key: value` texts, in a fixed order. */
  details: string[];
  badges: FieldBadge[];
};

function typeLabel(field: Field): string {
  const parts: string[] = [field.type];
  if (field.type === 'string' && field.list) parts.push('list');
  if (field.type === 'select' && field.multiple) parts.push('multiple');
  if (field.type === 'object' && field.list) parts.push('list');
  return parts.join(', ');
}

function fieldDetails(field: Field): string[] {
  const out: string[] = [];
  if (field.type === 'select') {
    const options = field.options.map((o) => (o.label === o.value ? o.value : `${o.label} (${o.value})`));
    out.push(`options: ${options.join(', ')}`);
  }
  if (field.type === 'object') out.push(`fields: ${Object.keys(field.fields).join(', ')}`);
  if (field.type === 'blocks') {
    out.push(
      `blocks: ${Object.entries(field.blocks)
        .map(([k, b]) => (b.label === k ? k : `${b.label} (${k})`))
        .join(', ')}`,
    );
  }
  const counted =
    field.type === 'number' || field.type === 'reference' || field.type === 'object' || field.type === 'blocks';
  if (counted && field.min !== undefined) out.push(`min: ${field.min}`);
  if (counted && field.max !== undefined) out.push(`max: ${field.max}`);
  if (field.type === 'number' && field.step !== undefined) out.push(`step: ${field.step}`);
  if (field.type === 'number' && field.integer) out.push('integer');
  if (field.type === 'text' && field.rows !== undefined) out.push(`rows: ${field.rows}`);
  if (field.type === 'datetime' && field.dateOnly) out.push('date only');
  if (field.type === 'datetime' && field.defaultNow) out.push('default now');
  if (field.type === 'boolean' && field.labels) out.push(`labels: ${field.labels.true} / ${field.labels.false}`);
  if ('default' in field && field.default !== undefined) out.push(`default: ${JSON.stringify(field.default)}`);
  return out;
}

/**
 * One display row per field of a collection, in schema field order. Fields inside `object` and `blocks` follow their
 * container as rows keyed by their dot path (`seo.title`, `content.hero.title` for a block kind's field).
 */
export function fieldRows(collection: Collection): FieldRow[] {
  // With `groups`, each top-level field says its tab (`group: Media`; a field without `group` is in the first).
  const groups = collection.groups ? fieldGroups(collection) : [];
  const groupOf = (key: string) => groups.find((g) => g.fields.includes(key))?.label;
  return allFields(collection.fields).map(([path, field]) => {
    const key = path.join('.');
    const badges: FieldBadge[] = [];
    if (collection.titleField === key) badges.push('title');
    if (collection.slugFrom === key) badges.push('slugSource');
    if (field.type === 'markdown') badges.push('body');
    return {
      key,
      label: field.label,
      ...(field.hint !== undefined ? { hint: field.hint } : {}),
      required: field.required === true,
      type: typeLabel(field),
      targets: field.type === 'reference' ? [...field.collections] : [],
      many: field.type === 'reference' && field.multiple === true,
      details: [...fieldDetails(field), ...(path.length === 1 && groupOf(key) ? [`group: ${groupOf(key)}`] : [])],
      badges,
    };
  });
}

export type ReferenceEdge = { from: string; field: string; to: string; many: boolean };

/** Every reference field as one edge per target, in collection, field and target order. */
export function referenceEdges(schema: Schema): ReferenceEdge[] {
  const edges: ReferenceEdge[] = [];
  for (const [from, collection] of Object.entries(schema.collections)) {
    for (const [field, def] of referenceFields(collection)) {
      for (const to of def.collections) edges.push({ from, field, to, many: def.multiple === true });
    }
  }
  return edges;
}

export function outgoing(edges: ReferenceEdge[], collection: string): ReferenceEdge[] {
  return edges.filter((e) => e.from === collection);
}

export function incoming(edges: ReferenceEdge[], collection: string): ReferenceEdge[] {
  return edges.filter((e) => e.to === collection);
}

export type FieldMark = 'new' | 'changed';

export type ModelChanges = {
  /** Added (`new`) or changed in any way (`changed`). */
  collections: Map<string, FieldMark>;
  /** Collection key, then field key. A wholly new collection has no entry here. */
  fields: Map<string, Map<string, FieldMark>>;
  /** `tag` for a collection, `post.subtitle` for a field; sorted. */
  removed: string[];
};

/** JSON with sorted object keys, so key order does not count as a change. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Compares two schemas ignoring collection, field and key order. */
export function diffModel(prev: Schema, next: Schema): ModelChanges {
  const changes: ModelChanges = { collections: new Map(), fields: new Map(), removed: [] };
  for (const key of Object.keys(prev.collections)) {
    if (!Object.hasOwn(next.collections, key)) changes.removed.push(key);
  }
  for (const [key, collection] of Object.entries(next.collections)) {
    const before = Object.hasOwn(prev.collections, key) ? prev.collections[key] : undefined;
    if (!before) {
      changes.collections.set(key, 'new');
      continue;
    }
    let changed = false;
    const { fields: nextFields, ...nextRest } = collection;
    const { fields: prevFields, ...prevRest } = before;
    if (stableJson(nextRest) !== stableJson(prevRest)) changed = true;
    const marks = new Map<string, FieldMark>();
    for (const [fieldKey, field] of Object.entries(nextFields)) {
      if (!Object.hasOwn(prevFields, fieldKey)) marks.set(fieldKey, 'new');
      else if (stableJson(field) !== stableJson(prevFields[fieldKey])) marks.set(fieldKey, 'changed');
    }
    for (const fieldKey of Object.keys(prevFields)) {
      if (Object.hasOwn(nextFields, fieldKey)) continue;
      changes.removed.push(`${key}.${fieldKey}`);
      changed = true;
    }
    if (marks.size > 0) {
      changes.fields.set(key, marks);
      changed = true;
    }
    if (changed) changes.collections.set(key, 'changed');
  }
  changes.removed.sort();
  return changes;
}

export function hasChanges(changes: ModelChanges): boolean {
  return changes.collections.size > 0 || changes.removed.length > 0;
}

export type ChatPrompt = {
  id:
    | 'add-field'
    | 'rename-field'
    | 'remove-field'
    | 'require-field'
    | 'add-reference'
    | 'add-collection'
    | 'fix-problems'
    | 'review-schema';
  title: string;
  text: string;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The first candidate that is not taken; falls back to the first with a `New` suffix. */
function freeName(candidates: string[], taken: (name: string) => boolean): string {
  return candidates.find((name) => !taken(name)) ?? `${candidates[0]}New`;
}

/** The collection the global prompts name: the first one with entries of its own, else the first, else `post`. */
const mainCollection = (schema: Schema) => {
  const entries = Object.entries(schema.collections);
  return (entries.find(([, c]) => !c.singleton) ?? entries[0])?.[0] ?? 'post';
};

/**
 * Copyable prompts for one collection, filled with its real names. Prompts whose target does not exist (no field to
 * remove, no optional field, no other collection to reference) are left out. Markdown fields are never a target.
 */
export function collectionPrompts(schema: Schema, schemaPath: string, collection: string): ChatPrompt[] {
  const all = schema.collections[collection]?.fields ?? {};
  const fields = Object.entries(all).filter(([, f]) => f.type !== 'markdown');
  const prompts: ChatPrompt[] = [];

  const newField = freeName(['subtitle', 'summary', 'note'], (name) => Object.hasOwn(all, name));
  prompts.push({
    id: 'add-field',
    title: 'Add a field',
    text: `Add an optional string field "${newField}" (label "${capitalize(newField)}") to the "${collection}" collection in ${schemaPath}.`,
  });

  const renameKey = fields[0]?.[0];
  if (renameKey !== undefined) {
    const to = Object.hasOwn(all, 'headline') ? `${renameKey}New` : 'headline';
    prompts.push({
      id: 'rename-field',
      title: 'Rename a field',
      text: `Rename field "${renameKey}" in "${collection}" to "${to}" and update every entry. Dry-run first and show me the plan.`,
    });
  }

  const removeKey = fields.findLast(([key]) => key !== renameKey)?.[0];
  if (removeKey !== undefined) {
    prompts.push({
      id: 'remove-field',
      title: 'Remove a field',
      text: `Remove field "${removeKey}" from "${collection}". Dry-run first and tell me which entries lose data.`,
    });
  }

  const requireKey = fields.find(([, f]) => !f.required)?.[0];
  if (requireKey !== undefined) {
    prompts.push({
      id: 'require-field',
      title: 'Make a field required',
      text: `Make "${requireKey}" in "${collection}" required. First check which entries would fail.`,
    });
  }

  const referenced = new Set(Object.values(all).flatMap((f) => (f.type === 'reference' ? f.collections : [])));
  const target = Object.entries(schema.collections).find(
    ([key, c]) => key !== collection && !c.singleton && !referenced.has(key),
  )?.[0];
  if (target !== undefined) {
    const field = freeName([target, `${target}Ref`], (name) => Object.hasOwn(all, name));
    prompts.push({
      id: 'add-reference',
      title: 'Link to another collection',
      text: `Add an optional reference field "${field}" to "${collection}" that points to one "${target}" entry.`,
    });
  }
  return prompts;
}

/** Copyable prompts for the whole model: add a collection, review the schema, and fix the problems when there are any. */
export function globalPrompts(schema: Schema, schemaPath: string, opts: { hasProblems: boolean }): ChatPrompt[] {
  const prompts: ChatPrompt[] = [];
  if (opts.hasProblems) {
    prompts.push({
      id: 'fix-problems',
      title: 'Fix the problems',
      text: 'Run the content validation and fix the problems shown in the content model.',
    });
  }
  const collection = mainCollection(schema);
  const tag = freeName(['tag', 'category', 'topic'], (name) => Object.hasOwn(schema.collections, name));
  prompts.push({
    id: 'add-collection',
    title: 'Add a collection',
    text: `Add a collection "${tag}" (label "${capitalize(tag)}" and its pluralLabel) with a required string field "name", and let "${collection}" reference many "${tag}" entries.`,
  });
  prompts.push({
    id: 'review-schema',
    title: 'Review the schema',
    text: `Review ${schemaPath}: suggest missing labels, hints, required fields and slug sources. Show me the plan before changing anything.`,
  });
  return prompts;
}
