import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { routeFromBranch } from './branchName';
import { useGitHubUser } from './user';
import { BRANCHES_KEY, useBranches, useWorkspace, type Workspace } from './workspace';

import {
  describeChanges,
  formatCommitMessage,
  pullRequestBlock,
  resolveGitStyle,
  withTrailer,
  type CommitSubject,
} from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import {
  ownersOfAll,
  parseCodeowners,
  readCodeowners,
  type BranchDiffFile,
  type CmsBranch,
  type CodeownersRule,
  type GitHubSource,
} from '../../../github';

/**
 * The commit message for a subject: the workspace's `git.commitMessage` (plus `suffix`, for example ` (1/3)`) and
 * `Editlet-Source: admin` in GitHub mode; the default template in local mode (the dev API writes files, no git commit).
 */
export function useCommitMessage(): (subject: CommitSubject, suffix?: string, note?: string) => string {
  const workspace = useWorkspace();
  return useCallback(
    (subject: CommitSubject, suffix = '', note = '') => {
      const headline = formatCommitMessage(workspace?.style ?? resolveGitStyle(null), subject) + suffix;
      // The editor's note (*Your changes* › Note) is the body, GitHub mode only: dev mode writes files, no commit.
      return workspace ? withTrailer(headline, 'admin', note) : headline;
    },
    [workspace],
  );
}

/** `<site origin>/?<param>=branch:<name>`: the admin runs on the site's own origin. */
export function branchReviewUrl(workspace: Workspace, branch: string): string | null {
  try {
    return `${window.location.origin}/?${workspace.param}=branch:${routeFromBranch(branch, workspace.prefix)}`;
  } catch {
    return null;
  }
}

/** The Editlet part of the pull request body for these changed CMS files. */
export function pullRequestBodyFor(
  workspace: Workspace,
  branch: string,
  schema: Schema | null,
  files: Pick<BranchDiffFile, 'path' | 'status'>[],
  login: string,
): string {
  return pullRequestBlock({
    login,
    changes: describeChanges(schema, files),
    reviewUrl: branchReviewUrl(workspace, branch),
  });
}

/**
 * After a commit on a branch whose open pull request is known (the branch listing), rewrites the Editlet part of its
 * body from a fresh compare. Best effort: a failure leaves the body as it was, and the next save tries again.
 */
export async function refreshPullRequestBody(
  queryClient: QueryClient,
  workspace: Workspace,
  source: GitHubSource,
  schema: Schema | null,
  login: string,
): Promise<void> {
  const listed = queryClient.getQueryData<CmsBranch[]>(BRANCHES_KEY);
  if (!listed?.find((b) => b.name === source.branch)?.pullRequest) return;
  try {
    const diff = await source.compare();
    await source.refreshPullRequestBody(pullRequestBodyFor(workspace, source.branch, schema, diff.files, login));
  } catch {
    // Not part of the save: the commit already landed.
  }
}

/** `refreshPullRequestBody` for the active branch, or a no-op outside GitHub mode and on the base branch. */
export function useRefreshPullRequestBody(): (source: unknown, schema: Schema | null) => void {
  const workspace = useWorkspace();
  const user = useGitHubUser();
  const queryClient = useQueryClient();
  return useCallback(
    (source: unknown, schema: Schema | null) => {
      if (!workspace || !user) return;
      const target = source as GitHubSource;
      if (target.kind !== 'github' || target.branch === workspace.base) return;
      void refreshPullRequestBody(queryClient, workspace, target, schema, user.login);
    },
    [workspace, user, queryClient],
  );
}

const CODEOWNERS_STALE_MS = 5 * 60_000;

/** The `CODEOWNERS` rules of the base branch (as GitHub reads them); `[]` without a file; `null` while loading or failed. */
export function useCodeowners(): CodeownersRule[] | null {
  const workspace = useWorkspace();
  const query = useQuery({
    queryKey: ['codeowners', workspace?.config.owner, workspace?.config.repo, workspace?.base],
    queryFn: async () => {
      const { owner, repo } = workspace!.config;
      const found = await readCodeowners(workspace!.client, owner, repo, workspace!.base);
      return found ? parseCodeowners(found.text) : [];
    },
    enabled: workspace !== null,
    staleTime: CODEOWNERS_STALE_MS,
    retry: false,
  });
  return query.data ?? null;
}

/** "Needs approval from @acme/editors" for these paths; `null` without owners (or while `CODEOWNERS` loads). */
export function approvalText(paths: string[], rules: CodeownersRule[] | null): string | null {
  const owners = rules ? ownersOfAll(rules, paths) : [];
  return owners.length === 0 ? null : `Needs approval from ${owners.join(', ')}`;
}

/** "Needs approval from @acme/editors on GitHub." for these paths, as a hint line; nothing without owners. */
export function ApprovalNote({ paths, rules }: { paths: string[]; rules: CodeownersRule[] | null }) {
  const text = approvalText(paths, rules);
  if (!text) return null;
  return (
    <p className="m-0 px-1 text-sm text-tray-muted-foreground" data-testid="approval-note">
      {text} on GitHub.
    </p>
  );
}

/**
 * Where a save goes, for *Your changes*: *main · new branch* on the base branch, else the active branch and its open
 * pull request (*editlet/spring · PR #2*); nothing in dev mode.
 */
export function useSaveTo(): string | undefined {
  const workspace = useWorkspace();
  const branches = useBranches();
  if (!workspace) return undefined;
  if (workspace.onBase) return `${workspace.base} · new branch`;
  const pr = branches.data?.find((b) => b.name === workspace.active)?.pullRequest;
  return pr ? `${workspace.active} · PR #${pr.number}` : workspace.active;
}
