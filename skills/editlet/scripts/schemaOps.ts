import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { removeTopLevelKey, renameTopLevelKey, withoutBody } from './frontmatter';
import { removeInSchemaText, renameInSchemaText } from './schemaText';

import { decodeUtf8, parseEntryFile, serializeEntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { parseEntryPath, resolveAssetPath } from '../../../core/paths';
import { markdownFieldKey, parseSchemaText, type Schema } from '../../../core/schema';
import type { FileChange } from '../../../core/source';
import { validateChanges, type ChangeContext } from '../../../core/writes';
import { DEFAULT_SCHEMA_PATH, listFiles, loadProjectSchema } from '../../../node/fs';

export interface ProjectContext {
  root: string;
  schemaPath: string;
  schemaText: string;
  schema: Schema;
  /** Bytes of the schema file and of every file under the contentDir (and a candidate contentDir). */
  files: Map<string, Uint8Array>;
  context: ChangeContext;
}

async function addFiles(root: string, dir: string, files: Map<string, Uint8Array>): Promise<void> {
  for (const path of await listFiles(root, dir)) {
    if (!files.has(path)) files.set(path, await readFile(join(root, path)));
  }
}

/** Loads the schema (throws `EditletError` when it is broken) and every file under its contentDir. */
export async function loadContext(root: string): Promise<ProjectContext> {
  const schemaPath = DEFAULT_SCHEMA_PATH;
  const schema = await loadProjectSchema(root, schemaPath);
  const schemaBytes = await readFile(join(root, schemaPath));
  const files = new Map<string, Uint8Array>([[schemaPath, schemaBytes]]);
  await addFiles(root, schema.contentDir, files);
  return {
    root,
    schemaPath,
    schemaText: schemaBytes.toString('utf8'),
    schema,
    files,
    context: contextOf(schema, schemaPath, files),
  };
}

export function contextOf(schema: Schema | null, schemaPath: string, files: Map<string, Uint8Array>): ChangeContext {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    schema,
    schemaPath,
    exists: (path) => files.has(path),
    read: (path) => {
      const bytes = files.get(path);
      if (!bytes) return undefined;
      try {
        return decoder.decode(bytes);
      } catch {
        return undefined;
      }
    },
    list: () => files.keys(),
  };
}

/** Validates the changes against the project; also loads files of a candidate schema's contentDir. */
export function checkChanges(ctx: ProjectContext, changes: FileChange[]): Issue[] {
  return validateChanges(ctx.context, changes);
}

/** Adds the files under the candidate schema's contentDir (when it differs) so the whole-project re-check sees them. */
export async function withCandidateFiles(ctx: ProjectContext, candidateText: string): Promise<ProjectContext> {
  let candidate: Schema;
  try {
    candidate = parseSchemaText(candidateText, ctx.schemaPath);
  } catch {
    return ctx;
  }
  if (candidate.contentDir === ctx.schema.contentDir) return ctx;
  const files = new Map(ctx.files);
  await addFiles(ctx.root, candidate.contentDir, files);
  return { ...ctx, files, context: contextOf(ctx.schema, ctx.schemaPath, files) };
}

export class UsageError extends Error {}

export interface Plan {
  changes: FileChange[];
  /** Output lines (`note: …`, `loses data: …`, `loses body: …`) in the order they are printed. */
  notes: string[];
  issues: Issue[];
  /** Entry paths that fell back to a full re-serialization (standard format). */
  rewritten?: string[];
}

const FIELD_KEY = /^[a-zA-Z][a-zA-Z0-9]*$/;

function requireField(schema: Schema, collection: string, field: string, command: string): void {
  if (!Object.hasOwn(schema.collections, collection)) {
    throw new UsageError(
      `${command}: unknown collection "${collection}" (known: ${Object.keys(schema.collections).join(', ')})`,
    );
  }
  const fields = schema.collections[collection].fields;
  if (!Object.hasOwn(fields, field)) {
    throw new UsageError(
      `${command}: unknown field "${field}" in ${collection} (known: ${Object.keys(fields).join(', ')})`,
    );
  }
}

/**
 * The schema text after `edit` is applied to the collection's raw object. `textEdit` tries a minimal in-place text
 * edit (verified against the expected object); without a verified one the whole file is re-serialized.
 */
function rewriteSchema(
  ctx: ProjectContext,
  collection: string,
  edit: (col: Record<string, unknown>) => void,
  textEdit: (expected: unknown) => string | null,
): string {
  const raw = JSON.parse(ctx.schemaText) as { collections: Record<string, Record<string, unknown>> };
  edit(raw.collections[collection]);
  return textEdit(raw) ?? `${JSON.stringify(raw, null, 2)}\n`;
}

interface EntryEdit {
  path: string;
  text: string;
  data: Record<string, unknown>;
  body: string;
}

function entriesOf(ctx: ProjectContext, collection: string): EntryEdit[] {
  const out: EntryEdit[] = [];
  for (const [path, bytes] of ctx.files) {
    if (parseEntryPath(ctx.schema, path)?.collection !== collection) continue;
    const decoded = decodeUtf8(bytes, path);
    if (!('text' in decoded)) continue;
    try {
      out.push({ path, text: decoded.text, ...parseEntryFile(decoded.text) });
    } catch {
      // Unparseable entries are reported by the whole-project check; nothing to edit here.
    }
  }
  return out;
}

/** Applies the line edit; when it does not reproduce `expected` exactly, re-serializes the whole file instead. */
function editEntry(
  entry: EntryEdit,
  edited: string | null,
  expected: Record<string, unknown>,
  order: string[],
  rewritten: string[],
): string {
  if (edited !== null) {
    try {
      const back = parseEntryFile(edited);
      if (isDeepStrictEqual(back.data, expected) && back.body === entry.body) return edited;
    } catch {
      // fall through to the serializer
    }
  }
  rewritten.push(entry.path);
  return serializeEntryFile({ data: expected, body: entry.body }, order);
}

export function planRenameField(ctx: ProjectContext, collection: string, from: string, to: string): Plan {
  requireField(ctx.schema, collection, from, 'rename-field');
  const fields = ctx.schema.collections[collection].fields;
  if (!FIELD_KEY.test(to) || to === 'draft') {
    throw new UsageError(
      `rename-field: "${to}" is not a valid field key (letters and digits, starting with a letter; "draft" is reserved)`,
    );
  }
  if (Object.hasOwn(fields, to)) throw new UsageError(`rename-field: ${collection} already has a field "${to}"`);

  const schemaText = rewriteSchema(
    ctx,
    collection,
    (col) => {
      const renamed: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(col.fields as Record<string, unknown>))
        renamed[key === from ? to : key] = value;
      col.fields = renamed;
      if (col.titleField === from) col.titleField = to;
      if (col.slugFrom === from) col.slugFrom = to;
    },
    (expected) => renameInSchemaText(ctx.schemaText, collection, from, to, expected),
  );
  const changes: FileChange[] = [{ path: ctx.schemaPath, content: schemaText }];
  const clashes: Issue[] = [];
  const rewritten: string[] = [];
  const order = Object.keys(fields).map((key) => (key === from ? to : key));
  const isBody = markdownFieldKey(ctx.schema.collections[collection]) === from;
  if (!isBody) {
    for (const entry of entriesOf(ctx, collection)) {
      if (!Object.hasOwn(entry.data, from)) continue;
      if (Object.hasOwn(entry.data, to)) {
        clashes.push({ file: entry.path, path: to, message: `Field "${to}" already exists in this entry` });
        continue;
      }
      const expected: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(entry.data)) expected[key === from ? to : key] = value;
      changes.push({
        path: entry.path,
        content: editEntry(entry, renameTopLevelKey(entry.text, from, to), expected, order, rewritten),
      });
    }
  }
  const col = ctx.schema.collections[collection];
  const notes = col.titleField === from || col.slugFrom === from ? ['note: titleField/slugFrom follow the rename'] : [];
  if (clashes.length > 0) return { changes, notes: [], issues: clashes };
  return { changes, notes, issues: checkChanges(ctx, changes), rewritten };
}

export function planRemoveField(ctx: ProjectContext, collection: string, field: string): Plan {
  requireField(ctx.schema, collection, field, 'remove-field');
  const col = ctx.schema.collections[collection];
  const format = col.fields[field].type;
  const schemaText = rewriteSchema(
    ctx,
    collection,
    (raw) => {
      const kept = { ...(raw.fields as Record<string, unknown>) };
      delete kept[field];
      raw.fields = kept;
      if (raw.titleField === field) delete raw.titleField;
      if (raw.slugFrom === field) delete raw.slugFrom;
    },
    (expected) => removeInSchemaText(ctx.schemaText, collection, field, expected),
  );
  const changes: FileChange[] = [{ path: ctx.schemaPath, content: schemaText }];
  const notes: string[] = [];
  const rewritten: string[] = [];
  if (col.titleField === field || col.slugFrom === field) {
    notes.push(`note: titleField/slugFrom "${field}" removed from ${collection}`);
  }
  const order = Object.keys(col.fields).filter((key) => key !== field);
  const images: string[] = [];
  for (const entry of entriesOf(ctx, collection)) {
    if (format === 'markdown') {
      if (entry.body.trim() === '') continue;
      notes.push(`loses body: ${entry.path}`);
      changes.push({ path: entry.path, content: withoutBody(entry.text) });
      continue;
    }
    if (!Object.hasOwn(entry.data, field)) continue;
    const value = entry.data[field];
    if (value !== undefined && value !== null) notes.push(`loses data: ${entry.path} (${field})`);
    if (format === 'image') {
      const src = typeof value === 'string' ? value : (value as { src?: unknown } | null)?.src;
      const asset = typeof src === 'string' ? resolveAssetPath(ctx.schema, entry.path, src) : null;
      if (asset !== null && ctx.files.has(asset)) images.push(asset);
    }
    const expected = { ...entry.data };
    delete expected[field];
    changes.push({
      path: entry.path,
      content: editEntry(entry, removeTopLevelKey(entry.text, field), expected, order, rewritten),
    });
  }
  if (images.length > 0) notes.push(`note: image files are left on disk: ${[...new Set(images)].join(', ')}`);
  return { changes, notes, issues: checkChanges(ctx, changes), rewritten };
}
