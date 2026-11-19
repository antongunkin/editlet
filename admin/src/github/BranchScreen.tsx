import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { fileDiff, type FileDiff } from './branchDiff';
import { branchFromRoute, routeFromBranch } from './branchName';
import { BranchUnavailable, BranchView, ChangesSheet, OtherFilesSection, OtherFilesSheet } from './BranchView';
import { PreviewStep, useDeployment } from './DeployStatus';
import { errorText } from './errors';
import { approvalText, pullRequestBodyFor, useCodeowners } from './style';
import { useGitHubUser } from './user';
import { BRANCHES_KEY, useWorkspace, type Workspace } from './workspace';

import { decodeUtf8 } from '../../../core/entryFile';
import { formatPullRequestTitle, isEditletBranchName } from '../../../core/gitStyle';
import { EditletError } from '../../../core/issues';
import { parseSchemaText, type Schema } from '../../../core/schema';
import {
  GitHubError,
  type BranchDiff,
  type CodeownersRule,
  type GitHubSource,
  type PullRequestInfo,
  type PullRequestReview,
} from '../../../github';
import { DEFAULT_SCHEMA_PATH, findSchemaRef, useSchema } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { filesKey } from '../source/context';
import { cn } from '../ui/cn';
import { ActionSheet } from '../ui/parts/action-sheet';
import { ActionRow, Row, StepRow, type StepKind } from '../ui/parts/rows';
import { Badge } from '../ui/primitives/badge';
import { Banner } from '../ui/primitives/banner';
import { Button, buttonVariants } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { useBridge } from '../useRoute';
import { useScreenChrome } from '../window/chrome';

type Loaded = { diff: BranchDiff; files: FileDiff[]; schema: Schema };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The branch's own schema, its compare against the base, and every changed CMS file read on both sides. `schemaPath`
 * (the schema file the shell reads) names the file in the issue when the branch has no schema.
 */
export async function loadBranch(src: GitHubSource, schemaPath: string): Promise<Loaded> {
  const ref = findSchemaRef(await src.listFiles());
  if (!ref) throw new EditletError([{ file: schemaPath, path: '', message: 'No schema.json found' }]);
  const decoded = decodeUtf8(await src.readFile(ref.path), ref.path);
  if ('issue' in decoded) throw new EditletError([decoded.issue]);
  const schema = parseSchemaText(decoded.text, ref.path);
  const diff = await src.compare();
  const files = await Promise.all(
    diff.files.map(async (f) => {
      const [before, after] = await Promise.all([
        f.baseSha === null ? null : src.readBlob(f.baseSha),
        f.sha === null ? null : src.readBlob(f.sha),
      ]);
      return fileDiff(schema, f.path, f.status, before, after);
    }),
  );
  return { diff, files, schema };
}

/** Loads `branch`'s file list first (so the shell keeps the review open), then makes it active without a remount. */
async function activateKeepingScreen(workspace: Workspace, queryClient: QueryClient, branch: string) {
  const target = workspace.sourceFor(branch);
  await queryClient.prefetchQuery({ queryKey: filesKey(target), queryFn: () => target.listFiles() });
  workspace.switchTo(branch, { keepScreen: true });
}

/**
 * Changed files or commits ahead. Not only `aheadBy`: right after a commit GitHub's REST compare can still report
 * `identical` / `ahead_by: 0` while `files` (from the fresh snapshot) already lists the change.
 */
function hasChanges(diff: BranchDiff): boolean {
  return diff.files.length > 0 || diff.otherFiles.length > 0 || diff.aheadBy > 0;
}

/** *1 entry · 1 image*: the changed CMS files by kind. */
function filesText(files: FileDiff[]): string {
  const entries = files.filter((f) => f.kind === 'entry').length;
  const others = files.length - entries;
  const parts = [entries > 0 ? plural(entries, 'entry', 'entries') : null, others > 0 ? plural(others, 'file') : null];
  return parts.filter(Boolean).join(' · ') || 'No content files';
}

/** *1 file · 1 field*: the Changes row's line. */
function changesText(files: FileDiff[]): string {
  const fields = files.reduce((n, f) => n + (f.kind === 'entry' ? f.rows.length : 0), 0);
  return [plural(files.length, 'file'), ...(fields > 0 ? [plural(fields, 'field')] : [])].join(' · ');
}

/** *Saved*: the commits on the branch, or that there are none yet. */
function savedStep(diff: BranchDiff, files: FileDiff[]): { kind: StepKind; sub: string } {
  if (!hasChanges(diff)) return { kind: 'todo', sub: 'No changes on this branch yet' };
  const commits = diff.aheadBy > 0 ? `, ${plural(diff.aheadBy, 'commit')}` : '';
  return { kind: 'done', sub: `${filesText(files)}${commits}` };
}

/**
 * *Review*: before the pull request, whose approval `CODEOWNERS` will ask for; a draft asks nobody yet; an open one says
 * who approved, who asked for changes and who is still to review, as GitHub reports it.
 */
function reviewStep(
  pullRequest: PullRequestInfo | null | undefined,
  review: PullRequestReview | null | undefined,
  expected: string | null,
): { kind: StepKind; sub: string } {
  if (!pullRequest) return { kind: 'todo', sub: expected ?? 'Asked for with the pull request' };
  if (pullRequest.isDraft) {
    return { kind: 'current', sub: 'Code owners are asked to review when the pull request is ready for review' };
  }
  if (!review) return { kind: 'current', sub: 'Waiting for reviews' };
  const parts: string[] = [];
  if (review.approvedBy.length > 0) parts.push(`Approved by ${review.approvedBy.map((l) => `@${l}`).join(', ')}`);
  if (review.changesRequestedBy.length > 0) {
    parts.push(`Changes requested by ${review.changesRequestedBy.map((l) => `@${l}`).join(', ')}`);
  }
  if (review.requested.length > 0) parts.push(`Waiting for ${review.requested.join(', ')}`);
  if (parts.length === 0 && review.decision === 'REVIEW_REQUIRED') parts.push('Review required');
  const approved =
    review.decision === 'APPROVED' ||
    (review.approvedBy.length > 0 && review.changesRequestedBy.length === 0 && review.requested.length === 0);
  return { kind: approved ? 'done' : 'current', sub: parts.join(' · ') || 'Waiting for reviews' };
}

/** Reviewers of the open (not draft) pull request; nothing while loading or on an error. */
function useReview(src: GitHubSource, pullRequest: PullRequestInfo | null | undefined) {
  return useQuery({
    queryKey: ['pull-request-review', src.branch, pullRequest?.number],
    queryFn: () => src.pullRequestReview(pullRequest!.number),
    enabled: Boolean(pullRequest && !pullRequest.isDraft),
    retry: false,
  }).data;
}

/** Every path of the merge, for the code owners. */
const pathsOf = (diff: BranchDiff) => [...diff.files.map((f) => f.path), ...diff.otherFiles.map((f) => f.path)];

function expectedReviewers(diff: BranchDiff, rules: CodeownersRule[] | null): string | null {
  return approvalText(pathsOf(diff), rules);
}

const backLink = (
  <RouteLink
    to={{ kind: 'home' }}
    className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
    aria-label="Back"
    title="Back to Home"
  >
    <Icon name="chevron-left" size={20} />
  </RouteLink>
);

function BranchReview({ workspace, branch }: { workspace: Workspace; branch: string }) {
  const queryClient = useQueryClient();
  const { canLeave } = useBridge();
  const chrome = useScreenChrome();
  const src = workspace.sourceFor(branch);
  const repo = `${workspace.config.owner}/${workspace.config.repo}`;
  const [busy, setBusy] = useState<'create' | 'edit' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'more' | 'other' | 'changes' | null>(null);
  const user = useGitHubUser();
  const codeowners = useCodeowners();

  const schemaPath = useSchema().data?.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const loaded = useQuery({ queryKey: ['branch-diff', branch], queryFn: () => loadBranch(src, schemaPath) });
  const pullRequest = useQuery({ queryKey: ['pull-request', branch], queryFn: () => src.pullRequest() });
  const pr = pullRequest.data;
  const review = useReview(src, pr);
  // Also with cached data: a refetch that finds the branch gone (merged or deleted on GitHub) replaces the review.
  const gone = loaded.error instanceof GitHubError && loaded.error.code === 'not_found';
  // Only for a branch that loaded and exists: a dead branch or a failed load would poll every 10 s for nothing.
  const deployment = useDeployment(src, branch, loaded.data?.diff.headOid ?? '', loaded.isSuccess && !gone);

  const run = async (kind: 'create' | 'edit', action: () => Promise<void>) => {
    setBusy(kind);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(errorText(error, { repo }));
    } finally {
      setBusy(null);
    }
  };

  const createPullRequest = (data: Loaded) =>
    run('create', async () => {
      const login = user?.login ?? '';
      const { style } = workspace;
      const opened = await src.openPullRequest({
        title: formatPullRequestTitle(style, { branch, login }),
        body: pullRequestBodyFor(workspace, branch, data.schema, data.diff.files, login),
        draft: style.pullRequest.draft,
        labels: style.pullRequest.labels,
      });
      setLabelNotice(opened.labelError ? `Labels weren't added: ${opened.labelError}` : null);
      queryClient.setQueryData(['pull-request', branch], opened);
      void queryClient.invalidateQueries({ queryKey: ['pull-request', branch] });
      void queryClient.invalidateQueries({ queryKey: BRANCHES_KEY });
    });

  // *Edit on this branch* makes this the active branch, and the screen loses its ⋯: the focus goes to the big title.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const focusTitle = useRef(false);
  const active = workspace.active === branch;
  useEffect(() => {
    if (active && focusTitle.current) {
      focusTitle.current = false;
      titleRef.current?.focus();
    }
  }, [active]);
  const editHere = () => {
    setSheet(null);
    if (!canLeave()) return;
    focusTitle.current = true;
    void run('edit', async () => {
      try {
        await activateKeepingScreen(workspace, queryClient, branch);
      } catch (error) {
        focusTitle.current = false;
        throw error;
      }
    });
  };

  const data = loaded.data;
  if (gone) {
    const backToBase = () => {
      if (!workspace.onBase && workspace.active === branch && canLeave()) workspace.switchTo(workspace.base);
    };
    return (
      <BranchView
        branch={branch}
        back={backLink}
        actions={chrome.windowActions}
        title="Branch not found"
        banners={
          <>
            {chrome.banners}
            <Banner tone="danger" role="alert">
              {`Branch ${branch} doesn't exist. It may have been merged or deleted.`}
            </Banner>
          </>
        }
        status={chrome.status}
        cta={
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- RouteLink renders an <a href>; Enter follows it
          <RouteLink
            to={{ kind: 'home' }}
            onClick={backToBase}
            className={buttonVariants({ variant: 'primary', size: 'lg', full: true })}
          >
            Back to {workspace.base}
          </RouteLink>
        }
      />
    );
  }
  if (!data) {
    return (
      <BranchView
        branch={branch}
        back={backLink}
        actions={chrome.windowActions}
        title="Review changes"
        banners={
          <>
            {chrome.banners}
            {loaded.error ? (
              <Banner tone="danger" role="alert">
                {errorText(loaded.error, { repo })}
              </Banner>
            ) : null}
          </>
        }
        steps={
          loaded.error ? undefined : (
            <>
              {['Saved', 'Preview', 'Review'].map((step) => (
                <li key={step}>
                  <Row title={step} loading disabled chevron={false} />
                </li>
              ))}
            </>
          )
        }
        status={chrome.status}
      />
    );
  }

  const { diff, files } = data;
  const saved = savedStep(diff, files);
  const reviewed = reviewStep(pr, review, expectedReviewers(diff, codeowners));
  const behind =
    diff.status === 'behind' || diff.status === 'diverged'
      ? ` · ${workspace.base} has ${plural(diff.behindBy, 'newer commit')}`
      : '';
  const others = diff.otherFiles.length;
  const editable = workspace.active !== branch;
  const hasOther = others > 0 || !diff.complete;
  // An Admin sees the code a merge brings in open on the screen; an Editor gets a row with the count (roles.md).
  const otherOpen = hasOther && user?.role === 'admin';

  const cta: ReactNode = pr ? (
    <a
      href={pr.url}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ variant: 'primary', size: 'lg', full: true })}
    >
      Open pull request
      <Icon name="arrow-up-right" size={20} />
    </a>
  ) : pr === null ? (
    <Button
      variant="primary"
      size="lg"
      full
      loading={busy === 'create'}
      busyLabel="Creating…"
      disabled={!hasChanges(diff) || busy !== null}
      onClick={() => void createPullRequest(data)}
    >
      Create pull request
    </Button>
  ) : null;

  return (
    <BranchView
      branch={branch}
      back={backLink}
      actions={
        <>
          {editable ? (
            <IconButton
              label="More actions"
              aria-haspopup="dialog"
              onClick={() => setSheet('more')}
              icon={<Icon name="more" size={20} />}
            />
          ) : null}
          {chrome.windowActions}
        </>
      }
      title={pr ? `Pull request #${pr.number}` : 'Review changes'}
      titleProps={{ ref: titleRef, tabIndex: -1 }}
      meta={
        <>
          {pr?.isDraft ? <Badge tone="neutral">Draft</Badge> : null}
          {filesText(files)}
        </>
      }
      banners={
        <>
          {chrome.banners}
          {loaded.error ? (
            <Banner tone="danger" role="alert">
              {errorText(loaded.error, { repo })}
            </Banner>
          ) : null}
          {pullRequest.error ? (
            <Banner tone="danger" role="alert">
              {errorText(pullRequest.error, { repo })}
            </Banner>
          ) : null}
          {actionError ? (
            <Banner tone="danger" role="alert">
              {actionError}
            </Banner>
          ) : null}
          {labelNotice ? <Banner tone="unsaved">{labelNotice}</Banner> : null}
        </>
      }
      steps={
        <>
          <li>
            <StepRow title="Saved" sub={saved.sub} kind={saved.kind} />
          </li>
          <li>
            <PreviewStep
              deployment={deployment.data}
              expectSha={diff.headOid}
              previewRoute={`branch:${routeFromBranch(branch, workspace.prefix)}`}
              param={workspace.param}
            />
          </li>
          <li>
            <StepRow title="Review" sub={reviewed.sub} kind={pr === undefined ? 'todo' : reviewed.kind} />
          </li>
          <li>
            <StepRow
              title="Live"
              sub={`A developer merges it into ${workspace.base} on GitHub${behind}`}
              kind={pr && reviewed.kind !== 'done' ? 'todo' : 'current'}
            />
          </li>
        </>
      }
      rows={
        <>
          {hasOther && !otherOpen ? (
            <Row
              lead="file"
              title="Other files this merge brings in"
              sub={diff.complete ? plural(others, 'file') : `${others}+ files`}
              aria-haspopup="dialog"
              onClick={() => setSheet('other')}
            />
          ) : null}
          <Row
            lead="file"
            title="Changes"
            sub={changesText(files)}
            aria-haspopup="dialog"
            onClick={() => setSheet('changes')}
          />
        </>
      }
      after={otherOpen ? <OtherFilesSection files={diff.otherFiles} complete={diff.complete} /> : undefined}
      status={chrome.status}
      cta={cta}
    >
      {editable ? (
        <ActionSheet open={sheet === 'more'} onOpenChange={(open) => setSheet(open ? 'more' : null)} title={branch}>
          <ActionRow icon="branch" disabled={busy !== null} onClick={editHere}>
            Edit on this branch
          </ActionRow>
        </ActionSheet>
      ) : null}
      <OtherFilesSheet
        open={sheet === 'other'}
        onOpenChange={(open) => setSheet(open ? 'other' : null)}
        files={diff.otherFiles}
        complete={diff.complete}
      />
      <ChangesSheet
        open={sheet === 'changes'}
        onOpenChange={(open) => setSheet(open ? 'changes' : null)}
        sub={changesText(files)}
        files={files}
      />
    </BranchView>
  );
}

/**
 * `?editlet=branch:<x>`: review `<prefix><x>` against the base branch, its preview, and its pull request (created here; a
 * developer merges it on GitHub). GitHub mode only.
 */
export function BranchScreen({ name }: { name: string }) {
  const workspace = useWorkspace();
  const prefix = workspace?.prefix ?? '';
  const branch = branchFromRoute(name, prefix);
  if (!workspace || !isEditletBranchName(branch, prefix) || branch === workspace.base) {
    return <BranchUnavailableScreen title="Not a CMS branch" text={`${branch} is not a branch the CMS edits.`} />;
  }
  return <BranchReview key={branch} workspace={workspace} branch={branch} />;
}

/** A branch route the admin cannot show, with the window's chrome (dev mode, a name outside the prefix). */
export function BranchUnavailableScreen({ title, text }: { title: string; text: string }) {
  const chrome = useScreenChrome();
  return (
    <BranchUnavailable
      title={title}
      text={text}
      actions={chrome.windowActions}
      banners={chrome.banners}
      status={chrome.status}
    />
  );
}
