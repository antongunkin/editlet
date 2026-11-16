import { decodeUtf8, parseEntryFile } from './entryFile';
import { EditletError, type Issue } from './issues';
import { entryFilePath, isHiddenContentPath, isImagePath, parseEntryPath } from './paths';
import type { Schema } from './schema';
import type { Entry } from './validate';

export const byFile = (a: { file?: string }, b: { file?: string }) => (a.file ?? '').localeCompare(b.file ?? '');

/** Schema file, hidden paths and images are never entries nor reported. */
export function isSkippedPath(schema: Schema, schemaPath: string, file: string): boolean {
  return file === schemaPath || isHiddenContentPath(schema, file) || isImagePath(file);
}

/** Collection/slug when `file` is an entry file (`.md` under the schema's layout), else null. */
export function entryCandidate(schema: Schema, file: string): { collection: string; slug: string } | null {
  return file.endsWith('.md') ? parseEntryPath(schema, file) : null;
}

/** Pure "files → entries" step shared by the node reader and the preview reader. */
export function entriesFromFiles(
  schema: Schema,
  schemaPath: string,
  files: Map<string, Uint8Array>,
): { entries: Entry[]; issues: Issue[] } {
  const entries: Entry[] = [];
  const issues: Issue[] = [];

  for (const [file, content] of files) {
    if (isSkippedPath(schema, schemaPath, file)) continue;
    const parsed = entryCandidate(schema, file);
    if (!parsed) {
      issues.push({ file, path: '', message: 'Not an entry file' });
      continue;
    }
    const decoded = decodeUtf8(content, file);
    if ('issue' in decoded) {
      issues.push(decoded.issue);
      continue;
    }
    try {
      const { data, body } = parseEntryFile(decoded.text);
      entries.push({ collection: parsed.collection, slug: parsed.slug, data, body });
    } catch (error) {
      if (!(error instanceof EditletError)) throw error;
      issues.push(...error.issues.map((issue) => ({ ...issue, file })));
    }
  }

  const fileOf = (e: Entry) => entryFilePath(schema, e.collection, e.slug);
  return {
    entries: entries.toSorted((a, b) => fileOf(a).localeCompare(fileOf(b))),
    issues: issues.toSorted(byFile),
  };
}
