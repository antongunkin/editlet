import { describe, expect, it } from 'vitest';

import { gitBlobSha } from './sha';

describe('gitBlobSha', () => {
  it('matches git hash-object for a string', async () => {
    expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('hashes bytes the same as the equivalent string', async () => {
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });

  it('hashes the empty blob', async () => {
    expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
  });

  it('counts UTF-8 bytes, not characters', async () => {
    // printf 'é' | git hash-object --stdin
    expect(await gitBlobSha('é')).toBe('4b04fff51468d8ab5201ab02b725dc477bc7cb45');
    expect(await gitBlobSha(new Uint8Array([0xc3, 0xa9]))).toBe('4b04fff51468d8ab5201ab02b725dc477bc7cb45');
  });
});
