import { isRefPath } from '../core/schema';
import { EDITLET_SOURCE } from '../loader/protocol';

/** The branch and commit a draft render reads. */
export type PreviewRef = { branch: string; sha: string };

export const PREVIEW_COOKIE = `${EDITLET_SOURCE}-preview` as const;
export const MIN_PREVIEW_SECRET_LENGTH = 32;
export const SHA_RE = /^[0-9a-f]{40}$/;

/** `CMS_PREVIEW_SECRET` when it is set and long enough, else `null`. */
export function readPreviewSecret(): string | null {
  const secret = process.env.CMS_PREVIEW_SECRET;
  return secret && secret.length >= MIN_PREVIEW_SECRET_LENGTH ? secret : null;
}

export function isPreviewRef(value: unknown): value is PreviewRef {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { branch, sha } = value as Record<string, unknown>;
  return typeof branch === 'string' && isRefPath(branch) && typeof sha === 'string' && SHA_RE.test(sha);
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Strict decode: only the canonical unpadded encoding is accepted, so one value has one spelling. */
function fromB64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  let binary: string;
  try {
    binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return b64url(bytes) === text ? bytes : null;
}

function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

/** `<b64url(json)>.<b64url(HMAC-SHA256 over the first part)>`. */
export async function signPreview(payload: PreviewRef & { exp: number }, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify({ branch: payload.branch, sha: payload.sha, exp: payload.exp })));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), encoder.encode(body));
  return `${body}.${b64url(new Uint8Array(sig))}`;
}

/** The signed ref, or `null` when the value is malformed, tampered with, or expired (`exp <= now / 1000`). */
export async function verifyPreview(value: string, secret: string, now = Date.now()): Promise<PreviewRef | null> {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [body, sigText] = parts;
  const sig = fromB64url(sigText);
  if (!sig || !fromB64url(body)) return null;
  // Constant-time comparison happens inside `crypto.subtle.verify`.
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig, encoder.encode(body));
  if (!ok) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(body)!));
  } catch {
    return null;
  }
  if (!isPreviewRef(payload)) return null;
  const { exp } = payload as unknown as Record<string, unknown>;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= now / 1000) return null;
  return { branch: payload.branch, sha: payload.sha };
}
