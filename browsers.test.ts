import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { BROWSER_TARGETS } from './browsers';

const browserslist = (path: string): string[] =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).browserslist;

describe('browser baseline', () => {
  it('targets Chrome 125, Edge 125, Firefox 128 and Safari 17.5', () => {
    expect(BROWSER_TARGETS).toEqual(['chrome125', 'edge125', 'firefox128', 'safari17.5']);
  });

  it('keeps the root and package browserslist equal', () => {
    expect(browserslist('../../package.json')).toEqual(browserslist('./package.json'));
  });
});
