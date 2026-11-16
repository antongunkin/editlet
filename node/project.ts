import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { DEFAULT_SCHEMA_PATH, listFiles, loadProjectSchema } from './fs';

import { generateTypes } from '../core/generate';
import type { Issue } from '../core/issues';
import { refKey } from '../core/paths';
import { byFile, entriesFromFiles, entryCandidate, isSkippedPath } from '../core/project';
import type { Schema } from '../core/schema';
import { validateEntry, type Entry } from '../core/validate';

export interface Project {
  root: string;
  schema: Schema;
  entries: Entry[];
  issues: Issue[];
}

const DEFAULT_TYPES_FILE = '.editlet/content.d.ts';

export async function readProject(root: string, schemaPath = DEFAULT_SCHEMA_PATH): Promise<Project> {
  const schema = await loadProjectSchema(root, schemaPath);
  const files = await listFiles(root, schema.contentDir);
  const contents = new Map<string, Uint8Array>();
  for (const file of files) {
    if (isSkippedPath(schema, schemaPath, file)) continue;
    // Non-entry files are passed through empty so entriesFromFiles reports them without reading them.
    contents.set(
      file,
      entryCandidate(schema, file) ? new Uint8Array(await readFile(join(root, file))) : new Uint8Array(),
    );
  }
  return { root, schema, ...entriesFromFiles(schema, schemaPath, contents) };
}

export async function validateProject(root: string, schemaPath = DEFAULT_SCHEMA_PATH): Promise<Issue[]> {
  const project = await readProject(root, schemaPath);
  const { schema, entries } = project;
  const refs = new Set(entries.map((e) => refKey(e.collection, e.slug)));
  const files = new Set(await listFiles(root, schema.contentDir));
  const issues = [...project.issues];
  for (const entry of entries) {
    issues.push(
      ...validateEntry(schema, entry, { entryExists: (ref) => refs.has(ref), fileExists: (p) => files.has(p) }),
    );
  }
  return issues.toSorted(byFile);
}

export async function writeTypes(
  root: string,
  outFile = DEFAULT_TYPES_FILE,
  schemaPath = DEFAULT_SCHEMA_PATH,
): Promise<string> {
  const schema = await loadProjectSchema(root, schemaPath);
  const target = resolve(root, outFile);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, generateTypes(schema));
  return target;
}
