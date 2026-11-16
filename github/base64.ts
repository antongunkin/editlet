// A multiple of 3, so each chunk encodes to whole base64 quads and the pieces concatenate cleanly.
const CHUNK = 3 * 8192;

/** Standard base64 (with padding). Does not rely on `Uint8Array.prototype.toBase64`. */
export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += btoa(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

/** Decodes standard base64; whitespace (GitHub wraps base64 at 60 columns) is ignored. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
