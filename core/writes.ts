import { decodeUtf8, parseEntryFile } from './entryFile';
import { EditletError, type Issue } from './issues';
import { entryFilePath, isCanonicalPath, isHiddenContentPath, isImagePath, parseEntryPath, parseRefKey } from './paths';
import { parseSchemaText, type Schema } from './schema';
import type { FileChange } from './source';
import { validateEntry } from './validate';

/**
 * True for the schema file itself, `.md` paths that `parseEntryPath` accepts and image paths inside `contentDir`.
 * Rejects non-canonical paths (absolute, `..` / `.` / empty segments, backslashes, NUL, `:`), hidden paths
 * (a segment below `contentDir` starting with `.`) and anything else.
 */
export function isWritablePath(schema: Schema, schemaPath: string, path: string): boolean {
  if (!isCanonicalPath(path)) return false;
  if (path === schemaPath) return true;
  if (!path.startsWith(`${schema.contentDir}/`) || isHiddenContentPath(schema, path)) return false;
  if (path.endsWith('.md')) return parseEntryPath(schema, path) !== null;
  return isImagePath(path);
}

function issuesOf(error: unknown, file: string): Issue[] {
  if (!(error instanceof EditletError)) throw error;
  return error.issues.map((issue) => ({ ...issue, file: issue.file ?? file }));
}

interface CheckState {
  schema: Schema;
  fileExists: (path: string) => boolean;
  entryExists: (ref: string) => boolean;
}

const issueKey = (i: Issue) => `${i.file}|${i.path}|${i.message}`;

function refExists(schema: Schema, fileExists: (path: string) => boolean) {
  return (ref: string) => {
    const parsed = parseRefKey(ref);
    if (!parsed || !Object.hasOwn(schema.collections, parsed.collection)) return false;
    const { collection, slug } = parsed;
    if (schema.collections[collection].singleton && slug !== 'index') return false;
    const path = entryFilePath(schema, collection, slug);
    return parseEntryPath(schema, path) !== null && fileExists(path);
  };
}

function checkEntry(
  state: CheckState,
  path: string,
  entry: { collection: string; slug: string },
  content: Uint8Array | string,
): Issue[] {
  const decoded = decodeUtf8(content, path);
  if ('issue' in decoded) return [decoded.issue];
  let file;
  try {
    file = parseEntryFile(decoded.text);
  } catch (error) {
    return issuesOf(error, path);
  }
  const { schema, ...ctx } = state;
  return validateEntry(schema, { ...entry, data: file.data, body: file.body }, ctx);
}

/** The repository state a batch of changes is validated against (before the changes). */
export interface ChangeContext {
  /** Parsed schema on disk; `null` when it is broken. */
  schema: Schema | null;
  schemaPath: string;
  exists: (path: string) => boolean;
  /** UTF-8 text of an existing file; `undefined` when it is missing or not valid UTF-8. Use together with `list`. */
  read?: (path: string) => string | undefined;
  /** Every existing file path (any order). Use together with `read`. */
  list?: () => Iterable<string>;
}

/**
 * Validates a set of writes against the state AFTER the changes. A schema change in the batch is parsed and used
 * for the entries of the same batch; if it fails to parse only its issues are returned. `current.schema === null`
 * means the schema on disk is broken: then only a change to the schema file is accepted.
 *
 * Changed entries are always validated. When `current.read` and `current.list` are given and the batch deletes a
 * file or changes the schema, every other non-hidden `.md` file under the old or new `contentDir` is validated too,
 * with the post-change schema and file set, and only issues it did not already have before the batch (same
 * `path` + `message` under the pre-change schema and file set) are reported: deleting a referenced entry or image,
 * or a schema change that breaks existing entries (or turns entries into non-entries), returns issues, while stray
 * or already-broken files do not block unrelated changes. Without `read` / `list` unchanged entries are not
 * re-validated, so a caller (e.g. the GitHub source) must pass both, or validate the whole project, for the same
 * guarantee.
 */
export function validateChanges(current: ChangeContext, changes: FileChange[]): Issue[] {
  const { schemaPath } = current;
  const latest = new Map<string, FileChange['content']>();
  const duplicates = new Set<string>();
  for (const change of changes) {
    if (latest.has(change.path)) duplicates.add(change.path);
    latest.set(change.path, change.content);
  }
  if (duplicates.size > 0) {
    return [...duplicates].map((file) => ({ file, path: '', message: 'Duplicate path in changes' }));
  }

  let schema = current.schema;
  if (latest.has(schemaPath)) {
    const content = latest.get(schemaPath) ?? null;
    if (content === null) return [{ file: schemaPath, path: '', message: 'The schema file cannot be deleted' }];
    const decoded = decodeUtf8(content, schemaPath);
    if ('issue' in decoded) return [decoded.issue];
    try {
      schema = parseSchemaText(decoded.text, schemaPath);
    } catch (error) {
      return issuesOf(error, schemaPath);
    }
  }

  const issues: Issue[] = [];
  if (current.schema === null) {
    for (const path of latest.keys()) {
      if (path === schemaPath) continue;
      issues.push({ file: path, path: '', message: `The schema (${schemaPath}) is invalid; fix it first` });
    }
    return issues;
  }
  const prev = current.schema;
  const effective = schema ?? prev;

  const fileExists = (path: string) => (latest.has(path) ? latest.get(path) !== null : current.exists(path));
  const after = { schema: effective, fileExists, entryExists: refExists(effective, fileExists) };
  for (const [path, content] of latest) {
    if (path === schemaPath) continue;
    if (!isWritablePath(effective, schemaPath, path)) {
      issues.push({ file: path, path: '', message: 'Path not writable' });
      continue;
    }
    const parsed = content === null ? null : parseEntryPath(effective, path);
    if (content !== null && parsed !== null) issues.push(...checkEntry(after, path, parsed, content));
  }

  const { read, list } = current;
  const wide = latest.has(schemaPath) || [...latest.values()].includes(null);
  if (!wide || read === undefined || list === undefined) return issues;
  const before = { schema: prev, fileExists: current.exists, entryExists: refExists(prev, current.exists) };
  for (const path of list()) {
    if (latest.has(path) || path === schemaPath || !path.endsWith('.md')) continue;
    const owner = [effective, prev].find((s) => path.startsWith(`${s.contentDir}/`));
    if (owner === undefined || isHiddenContentPath(owner, path)) continue;
    const wasEntry = parseEntryPath(prev, path);
    const isEntry = parseEntryPath(effective, path);
    if (isEntry === null) {
      if (wasEntry !== null) issues.push({ file: path, path: '', message: 'Not an entry file' });
      continue;
    }
    const text = read(path);
    if (text === undefined) continue; // unreadable before and after: not caused by this batch
    const known = new Set(wasEntry === null ? [] : checkEntry(before, path, wasEntry, text).map(issueKey));
    issues.push(...checkEntry(after, path, isEntry, text).filter((i) => !known.has(issueKey(i))));
  }
  return issues;
}

/** `validateChanges` plus the commit-message rule shared by every `ContentSource.commit`. */
export function validateCommit(current: ChangeContext, changes: FileChange[], message: string): Issue[] {
  const issues = validateChanges(current, changes);
  if (message.trim() === '') issues.push({ path: '', message: 'Commit message is required' });
  return issues;
}
