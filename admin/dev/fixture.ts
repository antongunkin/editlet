import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = fileURLToPath(new URL('../../node/__fixtures__/site', import.meta.url));

/** Copies the site fixture into a fresh temp directory so dev edits never touch the fixture. */
export async function copyFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'editlet-admin-'));
  await cp(FIXTURE_DIR, root, { recursive: true });
  return root;
}
