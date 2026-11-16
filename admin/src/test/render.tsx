import { QueryClient } from '@tanstack/react-query';
import { render, waitFor, within, type ByRoleMatcher, type ByRoleOptions } from '@testing-library/react';

import { fixtureFiles } from './fixture';

import { createMemorySource, type ContentSource } from '../../../core/source';
import { withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';

export { fixtureFiles };

/**
 * Where the open entry's buttons (Save, More, Discard changes, Delete) are: the form's split button at the bottom of
 * the window's body. Looked up on every query, since the form remounts (a new entry, once saved, opens as the file).
 */
export function entryActions() {
  const bar = () =>
    within(document.querySelector<HTMLElement>('.editlet-edit-post__actions') ?? document.createElement('div'));
  return {
    getByRole: (role: ByRoleMatcher, options?: ByRoleOptions) => bar().getByRole(role, options),
    queryByRole: (role: ByRoleMatcher, options?: ByRoleOptions) => bar().queryByRole(role, options),
    findByRole: (role: ByRoleMatcher, options?: ByRoleOptions) => waitFor(() => bar().getByRole(role, options)),
  };
}

export function createTestQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
}

export type RenderAppOptions = {
  files?: Record<string, string | Uint8Array>;
  /** `?editlet` route to start on (default home). */
  route?: string;
  source?: ContentSource;
  queryClient?: QueryClient;
  /** Window for the bridge (e.g. `createFakeWindow().win` for an embedded admin); its own `location` is used. */
  win?: Window;
};

/**
 * Renders the standalone `<App>` (jsdom: `window.parent === window`) at `/editlet/?editlet=<route>` over a memory source
 * (built from `files`, default the fixture site) and a QueryClient without retries.
 */
export function renderApp({ files, route = '', source, queryClient, win }: RenderAppOptions = {}) {
  window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
  if (win) win.history.replaceState(null, '', withEditletRoute(win.location.href, route));
  const src = source ?? createMemorySource(files ?? fixtureFiles());
  const client = queryClient ?? createTestQueryClient();
  const result = render(<App source={src} queryClient={client} win={win} />);
  return { source: src, queryClient: client, ...result };
}
