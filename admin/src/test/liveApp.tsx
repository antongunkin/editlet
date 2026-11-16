// The admin as it runs on the live site: no dev API, `config.json` next to `index.html`, GitHub on the admin fake.
import { render } from '@testing-library/react';
import { useState } from 'react';

import { createAdminFakeGitHub, type AdminFakeGitHub } from './fakeGitHub';
import { createTestQueryClient } from './render';

import { DEV_API_BASE } from '../../../core/devApi';
import { ADMIN_CONFIG_FILE, type AdminConfig } from '../../config';
import { App } from '../App';

/** `config.json` for the fake's repo `o/r` on `main`. */
export const LIVE_CONFIG: AdminConfig = { github: { owner: 'o', repo: 'r', baseBranch: 'main' } };

/** The admin's fetch on the live site: no dev API, `config.json` (or none), GitHub forwarded to the fake. */
export function siteFetch(config: AdminConfig | null, github: AdminFakeGitHub = createAdminFakeGitHub()): typeof fetch {
  const configUrl = new URL(ADMIN_CONFIG_FILE, document.baseURI).href;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, document.baseURI);
    if (url.origin === 'https://api.github.com') return github.fetch(input, init);
    if (url.pathname === `${DEV_API_BASE}/files`) return new Response('Not found', { status: 404 });
    if (url.href === configUrl && config) return Response.json(config);
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
}

/**
 * Renders `<App>` with `fetchFn`, `window.localStorage` (active branch) and a QueryClient without retries. `win`: the
 * window for the route and the bridge (default `window`).
 */
export function renderLiveApp(fetchFn: typeof fetch, { win }: { win?: Window } = {}) {
  function Harness() {
    const [client] = useState(createTestQueryClient);
    return <App fetch={fetchFn} win={win} storage={window.localStorage} queryClient={client} />;
  }
  return render(<Harness />);
}
