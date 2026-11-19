import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { changesStore, onChanges } from './store';

import { isImagePath } from '../../../core/paths';
import type { GitHubSource } from '../../../github';
import { useBranches, useWorkspace } from '../github/workspace';

/** The unsaved entries of one scope of this repository (a branch): the rows that are not staged images. */
export interface ScopeCount {
  /** The branch the scope belongs to (`editlet/spring`, or the base branch). */
  branch: string;
  /** Entry rows in the scope's buffer. */
  entries: number;
}

export interface BufferScopes {
  /** The unsaved entries per branch, for the *Branches* sheet (*2 unsaved*). Only branches with rows. */
  counts: Map<string, number>;
  /** Branches of this repository that have unsaved entries and are not listed on GitHub any more. */
  gone: ScopeCount[];
  /** *Move to main*: the gone branch's rows go to the base branch's buffer. */
  moveToBase(branch: string): Promise<void>;
  /** *Discard*: the gone branch's rows are removed. */
  discard(branch: string): Promise<void>;
}

const EMPTY: BufferScopes = {
  counts: new Map(),
  gone: [],
  moveToBase: async () => undefined,
  discard: async () => undefined,
};

/**
 * What the changes buffer holds on every branch of this repository (GitHub mode; empty in dev mode): the counts the
 * branch picker shows, and the branches with unsaved entries that GitHub no longer lists (merged or deleted), checked
 * once the branch listing has loaded, so no edit is lost silently.
 */
export function useBufferScopes(): BufferScopes {
  const workspace = useWorkspace();
  const branches = useBranches();
  const client = useQueryClient();
  const cache = (workspace?.source as GitHubSource | undefined)?.cache;
  const owner = workspace?.config.owner;
  const repo = workspace?.config.repo;
  const listed = branches.data?.map((b) => b.name);
  const query = useQuery({
    queryKey: ['changes', 'scopes', owner, repo],
    enabled: cache !== undefined,
    queryFn: async () => {
      const prefix = `${owner}/${repo}#`;
      const out: ScopeCount[] = [];
      for (const scope of await cache!.scopes()) {
        if (!scope.startsWith(prefix)) continue;
        const rows = await cache!.pending(scope).list();
        const entries = rows.filter((r) => !isImagePath(r.path)).length;
        if (entries > 0) out.push({ branch: scope.slice(prefix.length), entries });
      }
      return out;
    },
  });
  useEffect(
    () =>
      cache
        ? onChanges(() => void client.invalidateQueries({ queryKey: ['changes', 'scopes', owner, repo] }))
        : undefined,
    [cache, client, owner, repo],
  );
  if (!workspace || !cache || !query.data) return EMPTY;
  const base = workspace.base;
  const scopeOf = (branch: string) => `${owner}/${repo}#${branch}`;
  const refresh = () => client.invalidateQueries({ queryKey: ['changes'] });
  return {
    counts: new Map(query.data.map((c) => [c.branch, c.entries])),
    gone: listed ? query.data.filter((c) => c.branch !== base && !listed.includes(c.branch)) : [],
    moveToBase: async (branch) => {
      await changesStore(cache, scopeOf(branch)).moveScope(scopeOf(branch), scopeOf(base));
      await refresh();
    },
    discard: async (branch) => {
      await changesStore(cache, scopeOf(branch)).clearAll();
      await refresh();
    },
  };
}
