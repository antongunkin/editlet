import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { DEV_API_BASE, type DevGitFile, type DevGitResponse } from '../../../core/devApi';

const POLL_MS = 3000;

/** The dev server's git state query; writes invalidate it (`invalidateFiles`). */
export const LOCAL_GIT_KEY = ['local-git'] as const;

/** The dev server's git state, `DevGitResponse` with what an older `editlet` dev server leaves out filled in. */
export type LocalGit = DevGitResponse;

/**
 * The raw response, read leniently: `files` and `project` are additive fields of `GET /__editlet/git`; a missing
 * `files` is `[]` and a missing `project` is `'default'` (an older dev server: no statuses, one shared scope).
 */
export function toLocalGit(raw: Partial<DevGitResponse> & Pick<DevGitResponse, 'branch' | 'changes'>): LocalGit {
  return {
    branch: raw.branch,
    changes: raw.changes,
    files: Array.isArray(raw.files) ? (raw.files as DevGitFile[]) : [],
    project: typeof raw.project === 'string' && raw.project !== '' ? raw.project : 'default',
  };
}

/**
 * The dev server's git state (`GET /__editlet/git`), polled every 3 s while the tab is visible; `null` until it loads
 * or when it fails. One query (`['local-git']`) feeds the branch badge and the per-file statuses. Also on a detached
 * HEAD (`branch: null`): the files still count. `enabled: false` in GitHub mode.
 */
export function useLocalGit(enabled = true): LocalGit | null {
  return useLocalGitQuery(enabled).data ?? null;
}

/** `useLocalGit`'s query, for callers that also need to know it failed (`isError`: no statuses, not "loading"). */
export function useLocalGitQuery(enabled = true) {
  return useQuery({
    queryKey: LOCAL_GIT_KEY,
    refetchInterval: POLL_MS,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await fetch(`${DEV_API_BASE}/git`);
      if (!res.ok) throw new Error(`git: ${res.status}`);
      return toLocalGit((await res.json()) as Partial<DevGitResponse> & Pick<DevGitResponse, 'branch' | 'changes'>);
    },
    retry: false,
    enabled,
  });
}
