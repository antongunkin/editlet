import { afterEach, describe, expect, it, vi } from 'vitest';

import { readPreviewEnv } from './previewEnv';

afterEach(() => vi.unstubAllEnvs());

describe('readPreviewEnv', () => {
  it('reads the injected config', () => {
    const value = { owner: 'acme', repo: 'site', schemaPath: 'cms/schema.json', sessionMinutes: 60 };
    vi.stubEnv('EDITLET_PREVIEW', JSON.stringify(value));
    expect(readPreviewEnv()).toEqual(value);
  });

  it('returns null for missing or invalid JSON', () => {
    vi.stubEnv('EDITLET_PREVIEW', '');
    expect(readPreviewEnv()).toBeNull();
    vi.stubEnv('EDITLET_PREVIEW', '{nope');
    expect(readPreviewEnv()).toBeNull();
  });

  it('returns null for the wrong shape', () => {
    vi.stubEnv('EDITLET_PREVIEW', JSON.stringify({ owner: 'a', repo: 'b', schemaPath: 'c' }));
    expect(readPreviewEnv()).toBeNull();
    vi.stubEnv('EDITLET_PREVIEW', JSON.stringify({ owner: 'a', repo: 'b', schemaPath: 'c', sessionMinutes: '1' }));
    expect(readPreviewEnv()).toBeNull();
    vi.stubEnv('EDITLET_PREVIEW', '[]');
    expect(readPreviewEnv()).toBeNull();
  });
});
