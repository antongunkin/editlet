// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { fromBase64, toBase64 } from './base64.ts';

describe('base64', () => {
  it('round-trips every byte value and matches standard base64', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it('handles empty input, padding and inputs larger than one chunk', () => {
    expect(toBase64(new Uint8Array())).toBe('');
    expect(toBase64(new Uint8Array([0xff]))).toBe('/w==');
    const big = Uint8Array.from({ length: 100_001 }, (_, i) => (i * 31) % 256);
    expect(toBase64(big)).toBe(Buffer.from(big).toString('base64'));
    expect(fromBase64(toBase64(big))).toEqual(big);
  });

  it('ignores whitespace (GitHub wraps base64 lines)', () => {
    expect(fromBase64('aGVs\nbG8=\n')).toEqual(new TextEncoder().encode('hello'));
  });
});
