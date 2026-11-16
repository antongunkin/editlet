import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { TLSSocket } from 'node:tls';

/**
 * Web `Request` for a Node request. The URL is built from the real `Host` header (the dev API's DNS-rebinding guard
 * reads the host from the URL), and the body is streamed for methods that carry one. `signal` lets the caller abort
 * the request when the client goes away.
 */
export function toWebRequest(req: IncomingMessage, signal?: AbortSignal): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined || key.startsWith(':')) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(key, v);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  // HTTP/2 (Vite `server.https`) sends `:authority` instead of `host`. No host at all fails closed: the dev API's
  // local-host guard refuses `invalid.invalid`.
  const host = req.headers.host ?? req.headers[':authority'] ?? 'invalid.invalid';
  const proto = (req.socket as TLSSocket | undefined)?.encrypted ? 'https' : 'http';
  return new Request(new URL(req.url ?? '/', `${proto}://${host}`), {
    method,
    headers,
    signal,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: hasBody ? 'half' : undefined,
  } as RequestInit);
}

/** Writes a Web `Response` to a Node response (every `Set-Cookie` kept as its own header). */
export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}
