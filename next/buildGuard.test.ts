// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findDevHandlerCode } from './buildGuard';

let dist: string;
beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), 'editlet-dist-'));
  await mkdir(join(dist, 'server'));
});
afterEach(() => rm(dist, { recursive: true, force: true }));

describe('findDevHandlerCode', () => {
  it('returns the file containing the marker', async () => {
    await writeFile(join(dist, 'server/a.js'), 'throw new Error("File changed since it was read")');
    await writeFile(join(dist, 'server/b.js'), 'ok');
    expect(await findDevHandlerCode(dist)).toBe(join(dist, 'server/a.js'));
  });

  it('returns null otherwise', async () => {
    await writeFile(join(dist, 'server/b.js'), 'ok');
    await writeFile(join(dist, 'server/a.js.map'), 'File changed since it was read');
    expect(await findDevHandlerCode(dist)).toBeNull();
    await mkdir(join(dist, 'cache'));
    await writeFile(join(dist, 'cache/c.js'), 'File changed since it was read');
    expect(await findDevHandlerCode(dist)).toBeNull();
    expect(await findDevHandlerCode(join(dist, 'missing'))).toBeNull();
  });
});
