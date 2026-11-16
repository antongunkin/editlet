import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

import type { CommitSubject } from '../../../core/gitStyle';
import { GitHubError } from '../../../github';
import { invalidateFiles, IssuesError, useSchema } from '../data/queries';
import { errorText } from '../github/errors';
import { NewBranchField, useNewBranch } from '../github/NewBranchField';
import { useCommitMessage, useRefreshPullRequestBody } from '../github/style';
import { BRANCHES_KEY, useWorkspace } from '../github/workspace';
import { useSiteRefresh } from '../preview/PreviewProvider';
import { useSource } from '../source/context';
import type { SourceChange } from '../source/local';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui';

export type MediaCommitPlan = {
  /** What the dialog calls the change (its title when there is no `confirm`). */
  message: string;
  /** Fills `git.commitMessage`; a series gets ` (1/3)`, ` (2/3)`… after the headline. */
  subject: CommitSubject;
  /**
   * The commits to make, in order, built when the editor confirms (so a delete checks fresh data). New files come
   * first; entry rewrites and deletes go with or after them, so an entry never points at a file not written yet.
   */
  build(): Promise<SourceChange[][]> | SourceChange[][];
  /** Ask first: always for a delete. GitHub mode on the base branch always asks (for the new branch name). */
  confirm?: { title: string; description: ReactNode; label: string; destructive?: boolean };
  onDone?(): void;
};

export type MediaCommit = {
  request(plan: MediaCommitPlan): void;
  busy: boolean;
  error: string | null;
  clearError(): void;
  /** The confirm dialog; render it once. */
  dialog: ReactNode;
};

const isBranchTaken = (error: unknown) => error instanceof GitHubError && error.code === 'branch_exists';

/**
 * Commits the Media screen's changes through the source: in local mode at once, in GitHub mode to the active Editlet
 * branch, or to a new one (asked for in the dialog) while the base branch is active. Refreshes the files and the page.
 */
export function useMediaCommit(): MediaCommit {
  const source = useSource();
  const workspace = useWorkspace();
  const client = useQueryClient();
  const refreshSite = useSiteRefresh();
  const newBranch = useNewBranch('media', 'index', true);
  const commitMessage = useCommitMessage();
  const refreshPullRequest = useRefreshPullRequestBody();
  const schema = useSchema().data?.schema ?? null;
  const [asking, setAsking] = useState<MediaCommitPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const describe = (e: unknown) => {
    if (e instanceof IssuesError) return e.message;
    if (workspace) return errorText(e, { repo: `${workspace.config.owner}/${workspace.config.repo}` });
    return e instanceof Error ? e.message : String(e);
  };

  const execute = async (plan: MediaCommitPlan) => {
    if (newBranch.needed && newBranch.branch === undefined) return;
    setBusy(true);
    setError(null);
    let done = 0;
    let total = 0;
    try {
      const batches = (await plan.build()).filter((b) => b.length > 0);
      total = batches.length;
      const target = newBranch.branch ? await workspace!.createBranch(newBranch.branch, { keepScreen: true }) : source;
      for (const [i, batch] of batches.entries()) {
        const message = commitMessage(plan.subject, total > 1 ? ` (${i + 1}/${total})` : '');
        const { issues } = await target.commit(batch, message);
        if (issues.length > 0) throw new IssuesError(issues);
        done++;
      }
      setAsking(null);
      refreshPullRequest(target, schema);
      plan.onDone?.();
      void refreshSite();
    } catch (e) {
      if (isBranchTaken(e)) {
        void client.invalidateQueries({ queryKey: BRANCHES_KEY });
        return;
      }
      setAsking(null);
      setError(done > 0 ? `${done} of ${total} commits went through. ${describe(e)}` : describe(e));
    } finally {
      setBusy(false);
      void invalidateFiles(client);
    }
  };

  const request = (plan: MediaCommitPlan) => {
    setError(null);
    if (plan.confirm || newBranch.needed) setAsking(plan);
    else void execute(plan);
  };

  const confirm = asking?.confirm;
  const dialog = (
    <Dialog open={asking !== null} onOpenChange={(open) => !open && !busy && setAsking(null)}>
      <DialogContent role={confirm?.destructive ? 'alertdialog' : 'dialog'}>
        <DialogHeader>
          <DialogTitle>{confirm?.title ?? asking?.message}</DialogTitle>
          <DialogDescription>{confirm?.description ?? 'The change is committed to a new branch.'}</DialogDescription>
        </DialogHeader>
        <NewBranchField {...newBranch} />
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setAsking(null)}>
            Cancel
          </Button>
          <Button
            variant={confirm?.destructive ? 'destructive' : 'primary'}
            disabled={busy || (newBranch.needed && newBranch.branch === undefined)}
            onClick={() => asking && void execute(asking)}
          >
            {(confirm?.label ?? 'Commit') + (newBranch.needed ? ' on branch' : '')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { request, busy, error, clearError: () => setError(null), dialog };
}
