import type { IncomingMessage, ServerResponse } from 'node:http';

import { DEV_API_BASE } from '../../core/devApi';
import { createDevHandler } from '../../node/devHandler';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks);
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return headers;
}

/** Connect-style middleware (Vite `configureServer`) serving the dev file API for `root`. */
export function mountDevApi(
  root: string,
  schemaPath?: string,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  const handler = createDevHandler({ root, schemaPath });

  async function serve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req);
    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method,
      headers: toHeaders(req),
      body,
      duplex: 'half',
    } as RequestInit);
    const response = await handler(request);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(Buffer.from(await response.arrayBuffer()));
  }

  return (req, res, next) => {
    if (!req.url?.startsWith(DEV_API_BASE)) {
      next();
      return;
    }
    serve(req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
      }
      res.end(
        JSON.stringify({ issues: [{ path: '', message: error instanceof Error ? error.message : String(error) }] }),
      );
    });
  };
}
