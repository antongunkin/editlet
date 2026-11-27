import type { DevHistoryRequest, DevHistoryResponse } from '../../../core/devApi';
import { createMemorySource, type FileEvent } from '../../../core/source';
import { createLocalSource, type LocalSource } from '../source/local';

/**
 * A memory source with the local source's batch history read, which asks the dev API through the global `fetch`:
 * stub it before this call.
 */
export function sourceWithDevHistory(files: Record<string, string | Uint8Array>) {
  const { lastCommits } = createLocalSource();
  return { ...createMemorySource(files), lastCommits } satisfies Pick<LocalSource, 'lastCommits'>;
}

/** The paths a `POST /__editlet/history` request asks for. */
export function askedPaths(init: RequestInit | undefined): string[] {
  return (JSON.parse(String(init?.body)) as DevHistoryRequest).paths;
}

/** The dev API's answer to `POST /__editlet/history`: each path's last commit from `updated`. */
export function historiesResponse(paths: string[], updated: (path: string) => FileEvent | null): Response {
  const body: DevHistoryResponse = {
    histories: Object.fromEntries(
      paths.map((path) => [path, { updated: updated(path), created: null, commits: updated(path) ? 1 : 0 }]),
    ),
  };
  return new Response(JSON.stringify(body));
}
