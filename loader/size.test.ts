// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { build } from 'esbuild';
import { expect, it } from 'vitest';

it('stays within the size budget (5.5 KB minified, 2.2 KB gzip)', async () => {
  const result = await build({
    stdin: {
      contents: "import { mountEditletLoader } from './index'; mountEditletLoader();",
      resolveDir: fileURLToPath(new URL('.', import.meta.url)),
      loader: 'ts',
    },
    bundle: true,
    minify: true,
    format: 'esm',
    write: false,
  });
  const out = result.outputFiles[0]!.contents;
  expect(out.byteLength).toBeLessThanOrEqual(5632);
  expect(gzipSync(out).byteLength).toBeLessThanOrEqual(2253);
});
