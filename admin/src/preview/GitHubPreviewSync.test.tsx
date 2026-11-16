// GitHubPreviewSync with its hooks stubbed: the race between the site refresh's `head()` read and a branch switch.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GitHubPreviewSync } from './GitHubPreviewSync';

import { PREVIEW_ROUTE } from '../../../loader/protocol';

type Workspace = { active: string; onBase: boolean; source: { head: () => Promise<string> } };

const state = vi.hoisted(() => ({
  workspace: null as Workspace | null,
  refresh: null as null | (() => Promise<void>),
  sent: [] as unknown[],
}));

vi.mock('./PreviewProvider', () => ({
  usePreview: () => ({
    setBranchPreview: () => {},
    setRefreshSite: (fn: (() => Promise<void>) | null) => {
      state.refresh = fn;
    },
    setNotice: () => {},
  }),
}));
vi.mock('../github/workspace', () => ({ useWorkspace: () => state.workspace }));
vi.mock('../github/auth', () => ({ useAuth: () => ({ session: {}, getToken: async () => 'tok_1' }) }));
vi.mock('../useRoute', () => ({ useBridge: () => ({ send: (m: unknown) => state.sent.push(m) }) }));
// No file list: the head query stays off, so only the site refresh posts.
vi.mock('../data/queries', () => ({ useFiles: () => ({ data: undefined, dataUpdatedAt: 0 }), useSchema: () => ({}) }));
vi.mock('../../../loader/preview/db', () => ({ clearSnapshot: async () => {}, setPreviewFlag: () => {} }));

const SHA = 'a'.repeat(40);

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Preview-route calls, as `POST <branch>` / `DELETE`. */
function routeLog() {
  const log: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe(PREVIEW_ROUTE);
    if (init?.method === 'DELETE') log.push('DELETE');
    else log.push(`POST ${(JSON.parse(String(init?.body)) as { branch: string }).branch}`);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return { log, fetchFn };
}

function mount(fetchFn: typeof fetch) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = () => (
    <QueryClientProvider client={client}>
      <GitHubPreviewSync preview fetch={fetchFn} />
    </QueryClientProvider>
  );
  const r = render(ui());
  return { rerender: () => r.rerender(ui()) };
}

beforeEach(() => {
  state.workspace = null;
  state.refresh = null;
  state.sent = [];
});

afterEach(() => vi.restoreAllMocks());

describe('site refresh vs a branch switch', () => {
  it('a switch to the base branch during the head read posts nothing after DELETE', async () => {
    const head = deferred<string>();
    state.workspace = { active: 'editlet/x', onBase: false, source: { head: () => head.promise } };
    const { log, fetchFn } = routeLog();
    const { rerender } = mount(fetchFn);

    const refreshing = state.refresh!();
    // The editor switches to main while the refresh waits for the head.
    state.workspace = { active: 'main', onBase: true, source: { head: async () => SHA } };
    act(() => rerender());
    head.resolve(SHA);
    await act(() => refreshing);
    await act(() => new Promise((r) => setTimeout(r, 20)));

    expect(log).toEqual(['DELETE']);
    expect(state.sent).toEqual([{ type: 'refresh' }]);
  });

  it('a switch to another cms branch during the head read does not post the old branch', async () => {
    const head = deferred<string>();
    state.workspace = { active: 'editlet/x', onBase: false, source: { head: () => head.promise } };
    const { log, fetchFn } = routeLog();
    const { rerender } = mount(fetchFn);

    const refreshing = state.refresh!();
    state.workspace = { active: 'editlet/y', onBase: false, source: { head: async () => SHA } };
    act(() => rerender());
    head.resolve(SHA);
    await act(() => refreshing);
    await act(() => new Promise((r) => setTimeout(r, 20)));

    expect(log).not.toContain('POST editlet/x');
  });
});
