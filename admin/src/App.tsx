import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';

import { GitHubApp, NotConfigured } from './github/GitHubApp';
import { PreviewProvider } from './preview/PreviewProvider';
import { BrokenSchema } from './screens/BrokenSchema';
import { GateLoading } from './screens/GateLoading';
import { Shell } from './Shell';
import { SourceProvider } from './source/context';
import { detectMode } from './source/detect';
import { createLocalSource } from './source/local';
import { BridgeProvider } from './useRoute';
import { CollapsedProvider } from './window/collapsed';

import type { Issue } from '../../core/issues';
import type { ContentSource } from '../../core/source';
import { ADMIN_CONFIG_FILE, parseAdminConfig, type AdminConfig } from '../config';

export type AppProps = {
  /** Use this source and skip mode detection (tests, future hosts). */
  source?: ContentSource;
  /** Window for the route + protocol bridge (default `window`). */
  win?: Window;
  /** Fetch for `detectMode`, the local source, `config.json` and GitHub (default `globalThis.fetch`). */
  fetch?: typeof fetch;
  /** Storage for the active branch (default `window.localStorage`). The GitHub session uses `sessionStorage`. */
  storage?: Storage;
  /** Query client (default: one per App with `retry: 1`, no refetch on focus). */
  queryClient?: QueryClient;
};

type Mode =
  | { kind: 'detecting' }
  | { kind: 'ready'; source: ContentSource }
  | { kind: 'broken'; issues: Issue[] }
  /** No dev API: production mode, configured by `config.json` (`null` when missing or unreadable). */
  | { kind: 'github'; config: AdminConfig | null };

export function createAdminQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } });
}

/** `config.json` next to the admin's `index.html`; `null` when it is missing or not JSON. */
async function loadAdminConfig(fetchFn: typeof fetch): Promise<AdminConfig | null> {
  try {
    const res = await fetchFn(new URL(ADMIN_CONFIG_FILE, document.baseURI), { cache: 'no-cache' });
    if (!res.ok) return null;
    return parseAdminConfig(await res.json());
  } catch {
    return null;
  }
}

function useMode(source: ContentSource | undefined, fetchFn: typeof fetch | undefined): Mode {
  const [detected, setDetected] = useState<Mode>({ kind: 'detecting' });
  useEffect(() => {
    if (source) return;
    let cancelled = false;
    const f = fetchFn ?? globalThis.fetch.bind(globalThis);
    const detect = async (): Promise<Mode> => {
      const result = await detectMode(f);
      if (result.mode === 'local') return { kind: 'ready', source: createLocalSource({ fetch: f }) };
      if (result.mode === 'local-broken') return { kind: 'broken', issues: result.issues };
      return { kind: 'github', config: await loadAdminConfig(f) };
    };
    void detect().then((mode) => {
      if (!cancelled) setDetected(mode);
    });
    return () => {
      cancelled = true;
    };
  }, [source, fetchFn]);
  return source ? { kind: 'ready', source } : detected;
}

/**
 * Admin root: picks the source (given, or by `detectMode`: the dev API, else GitHub as `config.json` says), then
 * renders the shell inside the providers.
 */
export function App({ source, win, fetch: fetchFn, storage, queryClient }: AppProps) {
  const [client] = useState(() => queryClient ?? createAdminQueryClient());
  const mode = useMode(source, fetchFn);

  let content: ReactNode;
  switch (mode.kind) {
    case 'detecting':
      content = <GateLoading />;
      break;
    case 'github':
      content = mode.config?.github ? (
        <GitHubApp config={mode.config} fetch={fetchFn} storage={storage} />
      ) : (
        <NotConfigured />
      );
      break;
    case 'broken':
      content = <BrokenSchema issues={mode.issues} />;
      break;
    case 'ready':
      content = (
        <SourceProvider source={mode.source}>
          <Shell />
        </SourceProvider>
      );
  }

  // GitHub mode sets the preview flag while an Editlet branch is active; local mode never does (`?editlet` loads the overlay).
  const github = mode.kind === 'github';
  return (
    <QueryClientProvider client={client}>
      <BridgeProvider win={win}>
        <PreviewProvider flag={github} sessionMinutes={github ? mode.config?.sessionMinutes : undefined}>
          <CollapsedProvider>{content}</CollapsedProvider>
        </PreviewProvider>
      </BridgeProvider>
    </QueryClientProvider>
  );
}
