import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { fileDiff, type FileDiff } from './branchDiff';
import { branchFromRoute, routeFromBranch } from './branchName';
import { DeployStatus, useDeployment } from './DeployStatus';
import { errorText } from './errors';
import { ApprovalNote, pullRequestBodyFor, useCodeowners } from './style';
import { useGitHubUser } from './user';
import { BRANCHES_KEY, useWorkspace, type Workspace } from './workspace';

import { decodeUtf8 } from '../../../core/entryFile';
import { formatPullRequestTitle, isEditletBranchName } from '../../../core/gitStyle';
import { EditletError } from '../../../core/issues';
import { parseSchemaText, type Schema } from '../../../core/schema';
import {
  GitHubError,
  type BranchDiff,
  type BranchDiffOtherFile,
  type CodeownersRule,
  type GitHubSource,
  type PullRequestInfo,
} from '../../../github';
import { DEFAULT_SCHEMA_PATH, findSchemaRef, useSchema } from '../data/queries';
import { DiffHunk } from '../diff/DiffHunk';
import { FieldDiffList } from '../diff/ReviewDialog';
import { PageTop } from '../screens/PageTop';
import { Placeholder } from '../screens/Placeholder';
import { filesKey } from '../source/context';
import { Button, StatusBadge } from '../ui';
import { Icon } from '../ui/Icon';
import { useBridge } from '../useRoute';

type Loaded = { diff: BranchDiff; files: FileDiff[]; schema: Schema };

const STATUS_LABEL: Record<BranchDiffOtherFile['status'], string> = {
  added: 'Added',
  modified: 'Modified',
  removed: 'Removed',
  renamed: 'Renamed',
};

const BINARY_VERB: Record<FileDiff['status'], string> = { added: 'added', modified: 'changed', removed: 'removed' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

/** Who reviews the open pull request, as GitHub reports it. Nothing while loading, on an error or with no reviews. */
function Reviewers({ src, pullRequest }: { src: GitHubSource; pullRequest: PullRequestInfo }) {
  const review = useQuery({
    queryKey: ['pull-request-review', src.branch, pullRequest.number],
    queryFn: () => src.pullRequestReview(pullRequest.number),
    retry: false,
  });
  if (pullRequest.isDraft) {
    return (
      <p className="editlet-u-text-sm editlet-u-text-muted">
        Code owners are asked to review when the pull request is ready for review.
      </p>
    );
  }
  const r = review.data;
  if (!r) return null;
  const parts: string[] = [];
  if (r.approvedBy.length > 0) parts.push(`Approved by ${r.approvedBy.map((l) => `@${l}`).join(', ')}`);
  if (r.changesRequestedBy.length > 0) {
    parts.push(`Changes requested by ${r.changesRequestedBy.map((l) => `@${l}`).join(', ')}`);
  }
  if (r.requested.length > 0) parts.push(`Waiting for ${r.requested.join(', ')}`);
  if (parts.length === 0 && r.decision === 'REVIEW_REQUIRED') parts.push('Review required');
  if (parts.length === 0) return null;
  return (
    <p className="editlet-u-text-sm" data-testid="reviewers">
      {parts.join(' · ')}
    </p>
  );
}

/** The open pull request: its link (and Draft), its reviewers, and who merges it. The admin never merges. */
function PullRequestBlock({ src, pullRequest }: { src: GitHubSource; pullRequest: PullRequestInfo }) {
  return (
    <div className="editlet-u-stack editlet-u-gap-1">
      <div className="editlet-u-row editlet-u-gap-2">
        <a className="editlet-link editlet-branch-screen__pr" href={pullRequest.url} target="_blank" rel="noreferrer">
          Pull request #{pullRequest.number}
        </a>
        <StatusBadge draft={pullRequest.isDraft} size="sm" />
      </div>
      <Reviewers src={src} pullRequest={pullRequest} />
      <p className="editlet-u-text-sm editlet-u-text-muted">A developer merges it on GitHub.</p>
    </div>
  );
}

function FileStatus({ status }: { status: BranchDiffOtherFile['status'] }) {
  return <span className={`editlet-file-status editlet-file-status--${status}`}>{STATUS_LABEL[status]}</span>;
}

function FileChange({ file }: { file: FileDiff }) {
  let body;
  if (file.kind === 'entry') {
    body =
      file.rows.length === 0 ? (
        <p className="editlet-u-text-muted editlet-u-text-sm">No field changes</p>
      ) : (
        <div className="editlet-u-stack editlet-u-gap-3">
          <FieldDiffList rows={file.rows} />
        </div>
      );
  } else if (file.kind === 'text') {
    body = <DiffHunk before={file.before} after={file.after} showLineNumbers />;
  } else {
    body = (
      <p className="editlet-u-text-muted editlet-u-text-sm">
        {file.image ? 'Image' : 'Binary file'} {BINARY_VERB[file.status]}
      </p>
    );
  }
  return (
    <section className="editlet-branch-file" aria-label={file.path}>
      <div className="editlet-branch-file__header">
        <code className="editlet-branch-file__path">{file.path}</code>
        <FileStatus status={file.status} />
      </div>
      <div className="editlet-branch-file__body">{body}</div>
    </section>
  );
}

function Preview({
  src,
  branch,
  headOid,
  prefix,
  param,
}: {
  src: GitHubSource;
  branch: string;
  headOid: string;
  prefix: string;
  param: string;
}) {
  const deployment = useDeployment(src, branch, headOid);
  return (
    <DeployStatus
      deployment={deployment.data}
      expectSha={headOid}
      previewRoute={`branch:${routeFromBranch(branch, prefix)}`}
      param={param}
    />
  );
}

/** Before the pull request exists: whose approval `CODEOWNERS` will ask for. */
function ExpectedReviewers({ diff, rules }: { diff: BranchDiff; rules: CodeownersRule[] | null }) {
  const paths = [...diff.files.map((f) => f.path), ...diff.otherFiles.map((f) => f.path)];
  return <ApprovalNote paths={paths} rules={rules} />;
}

/** Changed paths outside the CMS. Open for admins; collapsed with a count for editors (the code is not theirs). */
function OtherFiles({ diff, collapsed }: { diff: BranchDiff; collapsed: boolean }) {
  if (diff.otherFiles.length === 0 && diff.complete) return null;
  const title = 'Other files this merge brings in';
  const list = (
    <>
      <p className="editlet-u-text-sm editlet-u-text-muted">Merging the pull request brings these in too.</p>
      {diff.complete ? null : (
        <p className="editlet-u-text-sm editlet-u-text-muted">GitHub listed only the first 300 files.</p>
      )}
      <ul className="editlet-branch-screen__other" aria-label="Other files">
        {diff.otherFiles.map((f) => (
          <li key={f.path} className="editlet-branch-screen__other-item">
            <code className="editlet-branch-file__path">{f.path}</code>
            <FileStatus status={f.status} />
          </li>
        ))}
      </ul>
    </>
  );
  if (collapsed) {
    return (
      <details className="editlet-u-stack editlet-u-gap-2 editlet-branch-screen__other-details">
        <summary className="editlet-branch-screen__heading">
          {title} ({diff.otherFiles.length})
        </summary>
        {list}
      </details>
    );
  }
  return (
    <section className="editlet-u-stack editlet-u-gap-2" aria-labelledby="editlet-branch-other">
      <h2 id="editlet-branch-other" className="editlet-branch-screen__heading">
        {title}
      </h2>
      {list}
    </section>
  );
}

/**
 * Changed files or commits ahead. Not only `aheadBy`: right after a commit GitHub's REST compare can still report
 * `identical` / `ahead_by: 0` while `files` (from the fresh snapshot) already lists the change.
 */
function hasChanges(diff: BranchDiff): boolean {
  return diff.files.length > 0 || diff.otherFiles.length > 0 || diff.aheadBy > 0;
}

function statusLines(diff: BranchDiff, base: string): string[] {
  const lines: string[] = [];
  if (diff.status === 'behind' || diff.status === 'diverged') {
    lines.push(`${base} has ${plural(diff.behindBy, 'newer commit')}.`);
  }
  if (!hasChanges(diff)) lines.push('No changes on this branch yet.');
  return lines;
}

function BranchReview({ workspace, branch }: { workspace: Workspace; branch: string }) {
  const queryClient = useQueryClient();
  const { canLeave } = useBridge();
  const src = workspace.sourceFor(branch);
  const repo = `${workspace.config.owner}/${workspace.config.repo}`;
  const [busy, setBusy] = useState<'create' | 'edit' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [labelNotice, setLabelNotice] = useState<string | null>(null);
  const user = useGitHubUser();
  const codeowners = useCodeowners();

  const schemaPath = useSchema().data?.schemaPath ?? DEFAULT_SCHEMA_PATH;
  const loaded = useQuery({ queryKey: ['branch-diff', branch], queryFn: () => loadBranch(src, schemaPath) });
  const pullRequest = useQuery({ queryKey: ['pull-request', branch], queryFn: () => src.pullRequest() });

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

  const editHere = () => {
    if (!canLeave()) return;
    void run('edit', () => activateKeepingScreen(workspace, queryClient, branch));
  };

  const title = <PageTop title={branch} />;
  const data = loaded.data;
  // Also with cached data: a refetch that finds the branch gone (merged or deleted on GitHub) replaces the review.
  const gone = loaded.error instanceof GitHubError && loaded.error.code === 'not_found';
  if (!data || gone) {
    return (
      <section className="editlet-screen editlet-branch-screen">
        {title}
        {loaded.error ? (
          <div className="editlet-card editlet-card--banner editlet-card--banner-danger" role="alert">
            <Icon.Alert />
            <span className="editlet-u-flex-1">
              {gone
                ? `Branch ${branch} doesn't exist. It may have been merged or deleted.`
                : errorText(loaded.error, { repo })}
            </span>
          </div>
        ) : (
          <p className="editlet-u-text-muted" role="status">
            Loading…
          </p>
        )}
      </section>
    );
  }

  const { diff, files } = data;
  const pr = pullRequest.data;
  return (
    <section className="editlet-screen editlet-branch-screen">
      <PageTop title={branch}>
        {workspace.active === branch ? null : (
          <Button variant="outline" size="sm" icon={<Icon.GitBranch />} disabled={busy !== null} onClick={editHere}>
            Edit on this branch
          </Button>
        )}
      </PageTop>

      {loaded.error ? (
        <div className="editlet-card editlet-card--banner editlet-card--banner-danger" role="alert">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{errorText(loaded.error, { repo })}</span>
        </div>
      ) : null}
      {pullRequest.error ? (
        <p className="editlet-u-text-sm editlet-u-text-danger">{errorText(pullRequest.error, { repo })}</p>
      ) : null}

      <Preview src={src} branch={branch} headOid={diff.headOid} prefix={workspace.prefix} param={workspace.param} />

      {pr ? (
        <PullRequestBlock src={src} pullRequest={pr} />
      ) : pr === null ? (
        <div className="editlet-u-stack editlet-u-gap-1">
          <div className="editlet-u-row editlet-u-gap-2">
            <Button
              variant="primary"
              disabled={!hasChanges(diff) || busy !== null}
              onClick={() => void createPullRequest(data)}
            >
              {busy === 'create' ? 'Creating…' : 'Create pull request'}
            </Button>
          </div>
          <ExpectedReviewers diff={diff} rules={codeowners} />
        </div>
      ) : null}
      {labelNotice ? <p className="editlet-u-text-sm editlet-u-text-muted">{labelNotice}</p> : null}
      {actionError ? (
        <div className="editlet-card editlet-card--banner editlet-card--banner-danger" role="alert">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{actionError}</span>
        </div>
      ) : null}

      {statusLines(diff, workspace.base).map((line) => (
        <p key={line} className="editlet-u-text-sm editlet-u-text-muted">
          {line}
        </p>
      ))}

      <section className="editlet-u-stack editlet-u-gap-3" aria-labelledby="editlet-branch-changes">
        <h2 id="editlet-branch-changes" className="editlet-branch-screen__heading">
          Changes
        </h2>
        {files.length === 0 ? (
          <p className="editlet-u-text-sm editlet-u-text-muted">No content files changed.</p>
        ) : null}
        {files.map((file) => (
          <FileChange key={file.path} file={file} />
        ))}
      </section>

      <OtherFiles diff={diff} collapsed={user?.role === 'editor'} />
    </section>
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
    return <Placeholder title="Not a CMS branch" text={`${branch} is not a branch the CMS edits.`} />;
  }
  return <BranchReview key={branch} workspace={workspace} branch={branch} />;
}
