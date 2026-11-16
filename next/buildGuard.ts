import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const DEV_HANDLER_MARKER = 'File changed since it was read';

const CODE_FILE = /\.(?:js|mjs|cjs|json)$/;

/** First built file under `distDir` that contains the dev-handler marker, or `null`. */
export async function findDevHandlerCode(distDir: string): Promise<string | null> {
  let dirents;
  try {
    dirents = await readdir(distDir, { recursive: true, withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirents) {
    if (!d.isFile() || !CODE_FILE.test(d.name)) continue;
    const top = relative(distDir, d.parentPath).split(sep)[0];
    if (top === 'cache' || top === 'dev') continue;
    const file = join(d.parentPath, d.name);
    if ((await readFile(file, 'utf8')).includes(DEV_HANDLER_MARKER)) return file;
  }
  return null;
}
