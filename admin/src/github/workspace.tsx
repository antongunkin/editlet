import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { useOnForget } from './auth';

import { isEditletBranchName, resolveGitStyle, type GitStyle } from '../../../core/gitStyle';
import { createGitHubSource, type CmsBranch, type GitHubClient, type GitHubSource } from '../../../github';
import { EDITLET_PARAM, EDITLET_SOURCE } from '../../../loader/protocol';
import type { AdminGitHubConfig } from '../../config';
import { filesKey, SourceProvider } from '../source/context';

/** The GitHub repo the admin edits: which branch is active, and one source per branch over one shared client. */
export interface Workspace {
  config: AdminGitHubConfig;
  /** `config.baseBranch`: the live site. Read-only in the admin. */
  base: string;
  /** How branches, commits and pull requests are named: `git` of the schema on the base branch. */
  style: GitStyle;
  /** `style.branchPrefix`. */
  prefix: string;
  /** The site's editor query parameter (`config.param`, default `editlet`), for links to the site's pages. */
  param: string;
  /** The session's GitHub client (shared by every source). */
  client: GitHubClient;
  /** The base branch or a `<prefix>*` branch. */
  active: string;
  onBase: boolean;
  /** Bound to `active`. */
  source: GitHubSource;
  /** One memoised source per branch, all on the same client and cache. */
  sourceFor(branch: string): GitHubSource;
  /**
   * Makes `branch` active and stores it for this repo, and bumps `switches` (the open screen reloads) unless
   * `keepScreen` ("Edit on this branch" keeps the branch review). Does not ask the unsaved-changes guard: callers do.
   */
  switchTo(branch: string, options?: { keepScreen?: boolean }): void;
  /**
   * Creates the `<prefix>*` branch from the head of the base branch, refreshes `['branches']`, makes it active. Bumps
   * `switches` unless `keepScreen` (a save that moves to the new branch keeps its form).
   */
  createBranch(name: string, options?: { keepScreen?: boolean }): Promise<GitHubSource>;
  /**
   * Counts the branch switches that replace the open screen: `switchTo` and `createBranch` without `keepScreen`, and
   * the fallback from a gone stored branch. The shell keys the screen by it, so a form never stays on another branch.
   */
  switches: number;
  /** Set once when the stored branch no longer exists on GitHub and the base branch is shown instead. */
  fallbackNotice: string | null;
  /**
   * `active` was restored from storage and the branch listing has not confirmed it (nor failed) yet. If it is gone, its
   * file list fails (`not_found`) until the workspace falls back to the base branch.
   */
  restoring: boolean;
}

export const BRANCHES_KEY = ['branches'] as const;

const BRANCHES_STALE_MS = 10_000;

/** `localStorage` key of the active branch of one repo. */
export function activeBranchKey(owner: string, repo: string): string {
  return `${EDITLET_SOURCE}:branch:${owner}/${repo}`;
}

function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** The stored branch when it is the base or a `<prefix>*` name, else the base. */
function readActive(storage: Storage | undefined, key: string, base: string, prefix: string): string {
  try {
    const value = storage?.getItem(key);
    if (value && (value === base || isEditletBranchName(value, prefix))) return value;
  } catch {
    // Storage blocked: the base branch.
  }
  return base;
}

function writeActive(storage: Storage | undefined, key: string, branch: string): void {
  try {
    storage?.setItem(key, branch);
  } catch {
    // Storage blocked or full: the choice lasts for this page only.
  }
}

function branchesQuery(base: GitHubSource) {
  return { queryKey: BRANCHES_KEY, queryFn: () => base.listBranches(), staleTime: BRANCHES_STALE_MS };
}

const DEFAULT_STYLE = resolveGitStyle(null);

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider({
  config,
  style = DEFAULT_STYLE,
  param = EDITLET_PARAM,
  client,
  storage,
  children,
}: {
  config: AdminGitHubConfig;
  /** Read once from the base branch's schema before the workspace mounts. Default: the defaults. */
  style?: GitStyle;
  /** `config.param`. Default `editlet`. */
  param?: string;
  client: GitHubClient;
  /** Default `window.localStorage`. */
  storage?: Storage;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const { owner, repo, baseBranch: base } = config;
  const store = storage ?? defaultStorage();
  const key = activeBranchKey(owner, repo);
  const prefix = style.branchPrefix;

  const sources = useMemo(
    () =>
      new Map([
        [base, createGitHubSource({ owner, repo, branch: base, client, baseBranch: base, branchPrefix: prefix })],
      ]),
    [owner, repo, base, client, prefix],
  );
  const sourceFor = useCallback(
    (branch: string): GitHubSource => {
      let source = sources.get(branch);
      if (!source) {
        source = sources.get(base)!.withBranch(branch);
        sources.set(branch, source);
      }
      return source;
    },
    [sources, base],
  );

  // A sign-out or an account switch drops the content the cache keeps (blobs, last commits), once: every source shares
  // the one cache. Unsaved edits stay, and a failure does not block the sign-out.
  const forgetContent = useCallback(() => {
    try {
      void sources
        .get(base)!
        .cache.clearContent()
        .catch(() => undefined);
    } catch {
      // Best effort.
    }
  }, [sources, base]);
  useOnForget(forgetContent);

  /** `restoring`: `active` came from storage, until the first branch listing confirms it (or the user switches). */
  const [state, setState] = useState(() => {
    const active = readActive(store, key, base, prefix);
    return { active, notice: null as string | null, restoring: active !== base, switches: 0 };
  });

  const activate = useCallback(
    (branch: string, replaceScreen: boolean) => {
      if (branch !== base && !isEditletBranchName(branch, prefix)) {
        throw new TypeError(`Not the base branch or a ${prefix}* branch: "${branch}"`);
      }
      writeActive(store, key, branch);
      setState((s) => ({
        active: branch,
        notice: null,
        restoring: false,
        switches: replaceScreen ? s.switches + 1 : s.switches,
      }));
    },
    [base, prefix, store, key],
  );
  const switchTo = useCallback(
    (branch: string, options?: { keepScreen?: boolean }) => activate(branch, !options?.keepScreen),
    [activate],
  );

  const createBranch = useCallback(
    async (name: string, options?: { keepScreen?: boolean }): Promise<GitHubSource> => {
      const created = await sources.get(base)!.createBranch(name);
      sources.set(name, created);
      // Its file list first, so the open screen does not drop to "Loading…" (and lose a form it keeps) on the switch.
      await queryClient.prefetchQuery({ queryKey: filesKey(created), queryFn: () => created.listFiles() });
      activate(name, !options?.keepScreen);
      void queryClient.invalidateQueries({ queryKey: BRANCHES_KEY });
      return created;
    },
    [sources, base, activate, queryClient],
  );

  const branches = useQuery(branchesQuery(sources.get(base)!));
  useEffect(() => {
    if (!state.restoring) return;
    // The listing failed: nothing to confirm against, so a gone branch's own error shows instead.
    if (branches.error) return setState((s) => ({ ...s, restoring: false }));
    if (!branches.data) return;
    const restored = state.active;
    if (branches.data.some((b) => b.name === restored)) {
      setState((s) => ({ ...s, restoring: false }));
      return;
    }
    writeActive(store, key, base);
    setState((s) => ({
      active: base,
      notice: `Branch ${restored} no longer exists. Showing ${base}.`,
      restoring: false,
      switches: s.switches + 1,
    }));
  }, [state.restoring, state.active, branches.data, branches.error, store, key, base]);

  const workspace = useMemo(
    (): Workspace => ({
      config,
      base,
      style,
      prefix,
      param,
      client,
      active: state.active,
      onBase: state.active === base,
      source: sourceFor(state.active),
      sourceFor,
      switchTo,
      createBranch,
      fallbackNotice: state.notice,
      restoring: state.restoring,
      switches: state.switches,
    }),
    [config, base, style, prefix, param, client, state, sourceFor, switchTo, createBranch],
  );

  return (
    <WorkspaceContext.Provider value={workspace}>
      <SourceProvider source={workspace.source}>{children}</SourceProvider>
    </WorkspaceContext.Provider>
  );
}

/** The GitHub workspace; `null` in local mode. */
export function useWorkspace(): Workspace | null {
  return useContext(WorkspaceContext);
}

/** The repo's `<prefix>*` branches (listed from the base branch's source). Disabled outside a workspace. */
export function useBranches(): UseQueryResult<CmsBranch[]> {
  const workspace = useWorkspace();
  const base = workspace?.sourceFor(workspace.base);
  return useQuery({
    queryKey: BRANCHES_KEY,
    queryFn: () => base!.listBranches(),
    staleTime: BRANCHES_STALE_MS,
    enabled: base !== undefined,
  });
}
