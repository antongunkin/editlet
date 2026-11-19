import { encodeRef, GitHubError } from './client.ts';
import { assertDeployHookUrl, triggerDeployHook, type DeployHookResult } from './deploy.ts';
import type { GitHubSource, Snapshot, SourceContext } from './source.ts';

import { isEditletBranchName, mergePullRequestBody } from '../core/gitStyle.ts';

export interface PullRequestInfo {
  number: number;
  url: string;
  title: string;
  isDraft: boolean;
  headOid: string;
}

/** A pull request that `openPullRequest` returns: `labelError` when it was opened but the labels were not added. */
export type OpenedPullRequest = PullRequestInfo & { labelError?: string };

/** Review state of an open pull request, as GitHub reports it. */
export interface PullRequestReview {
  /** `null` when the base branch does not require reviews. */
  decision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** Requested reviewers: `@login` or `@org/team`. */
  requested: string[];
  /** Logins whose latest review approves. */
  approvedBy: string[];
  /** Logins whose latest review asks for changes. */
  changesRequestedBy: string[];
}

export interface CmsBranch {
  /** Full name, `<prefix><x>`. */
  name: string;
  headOid: string;
  committedAt: string | null;
  /** The open pull request into the base branch, if any. */
  pullRequest: PullRequestInfo | null;
}

export interface BranchDiffFile {
  path: string;
  status: 'added' | 'modified' | 'removed';
  /** Blob sha on the branch (`null` = removed). */
  sha: string | null;
  /** Blob sha at the merge base (`null` = added). */
  baseSha: string | null;
}

export interface BranchDiffOtherFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
}

export interface BranchDiff {
  status: 'ahead' | 'behind' | 'diverged' | 'identical';
  aheadBy: number;
  behindBy: number;
  mergeBaseOid: string;
  headOid: string;
  /** Changed CMS files (schema + non-hidden `contentDir` files), from the snapshots at the merge base and the head. */
  files: BranchDiffFile[];
  /**
   * Other changed paths that a merge would also bring in (outside the schema and `contentDir`, or hidden under it),
   * from GitHub's compare. Shown, never blocking.
   */
  otherFiles: BranchDiffOtherFile[];
  /** `false` when GitHub's compare listed 300 or more files: `otherFiles` may then be incomplete. */
  complete: boolean;
}

export interface PublishOptions {
  /** Title when a pull request has to be opened. Default `Publish <branch>`. */
  title?: string;
  /**
   * The head the editor reviewed (`compare().headOid`). When the pull request head differs, publish is `stale` and
   * changes nothing (it neither marks the pull request ready nor merges).
   */
  headOid: string;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  /** Default true. */
  deleteBranch?: boolean;
  deployHookUrl?: string;
}

export type PublishResult =
  | {
      status: 'merged';
      pullRequest: PullRequestInfo;
      mergeOid: string;
      branchDeleted: boolean;
      deployHook?: DeployHookResult;
    }
  | {
      status: 'blocked';
      reason: 'protected' | 'behind' | 'conflict' | 'stale' | 'pending';
      pullRequest: PullRequestInfo;
      message?: string;
    };

export interface DeploymentInfo {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  state: 'error' | 'failure' | 'inactive' | 'in_progress' | 'queued' | 'pending' | 'success' | 'waiting';
  url: string | null;
  logUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The branch, pull request, compare, publish and deployment methods of `GitHubSource`. */
export type RepoOps = Pick<
  GitHubSource,
  | 'listBranches'
  | 'createBranch'
  | 'renameBranch'
  | 'deleteBranch'
  | 'pullRequest'
  | 'openPullRequest'
  | 'refreshPullRequestBody'
  | 'pullRequestReview'
  | 'compare'
  | 'compareFiles'
  | 'publish'
  | 'latestDeployment'
>;

/** What `makeRepoOps` needs from the source it extends. Passed in so this module does not import `source.ts` values. */
export interface RepoOpsDeps {
  ctx: SourceContext;
  branch: string;
  baseBranch(): Promise<string>;
  branchPrefix(): Promise<string>;
  withBranch(branch: string): GitHubSource;
  repoQuery<T>(query: string, variables: Record<string, unknown>): Promise<T>;
  loadSnapshot(branch: string): Promise<Snapshot>;
  loadSnapshotAt(oid: string): Promise<Snapshot>;
}

function assertEditletBranch(name: string, prefix: string): void {
  if (!isEditletBranchName(name, prefix)) {
    throw new GitHubError('invalid_branch', `Branch names must look like ${prefix}<name>: "${name}"`);
  }
}

/** The prefix is inlined (a schema-checked ref path, so it cannot break the string). */
const branchesQuery = (
  prefix: string,
) => `query Branches($owner: String!, $name: String!, $base: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/${prefix}", first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target { oid ... on Commit { committedDate } }
        associatedPullRequests(first: 1, states: [OPEN], baseRefName: $base) {
          nodes { number url title isDraft headRefOid }
        }
      }
    }
  }
}`;

interface BranchesPage {
  refs: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      name: string;
      target: { oid: string; committedDate?: string | null };
      associatedPullRequests: {
        nodes: { number: number; url: string; title: string; isDraft: boolean; headRefOid: string }[];
      };
    }[];
  };
}

interface RestPull {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  draft?: boolean;
  head: { ref: string; sha: string };
}

const toPullRequest = (p: RestPull): PullRequestInfo => ({
  number: p.number,
  url: p.html_url,
  title: p.title,
  isDraft: p.draft === true,
  headOid: p.head.sha,
});

const PULL_STATE_QUERY = `query PullState($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { id isDraft mergeable mergeStateStatus headRefOid }
  }
}`;

const REVIEW_QUERY = `query PullReview($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewDecision
      reviewRequests(first: 20) {
        nodes { requestedReviewer { ... on User { login } ... on Team { slug organization { login } } } }
      }
      latestOpinionatedReviews(first: 20) { nodes { state author { login } } }
    }
  }
}`;

interface ReviewNode {
  reviewDecision: PullRequestReview['decision'];
  reviewRequests: {
    nodes: { requestedReviewer: { login?: string; slug?: string; organization?: { login: string } } | null }[];
  };
  latestOpinionatedReviews: { nodes: { state: string; author: { login: string } | null }[] };
}

const READY_MUTATION = `mutation Ready($id: ID!) {
  markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } }
}`;

interface PullState {
  id: string;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  headRefOid: string;
}

/**
 * The only merge states in which the library merges. GitHub lets an admin token merge through the API even when
 * branch protection blocks it, so the gate lives here. `viewerCanMergeAsAdmin` is never consulted.
 */
const MERGEABLE_STATES = new Set(['CLEAN', 'HAS_HOOKS', 'UNSTABLE']);
const MAX_UNKNOWN_POLLS = 5;

interface RestDeployment {
  id: number;
  sha: string;
  ref: string;
  environment: string;
  created_at: string;
  updated_at: string;
}

interface RestDeploymentStatus {
  state: DeploymentInfo['state'];
  environment_url?: string | null;
  log_url?: string | null;
}

const is422 = (e: unknown): e is GitHubError => e instanceof GitHubError && e.status === 422;
/** GitHub caps the compare file list; at this length it may be incomplete. */
const COMPARE_FILES_CAP = 300;

interface RestCompareFile {
  filename: string;
  /** A rename's old path. */
  previous_filename?: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
}

function otherFileStatus(status: RestCompareFile['status']): BranchDiffOtherFile['status'] | null {
  if (status === 'unchanged') return null;
  if (status === 'copied' || status === 'changed') return 'modified';
  return status;
}

export function makeRepoOps(deps: RepoOpsDeps): RepoOps {
  const { ctx, branch } = deps;
  const repoPath = `/repos/${ctx.owner}/${ctx.repo}`;

  /** The base branch, or `null` when it cannot be determined (broken schema); used by the safety refusals. */
  async function tolerantBase(): Promise<string | null> {
    try {
      return await deps.baseBranch();
    } catch (error) {
      if (error instanceof GitHubError && error.code === 'not_found') return null;
      throw error;
    }
  }

  async function findPull(base: string): Promise<RestPull | null> {
    const list = await ctx.client.rest<RestPull[]>('GET', `${repoPath}/pulls`, {
      query: { head: `${ctx.owner}:${branch}`, base, state: 'open' },
      fresh: true,
    });
    return list[0] ?? null;
  }

  async function findPullRequest(base: string): Promise<PullRequestInfo | null> {
    const found = await findPull(base);
    return found ? toPullRequest(found) : null;
  }

  const assertBranch = async (name: string) => assertEditletBranch(name, await deps.branchPrefix());

  async function pullState(number: number): Promise<PullState> {
    const repo = await deps.repoQuery<{ pullRequest: PullState | null }>(PULL_STATE_QUERY, { number });
    if (!repo.pullRequest) throw new GitHubError('not_found', `Pull request not found: #${number}`);
    return repo.pullRequest;
  }

  async function publish(options: PublishOptions): Promise<PublishResult> {
    // before any side effect
    if (options.deployHookUrl !== undefined) assertDeployHookUrl(options.deployHookUrl);
    await assertBranch(branch);
    const pullRequest = await ops.openPullRequest({ title: options.title ?? `Publish ${branch}` });
    const blocked = (
      reason: Extract<PublishResult, { status: 'blocked' }>['reason'],
      message?: string,
    ): PublishResult =>
      message === undefined
        ? { status: 'blocked', reason, pullRequest }
        : { status: 'blocked', reason, pullRequest, message };

    let state = await pullState(pullRequest.number);
    // a stale publish must not even mark the pull request ready
    if (options.headOid !== state.headRefOid) return blocked('stale');
    if (state.isDraft) {
      await ctx.client.graphql(READY_MUTATION, { id: state.id });
      state = await pullState(pullRequest.number);
    }
    for (let attempt = 1; state.mergeStateStatus === 'UNKNOWN' && attempt <= MAX_UNKNOWN_POLLS; attempt++) {
      await ctx.client.sleep(1000 * attempt);
      state = await pullState(pullRequest.number);
    }
    if (state.mergeStateStatus === 'UNKNOWN') return blocked('pending');
    if (options.headOid !== state.headRefOid) return blocked('stale'); // moved while waiting
    if (!MERGEABLE_STATES.has(state.mergeStateStatus)) {
      if (state.mergeStateStatus === 'BEHIND') return blocked('behind');
      if (state.mergeStateStatus === 'DIRTY') return blocked('conflict');
      return blocked('protected'); // BLOCKED, DRAFT and anything GitHub adds later
    }

    let mergeOid: string;
    try {
      const merged = await ctx.client.rest<{ sha: string }>('PUT', `${repoPath}/pulls/${pullRequest.number}/merge`, {
        body: { merge_method: options.mergeMethod ?? 'merge', sha: state.headRefOid },
      });
      mergeOid = merged.sha;
    } catch (error) {
      if (error instanceof GitHubError && error.status === 405) return blocked('protected', error.message);
      if (error instanceof GitHubError && error.status === 409) return blocked('stale', error.message);
      throw error;
    }

    let branchDeleted = false;
    if (options.deleteBranch !== false) {
      try {
        branchDeleted = await ops.deleteBranch();
      } catch {
        branchDeleted = false;
      }
    }
    const result: PublishResult = { status: 'merged', pullRequest, mergeOid, branchDeleted };
    if (options.deployHookUrl !== undefined) result.deployHook = await triggerDeployHook(options.deployHookUrl);
    return result;
  }

  async function latestDeployment(ref: string = branch): Promise<DeploymentInfo | null> {
    const head = await ctx.client.rest<{ object: { sha: string } }>(
      'GET',
      `${repoPath}/git/ref/heads/${encodeRef(ref)}`,
      { fresh: true },
    );
    const list = (query: Record<string, string>) =>
      ctx.client.rest<RestDeployment[]>('GET', `${repoPath}/deployments`, {
        query: { ...query, per_page: 10 },
        fresh: true,
      });
    let found = await list({ sha: head.object.sha });
    if (found.length === 0) found = await list({ ref });
    const deployment = found[0];
    if (!deployment) return null;
    const statuses = await ctx.client.rest<RestDeploymentStatus[]>(
      'GET',
      `${repoPath}/deployments/${deployment.id}/statuses`,
      { query: { per_page: 1 }, fresh: true },
    );
    const status = statuses[0];
    return {
      id: deployment.id,
      sha: deployment.sha,
      ref: deployment.ref,
      environment: deployment.environment,
      state: status?.state ?? 'pending',
      url: status?.environment_url || null,
      logUrl: status?.log_url || null,
      createdAt: deployment.created_at,
      updatedAt: deployment.updated_at,
    };
  }

  const ops: RepoOps = {
    publish,
    latestDeployment,
    async listBranches() {
      const [base, prefix] = await Promise.all([deps.baseBranch(), deps.branchPrefix()]);
      const query = branchesQuery(prefix);
      const out: CmsBranch[] = [];
      let after: string | null = null;
      for (;;) {
        const repo: BranchesPage = await deps.repoQuery<BranchesPage>(query, { base, after });
        for (const node of repo.refs.nodes) {
          const pr = node.associatedPullRequests.nodes[0];
          out.push({
            name: `${prefix}${node.name}`,
            headOid: node.target.oid,
            committedAt: node.target.committedDate ?? null,
            pullRequest: pr
              ? { number: pr.number, url: pr.url, title: pr.title, isDraft: pr.isDraft, headOid: pr.headRefOid }
              : null,
          });
        }
        if (!repo.refs.pageInfo.hasNextPage) return out;
        after = repo.refs.pageInfo.endCursor;
      }
    },

    async createBranch(name) {
      await assertBranch(name);
      const base = await deps.baseBranch();
      if (name === base) throw new GitHubError('invalid_branch', `"${name}" is the base branch`);
      const ref = await ctx.client.rest<{ object: { sha: string } }>(
        'GET',
        `${repoPath}/git/ref/heads/${encodeRef(base)}`,
        { fresh: true },
      );
      try {
        await ctx.client.rest('POST', `${repoPath}/git/refs`, {
          body: { ref: `refs/heads/${name}`, sha: ref.object.sha },
        });
      } catch (error) {
        if (is422(error) && /already exists/i.test(error.message)) {
          throw new GitHubError('branch_exists', `Branch already exists: ${name}`, { status: 422 });
        }
        throw error;
      }
      return deps.withBranch(name);
    },

    async renameBranch(name) {
      await assertBranch(branch);
      await assertBranch(name);
      if (name === (await tolerantBase())) throw new GitHubError('invalid_branch', `"${name}" is the base branch`);
      try {
        await ctx.client.rest('POST', `${repoPath}/branches/${encodeRef(branch)}/rename`, {
          body: { new_name: name },
        });
      } catch (error) {
        if (is422(error) && /already exists/i.test(error.message)) {
          throw new GitHubError('branch_exists', `Branch already exists: ${name}`, { status: 422 });
        }
        throw error;
      }
      return deps.withBranch(name);
    },

    async deleteBranch() {
      await assertBranch(branch);
      if (branch === (await tolerantBase())) throw new GitHubError('invalid_branch', `"${branch}" is the base branch`);
      try {
        await ctx.client.rest('DELETE', `${repoPath}/git/refs/heads/${encodeRef(branch)}`);
        return true;
      } catch (error) {
        if (error instanceof GitHubError && error.code === 'not_found') return false;
        if (is422(error) && /does not exist/i.test(error.message)) return false;
        throw error;
      }
    },

    async pullRequest() {
      return findPullRequest(await deps.baseBranch());
    },

    async openPullRequest({ title, body, draft, labels }) {
      await assertBranch(branch);
      const base = await deps.baseBranch();
      const existing = await findPullRequest(base);
      if (existing) return existing;
      let created: PullRequestInfo;
      try {
        const pull = await ctx.client.rest<RestPull>('POST', `${repoPath}/pulls`, {
          body: {
            title,
            head: branch,
            base,
            ...(body === undefined ? {} : { body }),
            ...(draft ? { draft: true } : {}),
          },
        });
        created = toPullRequest(pull);
      } catch (error) {
        if (!is422(error)) throw error;
        if (/already exists/i.test(error.message)) {
          const raced = await findPullRequest(base);
          if (raced) return raced;
        } else if (/no commits between/i.test(error.message)) {
          throw new GitHubError('no_changes', `No changes between ${base} and ${branch}`, { status: 422 });
        }
        throw error;
      }
      if (!labels || labels.length === 0) return created;
      try {
        await ctx.client.rest('POST', `${repoPath}/issues/${created.number}/labels`, { body: { labels } });
        return created;
      } catch (error) {
        // The pull request is open; a missing label or permission must not turn that into a failure.
        return { ...created, labelError: error instanceof Error ? error.message : String(error) };
      }
    },

    async refreshPullRequestBody(block) {
      const found = await findPull(await deps.baseBranch());
      if (!found) return 'none';
      const next = mergePullRequestBody(found.body ?? null, block);
      if (next === null || next === (found.body ?? '')) return 'unchanged';
      await ctx.client.rest('PATCH', `${repoPath}/pulls/${found.number}`, { body: { body: next } });
      return 'updated';
    },

    async pullRequestReview(number) {
      const repo = await deps.repoQuery<{ pullRequest: ReviewNode | null }>(REVIEW_QUERY, { number });
      const pr = repo.pullRequest;
      if (!pr) return null;
      const requested = pr.reviewRequests.nodes.flatMap(({ requestedReviewer: r }) => {
        if (r?.login) return [`@${r.login}`];
        if (r?.slug && r.organization) return [`@${r.organization.login}/${r.slug}`];
        return [];
      });
      const by = (state: string) =>
        pr.latestOpinionatedReviews.nodes.flatMap((n) => (n.state === state && n.author ? [n.author.login] : []));
      return {
        decision: pr.reviewDecision,
        requested,
        approvedBy: by('APPROVED'),
        changesRequestedBy: by('CHANGES_REQUESTED'),
      };
    },

    async compare() {
      const base = await deps.baseBranch();
      const cmp = await ctx.client.rest<{
        status: BranchDiff['status'];
        ahead_by: number;
        behind_by: number;
        merge_base_commit: { sha: string };
        files?: RestCompareFile[];
      }>('GET', `${repoPath}/compare/${encodeRef(base)}...${encodeRef(branch)}`, {
        query: { per_page: 1 },
        fresh: true,
      });
      const mergeBaseOid = cmp.merge_base_commit.sha;
      const [head, baseSnap] = await Promise.all([deps.loadSnapshot(branch), deps.loadSnapshotAt(mergeBaseOid)]);

      const files: BranchDiffFile[] = [];
      for (const path of new Set([...head.files.keys(), ...baseSnap.files.keys()])) {
        const sha = visibleSha(head, path);
        const baseSha = visibleSha(baseSnap, path);
        if (sha === baseSha) continue;
        files.push({ path, status: baseSha === null ? 'added' : sha === null ? 'removed' : 'modified', sha, baseSha });
      }
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      const cmsPaths = new Set(files.map((f) => f.path));
      const otherFiles: BranchDiffOtherFile[] = [];
      for (const f of cmp.files ?? []) {
        const status = otherFileStatus(f.status);
        if (status !== null && !cmsPaths.has(f.filename)) otherFiles.push({ path: f.filename, status });
      }
      otherFiles.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return {
        status: cmp.status,
        aheadBy: cmp.ahead_by,
        behindBy: cmp.behind_by,
        mergeBaseOid,
        headOid: head.headOid,
        files,
        otherFiles,
        complete: (cmp.files ?? []).length < COMPARE_FILES_CAP,
      };
    },

    async compareFiles(name) {
      const base = await deps.baseBranch();
      const cmp = await ctx.client.rest<{ files?: RestCompareFile[] }>(
        'GET',
        `${repoPath}/compare/${encodeRef(base)}...${encodeRef(name)}`,
        { query: { per_page: 1 }, fresh: true },
      );
      const files = cmp.files ?? [];
      const paths = new Set<string>();
      for (const f of files) {
        if (f.status === 'unchanged') continue;
        paths.add(f.filename);
        // A rename also takes the old path away from the base branch.
        if (f.status === 'renamed' && f.previous_filename) paths.add(f.previous_filename);
      }
      return { paths: [...paths].toSorted(), complete: files.length < COMPARE_FILES_CAP };
    },
  };
  return ops;
}

/** A path below `contentDir` with a dot segment (same rule as `core/paths.ts`). */
function hidden(snap: Snapshot, path: string): boolean {
  const prefix = `${snap.contentDir}/`;
  const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path;
  return rest.split('/').some((seg) => seg.startsWith('.'));
}

/** The blob sha of a CMS file in `snap`, or `null` when absent or hidden. */
function visibleSha(snap: Snapshot, path: string): string | null {
  const sha = snap.files.get(path);
  if (sha === undefined) return null;
  if (path === snap.schemaPath) return sha;
  return snap.schema === null || hidden(snap, path) ? null : sha;
}
