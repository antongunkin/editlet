import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Readable } from 'node:stream';

import { DEV_API_BASE } from '../core/devApi';
import { createDevHandler } from '../node/devHandler';

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Browser-facing host from `x-forwarded-host` (first entry), or `null` when absent or empty. */
function forwardedHost(req: IncomingMessage): string | null {
  const first = firstValue(req.headers['x-forwarded-host'])?.split(',')[0]?.trim();
  return first ? first : null;
}

function toRequest(req: IncomingMessage, host: string): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(`http://${host}${req.url ?? '/'}`, {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
    duplex: 'half',
  } as RequestInit);
}

/**
 * Dev-only loopback server that exposes the `/__editlet` file API; the Next adapter proxies to it so the
 * site needs no route file. Never import this in production.
 */
export async function startDevApi(options: {
  root: string;
  schemaPath?: string;
}): Promise<{ port: number; close(): Promise<void> }> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('editlet/next/devServer must not be used in production');
  }
  const handler = createDevHandler(options);
  let port = 0;
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        // Only `next dev`'s proxy (changeOrigin => Host is the bridge address) may reach the handler; this blocks
        // DNS-rebinding pages that hit the port directly and forge x-forwarded-host.
        // Host safety relies on Next's dev proxy overriding x-forwarded-host with the real Host
        // (proxy-request.js, httpxy options.headers), so a browser cannot forge it through the rewrite.
        const host = forwardedHost(req);
        if (req.headers.host !== `127.0.0.1:${port}` || host === null) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden');
          return;
        }
        const response = await handler(toRequest(req, host));
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(body);
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`${DEV_API_BASE}: ${error instanceof Error ? error.message : 'internal error'}`);
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
