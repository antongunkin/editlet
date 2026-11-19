import { useMemo } from 'react';

import { useBranchDiff } from './branchDiff';
import { FILE_STATUS_ORDER, type FileStatus } from './labels';
import { useLocalGitQuery } from './localGit';
import { useOtherReviews } from './otherReviews';

import { useBuffer } from '../changes/trayContext';
import { useBranches, useWorkspace } from '../github/workspace';

export { FILE_STATUS_ORDER, fileStatusLabel, type FileStatus } from './labels';

export interface FileStatuses {
  /** The badge's status (the first of unsaved, review, changed); `null` while unknown and for a file with none. */
  of(path: string): FileStatus | null;
  /**
   * Every status a file has, for the chips: a file both unsaved and in review is in both sets. Repo paths of entries,
   * images and the schema; a removed file is in them too (it has no row, so it only counts in totals).
   */
  refs: Record<FileStatus, ReadonlySet<string>>;
  /** Every source has answered once (the badges and chips are not partial). */
  ready: boolean;
}

/** The inputs of `fileStatuses`, each a list of repo paths. */
export interface FileStatusInputs {
  unsaved: Iterable<string>;
  review: Iterable<string>;
  changed: Iterable<string>;
  ready: boolean;
}

/** The statuses of these inputs: the sets, and `of` picking the first status in `FILE_STATUS_ORDER`. */
export function fileStatuses(inputs: FileStatusInputs): FileStatuses {
  const refs: Record<FileStatus, Set<string>> = {
    unsaved: new Set(inputs.unsaved),
    review: new Set(inputs.review),
    changed: new Set(inputs.changed),
  };
  return {
    of: (path) => (inputs.ready ? (FILE_STATUS_ORDER.find((s) => refs[s].has(path)) ?? null) : null),
    refs,
    ready: inputs.ready,
  };
}

const NONE: readonly string[] = [];

/**
 * The per-file statuses for the collection, search, Home and the entry. GitHub mode: `changed` = the files of the
 * active branch's diff (the shared `useBranchDiff`, nothing on the base branch); `review` = the same files when the
 * active branch has an open pull request that is not a draft, plus the paths the other branches' open, non-draft pull
 * requests change (`useOtherReviews`, newest 10; on the base branch the only statuses). Dev mode: `changed` = the uncommitted files of
 * `GET /__editlet/git` (`files`; also on a detached HEAD; `[]` from an older dev server), no `review`. `unsaved` = the
 * entry rows of the changes buffer (`useChanges`, in both modes).
 */
export function useFileStatuses(): FileStatuses {
  const workspace = useWorkspace();
  const github = workspace !== null;
  const localQuery = useLocalGitQuery(!github);
  const local = localQuery.data;
  const { diff, failed } = useBranchDiff();
  const branches = useBranches();
  const others = useOtherReviews();
  const buffered = useBuffer().entries;

  const onBase = workspace?.onBase ?? false;
  const pullRequest = github ? branches.data?.find((b) => b.name === workspace.active)?.pullRequest : undefined;
  const inReview = pullRequest !== undefined && pullRequest !== null && !pullRequest.isDraft;
  const branchFiles = github && !onBase ? diff?.files : undefined;
  // A failed request is settled too: no statuses from it, rather than chips that never stop loading.
  const ready = github
    ? (onBase || branchFiles !== undefined || failed) && !branches.isPending && others.ready
    : local !== undefined || localQuery.isError;

  return useMemo(() => {
    const changed = (github ? (branchFiles ?? []) : (local?.files ?? [])).map((f) => f.path);
    const unsaved = buffered.map((e) => e.path);
    const review = [...(inReview ? changed : NONE), ...others.paths];
    return fileStatuses({ unsaved, review, changed, ready });
  }, [github, branchFiles, local?.files, inReview, others.paths, buffered, ready]);
}
