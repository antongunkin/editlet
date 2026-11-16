const encoder = new TextEncoder();

/** Git blob object id (SHA-1 over `blob <byteLength>\0<bytes>`), as printed by `git hash-object`. */
export async function gitBlobSha(content: Uint8Array | string): Promise<string> {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  const header = encoder.encode(`blob ${bytes.byteLength}\0`);
  const buffer = new Uint8Array(header.byteLength + bytes.byteLength);
  buffer.set(header);
  buffer.set(bytes, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', buffer));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
