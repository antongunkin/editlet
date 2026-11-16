// The dev host as a function: the demo page with the loader, the built admin and the dev API on one content root.
// `host.ts` runs it from the command line; the Playwright suite (admin/e2e/) starts one per test on a free port.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { mountDevApi } from './devApi';
import { ADMIN_PREFIX, buildDemoSite, CONTENT_TYPES, listen, send, serveAdmin } from './serve';

import { readProject } from '../../node/project';

export interface LocalHost {
  /** `http://localhost:<port>` */
  origin: string;
  /** The content root the dev API reads and writes. */
  root: string;
  close(): Promise<void>;
}

export async function startLocalHost(opts: { root: string; port?: number }): Promise<LocalHost> {
  const { root } = opts;
  const site = await buildDemoSite();
  const devApi = mountDevApi(root);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    if (pathname.startsWith('/__editlet')) {
      devApi(req, res, () => send(res, 404, 'Not found'));
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    if (pathname === '/') {
      // A broken schema still gets the page (with no cards), so the loader opens the admin and it shows the issues.
      const entries = await readProject(root).then(
        (project) => project.entries,
        () => [],
      );
      send(res, 200, site.page(entries), CONTENT_TYPES['.html']);
      return;
    }
    if (pathname === '/site.js') {
      send(res, 200, site.siteJs, CONTENT_TYPES['.js']);
      return;
    }
    if (pathname.startsWith(ADMIN_PREFIX)) {
      await serveAdmin(pathname, res);
      return;
    }
    send(res, 404, 'Not found');
  }

  const { origin, close } = await listen(handle, opts.port ?? 0);
  return { origin, root, close };
}
