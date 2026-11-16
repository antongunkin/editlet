import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { EditletError } from '../core/issues';
import { parseSchemaText, type Schema } from '../core/schema';

export const DEFAULT_SCHEMA_PATH = 'cms/schema.json';

export async function loadProjectSchema(root: string, schemaPath: string): Promise<Schema> {
  let raw: string;
  try {
    raw = await readFile(join(root, schemaPath), 'utf8');
  } catch (error) {
    throw new EditletError([
      { file: schemaPath, path: '', message: `Cannot read schema: ${error instanceof Error ? error.message : error}` },
    ]);
  }
  return parseSchemaText(raw, schemaPath);
}

/** All regular files under `root/contentDir` as sorted repo-relative posix paths (dot files included). */
export async function listFiles(root: string, contentDir: string): Promise<string[]> {
  let dirents;
  try {
    dirents = await readdir(join(root, contentDir), { recursive: true, withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return dirents
    .filter((d) => d.isFile())
    .map((d) => `${relativeDir(root, d.parentPath)}/${d.name}`.split('\\').join('/'))
    .toSorted();
}

function relativeDir(root: string, dir: string): string {
  return resolve(dir).slice(resolve(root).length + 1);
}
