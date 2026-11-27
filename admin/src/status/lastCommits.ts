import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { FileEvent } from '../../../core/source';
import { useWorkspace } from '../github/workspace';
import { sourceKey, useSource } from '../source/context';
import type { LocalSource } from '../source/local';

/** A list row's file: its path, and the sha it was listed at (`null` for an entry that is not saved yet). */
export type LastCommitRow = { path: string; sha: string | null };

export type LastCommits = {
  /** The last commit of each row's file (`null`: no commit, or not loaded). Rows left out are not in it. */
  updated: Map<string, FileEvent | null>;
  /** A load is in flight and the map does not hold its answer yet. */
  pending: boolean;
};

const NONE = new Map<string, FileEvent | null>();

/** FNV-1a (32 bit) of `text`, in base 36: a short key for a long list of paths and shas. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * The last commit of every row's file, for a list: one `lastCommits` call, keyed by the rows' `path:sha` pairs. GitHub
 * mode: the workspace's source (a batch of 50 paths per GraphQL query, cached by blob sha; the answer for a file stands
 * until its content changes, as that cache has it). Dev mode: the local source (one dev API request per 500 paths),
 * asked again when the list opens again, because a `git commit` moves no sha. Both branches' hooks run every render;
 * `enabled` picks one.
 */
export function useLastCommits(rows: LastCommitRow[]): LastCommits {
  const workspace = useWorkspace();
  const source = useSource();
  const { paths, key } = useMemo(() => {
    const saved = rows.flatMap((row) => (row.sha === null ? [] : [{ path: row.path, sha: row.sha }]));
    return {
      paths: saved.map((row) => row.path),
      key: fnv1a(saved.map((row) => `${row.path}:${row.sha}`).join('\n')),
    };
  }, [rows]);

  // While the rows of this branch change (a save moves one file's sha), the previous dates stay until the new answer
  // comes; another branch's dates never show.
  const branch = sourceKey(source);
  const queryKey = ['last-commits', branch, key] as const;
  const placeholderData = (
    previous: Map<string, FileEvent | null> | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
  ) => (previousQuery?.queryKey[1] === branch ? previous : undefined);
  const github = useQuery({
    queryKey,
    queryFn: () => workspace!.source.lastCommits(paths),
    enabled: workspace !== null && paths.length > 0,
    staleTime: Infinity,
    retry: false,
    placeholderData,
  });
  // A source without the batch read (the tests' memory source) has no dates in dev mode.
  const local = workspace === null && 'lastCommits' in source ? (source as LocalSource) : null;
  const dev = useQuery({
    queryKey,
    queryFn: () => local!.lastCommits(paths),
    enabled: local !== null && paths.length > 0,
    retry: false,
    placeholderData,
  });

  const query = workspace === null ? dev : github;
  const asked = (workspace !== null || local !== null) && paths.length > 0;
  return { updated: query.data ?? NONE, pending: asked && (query.isPending || query.isPlaceholderData) };
}
