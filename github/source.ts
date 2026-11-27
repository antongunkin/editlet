import { toBase64 } from './base64.ts';
import { openGitHubCache, whenIdle, type BlobKind, type GitHubCache, type PendingQueue } from './cache.ts';
import {
  createGitHubClient,
  encodeRef,
  GitHubError,
  type ConditionalResponse,
  type GitHubClient,
  type GitHubClientOptions,
} from './client.ts';
import {
  makeRepoOps,
  type BranchDiff,
  type CmsBranch,
  type DeploymentInfo,
  type OpenedPullRequest,
  type PublishOptions,
  type PublishResult,
  type PullRequestInfo,
  type PullRequestReview,
} from './repo.ts';

import { AuthError } from '../auth/client.ts';
import { decodeUtf8, parseEntryFile } from '../core/entryFile.ts';
import { resolveGitStyle } from '../core/gitStyle.ts';
import { EditletError, type Issue } from '../core/issues.ts';
import { isHiddenContentPath, isImagePath, parseEntryPath } from '../core/paths.ts';
import { parseSchemaText, type Schema } from '../core/schema.ts';
import { gitBlobSha } from '../core/sha.ts';
import {
  versionLimit,
  type ContentSource,
  type FileChange,
  type FileEvent,
  type FileHistory,
  type FileRef,
  type FileVersion,
} from '../core/source.ts';
import { deleteSuspects, summarizeEntry, summaryFingerprint, type EntrySummary } from '../core/summary.ts';
import { validateCommit } from '../core/writes.ts';

export interface GitHubSourceOptions {
  owner: string;
  repo: string;
  branch: string;
  /** Exactly one of `token` or `client`. */
  token?: GitHubClientOptions['token'];
  /** Share one client (and its rate limits) across sources. */
  client?: GitHubClient;
  /** Default: `schema.git.baseBranch` on `branch`. */
  baseBranch?: string;
  /** Default: `schema.git.branchPrefix` on `branch`, else `editlet/`. */
  branchPrefix?: string;
  /** Default `cms/schema.json`. */
  schemaPath?: string;
  /** Default `openGitHubCache()`. */
  cache?: GitHubCache;
}

/**
 * A change plus the blob sha it is based on (`null` = the file must not exist). Default: the sha this source last
 * served for the path (`readFile` / `readFiles`, or its own last commit), else the source's snapshot.
 */
export type GitHubFileChange = FileChange & { sha?: string | null };

export interface ReadFilesOptions {
  /**
   * `false`: a blob this call has to fetch is not written to the blob cache. A blob already cached is still read from
   * it. For a caller that keeps what it made of the bytes (the admin's summaries). Default `true`.
   */
  keep?: boolean;
}

export interface GitHubSource extends ContentSource {
  readonly kind: 'github';
  readonly owner: string;
  readonly repo: string;
  readonly branch: string;
  /** Unsaved edits for this repo + branch (scope `owner/repo#branch` of `cache`). */
  readonly pending: PendingQueue;
  /** The blob and pending cache, shared by every source of this client (other scopes, `persistent`). */
  readonly cache: GitHubCache;
  /** Refreshes the snapshot (head oid + tree). Non-hidden `contentDir` files plus the schema file, sorted by path. */
  listFiles(): Promise<FileRef[]>;
  /** From the current snapshot (loaded if none). A missing path rejects with an `EditletError`. */
  readFile(path: string): Promise<Uint8Array>;
  /** Batched; in input order. Any missing path rejects with an `EditletError` listing all of them. */
  readFiles(paths: string[], options?: ReadFilesOptions): Promise<Map<string, Uint8Array>>;
  /** Any blob by sha (e.g. the base side of a diff). */
  readBlob(sha: string): Promise<Uint8Array>;
  /** Head commit oid of the current snapshot (loaded if none). */
  head(): Promise<string>;
  /**
   * One atomic `createCommitOnBranch` on this (`<prefix>*`) branch. A path whose sha on GitHub is neither its expected
   * sha nor the sha of the new content is a conflict issue; nothing is written then. The expected sha is
   * `change.sha` when given, else the sha this source last served for the path (read or committed), else the
   * snapshot's (so `listFiles` between a read and a save never hides a foreign edit). Concurrent commits to other
   * paths are retried (3 attempts). Changes already on GitHub are skipped; `commit` is absent when nothing was left.
   */
  commit(
    changes: GitHubFileChange[],
    message: string,
  ): Promise<{ issues: Issue[]; commit?: { oid: string; url: string } }>;
  /** The commits of this branch that touched `path`: newest, oldest and the count (all `null` / 0 for a new file). */
  history(path: string): Promise<FileHistory>;
  /**
   * The last commit that touched each path (`history().updated` for many paths), as of the current snapshot's head
   * (loaded if none): one query per `LAST_COMMIT_BATCH` paths not in the cache. `null` when no commit is found, or when
   * GitHub timed out even for that path alone (not cached). A path not in the snapshot rejects like `readFiles`.
   */
  lastCommits(paths: string[]): Promise<Map<string, FileEvent | null>>;
  /** The commits of this branch that touched `path`, newest first, each with the file's blob sha (one GraphQL call). */
  listVersions(path: string, limit?: number): Promise<FileVersion[]>;
  /** The file as `commit` left it (blob cache first); `EditletError` when it is not a file there. */
  readVersion(path: string, commit: string): Promise<Uint8Array>;
  baseBranch(): Promise<string>;
  /** The branch prefix: the option, else `git.branchPrefix` of the schema on this branch, else `editlet/`. */
  branchPrefix(): Promise<string>;
  /** Same client, cache and options; its own snapshot. */
  withBranch(branch: string): GitHubSource;
  /** `refs/heads/<prefix>*`, each with its open pull request into the base branch. */
  listBranches(): Promise<CmsBranch[]>;
  /** A new `<prefix><x>` branch from the head of the base branch; `branch_exists` when taken. Returns its source. */
  createBranch(name: string): Promise<GitHubSource>;
  /** Renames this branch (both names must have the prefix); returns the source for the new name. The queue stays. */
  renameBranch(name: string): Promise<GitHubSource>;
  /**
   * Deletes this branch; `false` when it is already gone. Only prefixed branches, never the base. Does not clear the
   * pending queue.
   */
  deleteBranch(): Promise<boolean>;
  /** The open pull request from this branch into the base branch. */
  pullRequest(): Promise<PullRequestInfo | null>;
  /**
   * Finds the open pull request or creates one (only from a prefixed branch, else `invalid_branch`); `no_changes` when
   * the branch has no commits over the base. A new one gets `draft` and then `labels`; when adding the labels fails,
   * the pull request is still returned, with `labelError`. A found one is returned as it is.
   */
  openPullRequest(options: {
    title: string;
    body?: string;
    draft?: boolean;
    labels?: string[];
  }): Promise<OpenedPullRequest>;
  /**
   * Replaces the Editlet part (between the markers) of the open pull request's body with `block`: `none` without a
   * pull request, `unchanged` when nothing changed or the markers are gone, else `updated` (one `PATCH`).
   */
  refreshPullRequestBody(block: string): Promise<'none' | 'unchanged' | 'updated'>;
  /** Review state of pull request `number` (decision, requested reviewers, latest approvals); `null` if not found. */
  pullRequestReview(number: number): Promise<PullRequestReview | null>;
  /**
   * This branch against the base branch: counts, merge base, the changed CMS files (hidden paths excluded) and the
   * other changed paths a merge would bring in (`otherFiles`; `complete: false` when GitHub's list was capped).
   */
  compare(): Promise<BranchDiff>;
  /**
   * The paths `branch` changes against the base branch, from GitHub's three-dot compare alone (one REST call, no tree
   * reads): every path, CMS or not, a rename by both its new and its old name. `complete: false` when GitHub's list was capped (300
   * files). For the admin's *In review* of other branches' pull requests.
   */
  compareFiles(branch: string): Promise<{ paths: string[]; complete: boolean }>;
  /**
   * Only from a prefixed branch (else `invalid_branch`). Opens (or finds) the pull request; when its head is not the
   * reviewed `headOid`, returns `stale` without touching it. Otherwise marks it ready and merges it into the base
   * branch, but only when GitHub reports `CLEAN`, `HAS_HOOKS` or `UNSTABLE` and the head is still `headOid`;
   * otherwise a `blocked` result with the PR url. Never bypasses branch protection. The merge carries the reviewed
   * head `sha`. Then deletes the branch and calls the deploy hook. Does not touch the pending queue.
   */
  publish(options: PublishOptions): Promise<PublishResult>;
  /** The newest GitHub Deployment for the head of `ref` (default: this branch) with its latest status; `null` if none. */
  latestDeployment(ref?: string): Promise<DeploymentInfo | null>;
}

export type { BranchDiff, BranchDiffFile, BranchDiffOtherFile, CmsBranch, PullRequestInfo } from './repo.ts';
export type { OpenedPullRequest, PullRequestReview } from './repo.ts';
export type { DeploymentInfo, PublishOptions, PublishResult } from './repo.ts';

/** One commit's view of the CMS files. Internal; shared by the read, commit and branch-diff paths. */
export interface Snapshot {
  headOid: string;
  schemaPath: string;
  schemaSha: string | null;
  /** `null` when the schema file is missing or invalid. */
  schema: Schema | null;
  contentDir: string | null;
  /** path → blob sha: every blob under `contentDir` (hidden ones included) plus the schema. */
  files: Map<string, string>;
}

/** Resolved, shared configuration for a source and its `withBranch` siblings. Internal. */
export interface SourceContext {
  client: GitHubClient;
  cache: GitHubCache;
  owner: string;
  repo: string;
  schemaPath: string;
  baseBranch?: string;
  branchPrefix?: string;
  /** Blob shas of every tree listed with this context; a source's context keeps them for the page. */
  reachable?: Set<string>;
}

/** An unreachable cached row is dropped once it was last used this long ago. */
const PRUNE_AGE_MS = 30 * 24 * 60 * 60_000;

/** Paths per `LastCommits` query (one rate-limit point; 100 and more risk GitHub's 10 s timeout). */
export const LAST_COMMIT_BATCH = 50;

const BLOB_BATCH = 50;
const RAW_ACCEPT = 'application/vnd.github.raw+json';
const SHA_RE = /^[0-9a-f]{40}$/;
const SYMLINK_MODE = '120000';
const encoder = new TextEncoder();

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

function notFoundIssues(paths: string[]): EditletError {
  return new EditletError(paths.map((p) => ({ file: p, path: '', message: `File not found: ${p}` })));
}

// ---------------------------------------------------------------------------------------------------------------
// Blob reader

interface BlobNode {
  text: string | null;
  isBinary: boolean;
  isTruncated: boolean;
}

function blobsQuery(shas: string[]): string {
  const fields = shas.map((sha, i) => `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`);
  return `query Blobs($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n    ${fields.join('\n    ')}\n  }\n}`;
}

const kindOf = (path: string): BlobKind => (isImagePath(path) ? 'image' : 'entry');

/**
 * Reads blobs by sha: cache first, then batched GraphQL text (accepted only when its git sha matches), then raw REST
 * for binary, truncated or mismatching blobs. Every fetched blob is sha-verified and cached (each GraphQL chunk as it
 * lands), as an image when its sha is in `images`; with `keep: false` none is written to the cache.
 */
export async function readBlobs(
  ctx: SourceContext,
  shas: string[],
  images: ReadonlySet<string> = new Set(),
  { keep = true }: ReadFilesOptions = {},
): Promise<Map<string, Uint8Array>> {
  const unique = [...new Set(shas)];
  for (const sha of unique) {
    if (!SHA_RE.test(sha)) throw new GitHubError('not_found', `Blob not found: ${sha}`);
  }
  const out = await ctx.cache.getBlobs(unique);
  const missing = unique.filter((sha) => !out.has(sha));
  if (missing.length === 0) return out;

  const store = async (blobs: { sha: string; bytes: Uint8Array }[]): Promise<void> => {
    if (keep) await ctx.cache.putBlobs(blobs.map((b) => ({ ...b, kind: images.has(b.sha) ? 'image' : 'entry' })));
  };
  const fetched: { sha: string; bytes: Uint8Array }[] = [];
  const raw: string[] = [];
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += BLOB_BATCH) chunks.push(missing.slice(i, i + BLOB_BATCH));
  // Each chunk is cached as it lands: a chunk that fails does not lose the others (a retry reads only what is left).
  await Promise.all(
    chunks.map(async (chunk) => {
      const data = await ctx.client.graphql<{ repository: Record<string, BlobNode | null> | null }>(blobsQuery(chunk), {
        owner: ctx.owner,
        name: ctx.repo,
      });
      const landed: { sha: string; bytes: Uint8Array }[] = [];
      await Promise.all(
        chunk.map(async (sha, i) => {
          const node = data.repository?.[`b${i}`];
          if (node && !node.isBinary && !node.isTruncated && typeof node.text === 'string') {
            const bytes = encoder.encode(node.text);
            if ((await gitBlobSha(bytes)) === sha) {
              landed.push({ sha, bytes });
              return;
            }
          }
          raw.push(sha);
        }),
      );
      fetched.push(...landed);
      await store(landed);
    }),
  );
  const rawFetched: { sha: string; bytes: Uint8Array }[] = [];
  await Promise.all(
    raw.map(async (sha) => {
      const body = await ctx.client.rest<Uint8Array>('GET', `/repos/${ctx.owner}/${ctx.repo}/git/blobs/${sha}`, {
        raw: true,
        accept: RAW_ACCEPT,
      });
      const bytes = new Uint8Array(body);
      if ((await gitBlobSha(bytes)) !== sha) throw new GitHubError('http_error', 'Blob sha mismatch');
      rawFetched.push({ sha, bytes });
    }),
  );
  await store(rawFetched);
  for (const { sha, bytes } of [...fetched, ...rawFetched]) out.set(sha, bytes);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Snapshot loader

const SNAPSHOT_QUERY = `query Snapshot($owner: String!, $name: String!, $ref: String!, $schemaPath: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target {
        oid
        ... on Commit { schema: file(path: $schemaPath) { oid } }
      }
    }
  }
}`;

const DIR_QUERY = `query Dir($owner: String!, $name: String!, $oid: GitObjectID!, $path: String!) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit { file(path: $path) { oid type } }
    }
  }
}`;

interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}
interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

/** GraphQL wrapper that turns "repository not found" into `GitHubError('not_found')`. */
async function repoQuery<T>(ctx: SourceContext, query: string, variables: Record<string, unknown>): Promise<T> {
  let data: { repository: T | null };
  try {
    data = await ctx.client.graphql<{ repository: T | null }>(query, {
      owner: ctx.owner,
      name: ctx.repo,
      ...variables,
    });
  } catch (error) {
    if (
      error instanceof GitHubError &&
      error.code === 'graphql_error' &&
      error.graphqlErrors?.length &&
      error.graphqlErrors.every((e) => e.type === 'NOT_FOUND')
    ) {
      throw new GitHubError('not_found', `Repository not found: ${ctx.owner}/${ctx.repo}`);
    }
    throw error;
  }
  if (!data.repository) throw new GitHubError('not_found', `Repository not found: ${ctx.owner}/${ctx.repo}`);
  return data.repository;
}

/** `Commit.file(path:)` at a commit oid: the tree entry's oid and type, or null when the path does not exist. */
async function entryAt(ctx: SourceContext, oid: string, path: string): Promise<{ oid: string; type: string } | null> {
  const repo = await repoQuery<{ object: { file?: { oid: string; type: string } | null } | null }>(ctx, DIR_QUERY, {
    oid,
    path,
  });
  if (!repo.object) throw new GitHubError('not_found', `Commit not found: ${oid}`);
  return repo.object.file ?? null;
}

function addBlobs(files: Map<string, string>, dir: string, entries: TreeEntry[]): TreeEntry[] {
  const subtrees: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.type === 'tree') subtrees.push(entry);
    else if (entry.type === 'blob' && entry.mode !== SYMLINK_MODE) files.set(`${dir}/${entry.path}`, entry.sha);
    // submodules (`commit`) and symlinks are not CMS files
  }
  return subtrees;
}

function getTree(ctx: SourceContext, sha: string, recursive: boolean): Promise<TreeResponse> {
  return ctx.client.rest<TreeResponse>('GET', `/repos/${ctx.owner}/${ctx.repo}/git/trees/${sha}`, {
    query: recursive ? { recursive: 1 } : undefined,
  });
}

/** Non-recursive walk, one request per directory (used when a recursive listing comes back truncated). */
async function walkTree(ctx: SourceContext, sha: string, dir: string, files: Map<string, string>): Promise<void> {
  const res = await getTree(ctx, sha, false);
  if (res.truncated) throw new GitHubError('http_error', `Tree listing truncated: ${dir}`);
  const subtrees = addBlobs(files, dir, res.tree);
  await Promise.all(subtrees.map((t) => walkTree(ctx, t.sha, `${dir}/${t.path}`, files)));
}

async function readTreeInto(ctx: SourceContext, sha: string, dir: string, files: Map<string, string>): Promise<void> {
  const res = await getTree(ctx, sha, true);
  const listed = new Map<string, string>();
  if (res.truncated) await walkTree(ctx, sha, dir, listed);
  else addBlobs(listed, dir, res.tree);
  for (const [path, blob] of listed) {
    files.set(path, blob);
    ctx.reachable?.add(blob);
  }
}

/** Builds the snapshot of commit `headOid` given its schema blob sha (null = no schema file). */
export async function buildSnapshot(ctx: SourceContext, headOid: string, schemaSha: string | null): Promise<Snapshot> {
  const files = new Map<string, string>();
  const snapshot: Snapshot = { headOid, schemaPath: ctx.schemaPath, schemaSha, schema: null, contentDir: null, files };
  if (schemaSha === null) return snapshot;
  files.set(ctx.schemaPath, schemaSha);
  ctx.reachable?.add(schemaSha);

  const bytes = (await readBlobs(ctx, [schemaSha])).get(schemaSha)!;
  const decoded = decodeUtf8(bytes, ctx.schemaPath);
  if (!('text' in decoded)) return snapshot;
  try {
    snapshot.schema = parseSchemaText(decoded.text, ctx.schemaPath);
  } catch (error) {
    if (error instanceof EditletError) return snapshot;
    throw error;
  }
  const contentDir = snapshot.schema.contentDir;
  snapshot.contentDir = contentDir;

  const dir = await entryAt(ctx, headOid, contentDir);
  if (dir?.type === 'tree') await readTreeInto(ctx, dir.oid, contentDir, files);
  files.set(ctx.schemaPath, schemaSha); // in case the schema lives under contentDir
  return snapshot;
}

/** The head of `branch` (`refs/heads/<branch>`) and its schema blob sha (`null` = no schema file): one GraphQL call. */
async function readHead(ctx: SourceContext, branch: string): Promise<{ oid: string; schemaSha: string | null }> {
  const repo = await repoQuery<{ ref: { target: { oid: string; schema?: { oid: string } | null } } | null }>(
    ctx,
    SNAPSHOT_QUERY,
    { ref: `refs/heads/${branch}`, schemaPath: ctx.schemaPath },
  );
  if (!repo.ref) throw new GitHubError('not_found', `Branch not found: ${branch}`);
  return { oid: repo.ref.target.oid, schemaSha: repo.ref.target.schema?.oid ?? null };
}

/** Snapshot of the head of `branch` (`refs/heads/<branch>`). */
export async function loadSnapshot(ctx: SourceContext, branch: string): Promise<Snapshot> {
  const head = await readHead(ctx, branch);
  return buildSnapshot(ctx, head.oid, head.schemaSha);
}

/** Snapshot at a commit oid (e.g. a merge base). */
export async function loadSnapshotAt(ctx: SourceContext, oid: string): Promise<Snapshot> {
  const schema = await entryAt(ctx, oid, ctx.schemaPath);
  return buildSnapshot(ctx, oid, schema?.type === 'blob' ? schema.oid : null);
}

// ---------------------------------------------------------------------------------------------------------------
// Commit

/** The largest commit the source sends (the sum of the changed files' bytes); over it a commit is refused. */
export const MAX_COMMIT_BYTES = 20 * 1024 * 1024;
const MAX_COMMIT_ATTEMPTS = 3;

const HISTORY_QUERY = `query History($owner: String!, $name: String!, $ref: String!, $path: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target { ... on Commit { history(first: 1, path: $path) { totalCount nodes {
        url messageHeadline committedDate author { name user { login avatarUrl } }
      } } } }
    }
  }
}`;

const VERSIONS_QUERY = `query Versions($owner: String!, $name: String!, $ref: String!, $path: String!, $first: Int!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: $ref) {
      target { ... on Commit { history(first: $first, path: $path) { nodes {
        oid url messageHeadline committedDate author { name user { login avatarUrl } } file(path: $path) { oid type }
      } } } }
    }
  }
}`;

interface HistoryNode {
  url: string;
  messageHeadline: string;
  committedDate: string;
  author: { name: string | null; user: { login: string; avatarUrl: string } | null } | null;
}

interface RestCommit {
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string; avatar_url: string } | null;
}

function nodeEvent(n: HistoryNode): FileEvent {
  const user = n.author?.user;
  return {
    actor: { name: n.author?.name ?? user?.login ?? 'Unknown', login: user?.login, avatarUrl: user?.avatarUrl },
    date: n.committedDate,
    message: n.messageHeadline,
    url: n.url,
  };
}

interface VersionNode extends HistoryNode {
  oid: string;
  file: { oid: string; type: string } | null;
}

function versionOf(n: VersionNode): FileVersion {
  return { ...nodeEvent(n), commit: n.oid, sha: n.file?.type === 'blob' ? n.file.oid : null };
}

function restEvent(c: RestCommit): FileEvent {
  return {
    actor: {
      name: c.commit.author?.name ?? c.author?.login ?? 'Unknown',
      login: c.author?.login,
      avatarUrl: c.author?.avatar_url,
    },
    date: c.commit.author?.date ?? '',
    message: c.commit.message.split('\n')[0] ?? '',
    url: c.html_url,
  };
}

/** One `history` alias per path; the paths are variables `$p0`…, never part of the query text. */
function lastCommitsQuery(count: number): string {
  const indexes = Array.from({ length: count }, (_, i) => i);
  const params = indexes.map((i) => `$p${i}: String!`).join(', ');
  const fields = indexes.map(
    (i) =>
      `p${i}: history(first: 1, path: $p${i}) { nodes { oid committedDate url messageHeadline author { name user { login avatarUrl } } } }`,
  );
  return `query LastCommits($owner: String!, $name: String!, $oid: GitObjectID!, ${params}) {
  repository(owner: $owner, name: $name) {
    object(oid: $oid) {
      ... on Commit {
        ${fields.join('\n        ')}
      }
    }
  }
}`;
}

/** GitHub gave up on the query as a whole (a gateway error or its own time limit): fewer paths may get through. */
function isQueryTimeout(error: unknown): boolean {
  if (!(error instanceof GitHubError)) return false;
  if (error.code === 'http_error') return error.status === 502 || error.status === 504;
  return (
    error.code === 'graphql_error' &&
    (error.graphqlErrors ?? []).some((e) => /timeout|timed out|respond to your request in time/i.test(e.message))
  );
}

type LastCommitRow = { path: string; event: FileEvent | null };

/**
 * Asks the last commit of `paths` at commit `oid` in one query; on a timeout, in halves down to one path. Every answered
 * query goes to `land`; a path that times out alone is left out.
 */
async function askLastCommits(
  ctx: SourceContext,
  oid: string,
  paths: string[],
  land: (rows: LastCommitRow[]) => Promise<void>,
): Promise<void> {
  let object: Record<string, { nodes: HistoryNode[] } | undefined> | null;
  try {
    const repo = await repoQuery<{ object: typeof object }>(ctx, lastCommitsQuery(paths.length), {
      oid,
      ...Object.fromEntries(paths.map((path, i) => [`p${i}`, path])),
    });
    object = repo.object;
  } catch (error) {
    if (!isQueryTimeout(error)) throw error;
    if (paths.length === 1) return;
    const half = Math.ceil(paths.length / 2);
    await Promise.all([
      askLastCommits(ctx, oid, paths.slice(0, half), land),
      askLastCommits(ctx, oid, paths.slice(half), land),
    ]);
    return;
  }
  if (!object) throw new GitHubError('not_found', `Commit not found: ${oid}`);
  await land(
    paths.map((path, i) => {
      const node = object[`p${i}`]?.nodes[0];
      return { path, event: node ? nodeEvent(node) : null };
    }),
  );
}

const CONFLICT_MESSAGE = 'Changed on GitHub since it was read; reload and review';

const COMMIT_MUTATION = `mutation Commit($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit { oid url }
  }
}`;

/** A change with its bytes and shas resolved once per commit call. */
interface PreparedChange {
  path: string;
  /** A private copy (`null` = delete). */
  bytes: Uint8Array | null;
  /** The sha the change is based on (`null` = the file must not exist). */
  expected: string | null;
  /** The sha of the new content (`null` = delete). */
  next: string | null;
}

async function prepareChange(
  change: GitHubFileChange,
  served: ReadonlyMap<string, string>,
  base: Snapshot,
): Promise<PreparedChange> {
  const { path, content } = change;
  const bytes =
    content === null ? null : typeof content === 'string' ? encoder.encode(content) : new Uint8Array(content);
  return {
    path,
    bytes,
    expected: change.sha !== undefined ? change.sha : (served.get(path) ?? base.files.get(path) ?? null),
    next: bytes === null ? null : await gitBlobSha(bytes),
  };
}

/** First line → `headline`; the rest (trimmed) → `body` when non-empty. */
function commitMessage(message: string): { headline: string; body?: string } {
  const [first = '', ...rest] = message.trim().split(/\r?\n/);
  const body = rest.join('\n').trim();
  return body === '' ? { headline: first.trim() } : { headline: first.trim(), body };
}

const isStale = (error: unknown): boolean =>
  error instanceof GitHubError && (error.graphqlErrors ?? []).some((e) => e.type === 'STALE_DATA');

/** The schema a batch writes, when it parses (else `null`: no schema change, or validation rejects it). */
function batchSchema(schemaPath: string, prepared: PreparedChange[]): Schema | null {
  const bytes = prepared.find((c) => c.path === schemaPath)?.bytes;
  if (!bytes) return null;
  const decoded = decodeUtf8(bytes, schemaPath);
  if (!('text' in decoded)) return null;
  try {
    return parseSchemaText(decoded.text, schemaPath);
  } catch (error) {
    if (error instanceof EditletError) return null;
    throw error;
  }
}

/**
 * `snap` plus every blob under the batch schema's `contentDir` at `snap.headOid` when the batch moves `contentDir`
 * (the snapshot only tracks the old directory), so the conflict check, `exists`, `list` and `read` see the files
 * that are already there and an addition never silently replaces one.
 */
async function withMovedContentDir(ctx: SourceContext, snap: Snapshot, next: Schema | null): Promise<Snapshot> {
  if (next === null || next.contentDir === snap.contentDir) return snap;
  const files = new Map(snap.files);
  const dir = await entryAt(ctx, snap.headOid, next.contentDir);
  if (dir?.type === 'tree') await readTreeInto(ctx, dir.oid, next.contentDir, files);
  return { ...snap, files };
}

/** Every non-hidden `.md` under the `contentDir` of any of `schemas`: what a schema change re-checks. */
function contentMarkdown(snap: Snapshot, schemas: Schema[]): string[] {
  return [...snap.files.keys()].filter(
    (p) => p.endsWith('.md') && schemas.some((s) => p.startsWith(`${s.contentDir}/`) && !isHiddenContentPath(s, p)),
  );
}

/** An entry the re-check reads because the cache has no summary of it. */
interface Unsummarized {
  path: string;
  collection: string;
  sha: string;
  fp: string;
}

/**
 * What a batch that deletes files, and keeps the schema, re-checks (in snapshot order): the entries outside the batch
 * whose kept summary points at a deleted path (`deleteSuspects`), and those with no kept summary. Other `.md` files are
 * left out: they only get an issue when the schema changes. `unsummarized` are those with no kept summary.
 */
async function deleteRecheckPaths(
  ctx: SourceContext,
  snap: Snapshot,
  schema: Schema,
  todo: PreparedChange[],
): Promise<{ paths: string[]; unsummarized: Unsummarized[] }> {
  const changed = new Set(todo.map((c) => c.path));
  const entries = [...snap.files].flatMap(([path, sha]) => {
    const entry = changed.has(path) || isHiddenContentPath(schema, path) ? null : parseEntryPath(schema, path);
    return entry ? [{ ...entry, path, sha }] : [];
  });
  const fingerprints = new Map(
    await Promise.all(
      [...new Set(entries.map((e) => e.collection))].map(
        async (c) => [c, await summaryFingerprint(schema, c)] as const,
      ),
    ),
  );
  const keys = entries.map((e) => ({ ...e, fp: fingerprints.get(e.collection)! }));
  // A cache that fails keeps nothing: every entry is read.
  const kept = await ctx.cache.getSummaries(keys).catch(() => new Map<string, EntrySummary>());
  const rows = keys.flatMap((e) => {
    const summary = kept.get(`${e.sha}:${e.fp}`);
    return summary ? [{ ...e, summary }] : [];
  });
  const deleted = new Set(todo.flatMap((c) => (c.bytes === null ? [c.path] : [])));
  const suspects = deleteSuspects(schema, rows, deleted);
  const unsummarized = keys.filter((e) => !kept.has(`${e.sha}:${e.fp}`));
  const unknown = new Set(unsummarized.map((e) => e.path));
  const paths = keys.filter((e) => suspects.has(e.path) || unknown.has(e.path)).map((e) => e.path);
  return { paths, unsummarized };
}

/**
 * Keeps the summaries of the entries the re-check read for want of one, made as the admin makes them, so the next delete
 * does not read them again. Best effort: it never fails the commit. A file that does not parse gets no summary.
 */
async function keepSummaries(
  ctx: SourceContext,
  schema: Schema,
  entries: Unsummarized[],
  texts: ReadonlyMap<string, string>,
): Promise<void> {
  const rows = entries.flatMap(({ path, collection, sha, fp }) => {
    const text = texts.get(path);
    if (text === undefined) return []; // not UTF-8
    try {
      return [{ sha, fp, summary: summarizeEntry(schema, collection, parseEntryFile(text)) }];
    } catch {
      return [];
    }
  });
  await ctx.cache.putSummaries(rows).catch(() => undefined);
}

/** UTF-8 text of `paths`; a file that is not UTF-8 is left out. */
async function readEntryTexts(
  ctx: SourceContext,
  snap: Snapshot,
  paths: string[],
  options?: ReadFilesOptions,
): Promise<Map<string, string>> {
  const blobs = await readBlobs(
    ctx,
    paths.map((p) => snap.files.get(p)!),
    new Set(),
    options,
  );
  const texts = new Map<string, string>();
  for (const p of paths) {
    const decoded = decodeUtf8(blobs.get(snap.files.get(p)!)!, p);
    if ('text' in decoded) texts.set(p, decoded.text);
  }
  return texts;
}

/** `validateCommit` against `snap`, plus the GitHub-only rules (deleting a missing file, the size cap). */
async function validateOn(
  ctx: SourceContext,
  snap: Snapshot,
  todo: PreparedChange[],
  message: string,
  next: Schema | null,
): Promise<Issue[]> {
  // What `validateChanges` re-checks: every entry for a schema change, only what a delete can break otherwise.
  let list = (): Iterable<string> => snap.files.keys();
  let texts = new Map<string, string>();
  let unsummarized: Unsummarized[] = [];
  if (todo.some((c) => c.path === snap.schemaPath)) {
    const schemas = [snap.schema, next].filter((x): x is Schema => x !== null);
    texts = await readEntryTexts(ctx, snap, contentMarkdown(snap, schemas));
  } else if (snap.schema && todo.some((c) => c.bytes === null)) {
    const recheck = await deleteRecheckPaths(ctx, snap, snap.schema, todo);
    list = () => recheck.paths;
    unsummarized = recheck.unsummarized;
    // `keep: false`: the bytes are not needed again, a summary of them is kept below.
    texts = await readEntryTexts(ctx, snap, recheck.paths, { keep: false });
  }
  const issues = validateCommit(
    {
      schema: snap.schema,
      schemaPath: snap.schemaPath,
      exists: (p) => snap.files.has(p),
      read: (p) => texts.get(p),
      list,
    },
    todo.map((c) => ({ path: c.path, content: c.bytes })),
    message,
  );
  if (snap.schema && unsummarized.length > 0) await keepSummaries(ctx, snap.schema, unsummarized, texts);
  for (const c of todo) {
    if (c.bytes === null && !snap.files.has(c.path)) issues.push({ file: c.path, path: '', message: 'File not found' });
  }
  const size = todo.reduce((sum, c) => sum + (c.bytes?.byteLength ?? 0), 0);
  if (size > MAX_COMMIT_BYTES) issues.push({ path: '', message: 'Changes are too large for one commit (max 20 MB)' });
  return issues;
}

/** `snap` with `todo` applied at `headOid`; `null` when `contentDir` moved (the file set must be reloaded). */
function applyToSnapshot(snap: Snapshot, todo: PreparedChange[], headOid: string): Snapshot | null {
  const files = new Map(snap.files);
  for (const c of todo) {
    if (c.next === null) files.delete(c.path);
    else files.set(c.path, c.next);
  }
  const next: Snapshot = { ...snap, headOid, files };
  const schemaChange = todo.find((c) => c.path === snap.schemaPath);
  if (schemaChange?.bytes) {
    // validateCommit accepted it, so it parses
    const decoded = decodeUtf8(schemaChange.bytes, snap.schemaPath);
    next.schema = 'text' in decoded ? parseSchemaText(decoded.text, snap.schemaPath) : null;
    next.schemaSha = schemaChange.next;
    next.contentDir = next.schema?.contentDir ?? null;
    if (next.contentDir !== snap.contentDir) return null;
  }
  return next;
}

// ---------------------------------------------------------------------------------------------------------------
// Source

export function createGitHubSource(options: GitHubSourceOptions): GitHubSource {
  if ((options.token === undefined) === (options.client === undefined)) {
    throw new TypeError('createGitHubSource: pass exactly one of `token` or `client`');
  }
  const ctx: SourceContext = {
    client: options.client ?? createGitHubClient({ token: options.token! }),
    cache: options.cache ?? openGitHubCache(),
    owner: options.owner,
    repo: options.repo,
    schemaPath: options.schemaPath ?? 'cms/schema.json',
    baseBranch: options.baseBranch,
    branchPrefix: options.branchPrefix,
    reachable: new Set(),
  };
  return makeSource(ctx, options.branch);
}

/** Drops, when the page is idle, cached rows that no tree listed so far has and that are old. Best effort. */
function pruneWhenIdle(ctx: SourceContext): void {
  // `async`, so that a cache that throws at once reaches nobody either.
  const prune = async () => ctx.cache.pruneUnreachable(ctx.reachable!, Date.now() - PRUNE_AGE_MS);
  whenIdle(() => void prune().catch(() => undefined));
}

function makeSource(ctx: SourceContext, branch: string): GitHubSource {
  let snapshot: Snapshot | null = null;
  let loading: Promise<Snapshot> | null = null;
  let generation = 0;
  /** The head the cache was last pruned for: a poll that finds the same one prunes nothing. */
  let prunedHead: string | null = null;
  /** path → blob sha of what this source last handed out (read) or wrote (commit): the default expected sha. */
  const served = new Map<string, string>();
  /** The ETag and the sha of the last `200` of the head ref read; `null` after a commit or a failed read. */
  let headRef: { etag: string; sha: string } | null = null;

  /**
   * Reads the head ref with `If-None-Match` (a `304` costs no rate limit): the snapshot's own head stands. A moved head
   * loads the snapshot again. A ref read that fails (other than an auth or rate-limit error) reads the head through
   * GraphQL instead, so the admin still sees the update.
   */
  async function refresh(prev: Snapshot): Promise<Snapshot> {
    const path = `/repos/${ctx.owner}/${ctx.repo}/git/ref/heads/${encodeRef(branch)}`;
    let answer: ConditionalResponse<{ object?: { sha?: string } }>;
    try {
      answer = await ctx.client.restConditional(path, headRef?.etag ?? null);
    } catch (error) {
      if (error instanceof AuthError || (error instanceof GitHubError && error.code === 'rate_limited')) throw error;
      headRef = null;
      const head = await readHead(ctx, branch);
      return head.oid === prev.headOid ? prev : buildSnapshot(ctx, head.oid, head.schemaSha);
    }
    if (answer.notModified) {
      if (headRef?.sha === prev.headOid) return prev;
      headRef = null; // the ETag and the snapshot disagree: load again, and read a fresh ETag next time
      return loadSnapshot(ctx, branch);
    }
    const sha = answer.body.object?.sha;
    headRef = answer.etag && typeof sha === 'string' ? { etag: answer.etag, sha } : null;
    if (sha === prev.headOid) return prev;
    return loadSnapshot(ctx, branch);
  }

  /**
   * Starts a fresh load; only the latest started load updates `snapshot`. With a snapshot and `conditional`, the head
   * ref is read first (`refresh`); the first load, and a load after a stale commit, read the head in full.
   */
  function reload(conditional = true): Promise<Snapshot> {
    const gen = ++generation;
    const base = snapshot;
    const promise = (conditional && base ? refresh(base) : loadSnapshot(ctx, branch)).then(
      (s) => {
        if (gen === generation) {
          snapshot = s;
          loading = null;
          // Without a listed content tree (no valid schema) nearly everything would look unreachable.
          if (s.contentDir !== null && s.headOid !== prunedHead) {
            prunedHead = s.headOid;
            pruneWhenIdle(ctx);
          }
        }
        return s;
      },
      (error: unknown) => {
        if (gen === generation) loading = null;
        throw error;
      },
    );
    loading = promise;
    return promise;
  }

  /** The current snapshot, loading it when there is none. */
  function current(): Promise<Snapshot> {
    if (snapshot) return Promise.resolve(snapshot);
    return loading ?? reload();
  }

  async function readFiles(paths: string[], options?: ReadFilesOptions): Promise<Map<string, Uint8Array>> {
    const snap = await current();
    const missing = paths.filter((p) => !snap.files.has(p));
    if (missing.length > 0) throw notFoundIssues([...new Set(missing)]);
    const blobs = await readBlobs(
      ctx,
      paths.map((p) => snap.files.get(p)!),
      new Set(paths.filter(isImagePath).map((p) => snap.files.get(p)!)),
      options,
    );
    const out = new Map<string, Uint8Array>();
    for (const p of paths) {
      const sha = snap.files.get(p)!;
      out.set(p, blobs.get(sha)!.slice());
      served.set(p, sha);
    }
    return out;
  }

  async function lastCommits(paths: string[]): Promise<Map<string, FileEvent | null>> {
    const snap = await current(); // every query of this call asks at this head, even if the branch moves meanwhile
    const unique = [...new Set(paths)];
    const missing = unique.filter((p) => !snap.files.has(p));
    if (missing.length > 0) throw notFoundIssues(missing);

    // Cached by blob sha: the last commit of a path stands until its content changes. The scope names the repository,
    // as the pending scope does: two repositories on one origin share the database and the branch name.
    const scope = `${ctx.owner}/${ctx.repo}#${branch}`;
    const keyOf = (path: string) => ({ path, sha: snap.files.get(path)! });
    const found = await ctx.cache.getLastCommits(scope, unique.map(keyOf));
    const misses = unique.filter((p) => !found.has(p));
    const land = async (rows: LastCommitRow[]): Promise<void> => {
      for (const { path, event } of rows) found.set(path, event);
      await ctx.cache.putLastCommits(
        scope,
        rows.map(({ path, event }) => ({ ...keyOf(path), event })),
      );
    };
    const batches: string[][] = [];
    for (let i = 0; i < misses.length; i += LAST_COMMIT_BATCH) batches.push(misses.slice(i, i + LAST_COMMIT_BATCH));
    // All at once: the client keeps the requests in flight under its own limit.
    await Promise.all(batches.map((batch) => askLastCommits(ctx, snap.headOid, batch, land)));
    return new Map(unique.map((p) => [p, found.get(p) ?? null]));
  }

  async function baseBranch(): Promise<string> {
    if (ctx.baseBranch !== undefined) return ctx.baseBranch;
    const base = (await current()).schema?.git.baseBranch;
    if (base === undefined) throw new GitHubError('not_found', 'Base branch unknown: schema missing or invalid');
    return base;
  }

  async function branchPrefix(): Promise<string> {
    if (ctx.branchPrefix !== undefined) return ctx.branchPrefix;
    return resolveGitStyle((await current()).schema?.git).branchPrefix;
  }

  const withBranch = (next: string): GitHubSource => makeSource(ctx, next);

  return {
    kind: 'github',
    owner: ctx.owner,
    repo: ctx.repo,
    branch,
    pending: ctx.cache.pending(`${ctx.owner}/${ctx.repo}#${branch}`),
    cache: ctx.cache,

    async listFiles() {
      const snap = await reload();
      const refs: FileRef[] = [];
      for (const [path, sha] of snap.files) {
        if (path === snap.schemaPath || (snap.schema && !isHiddenContentPath(snap.schema, path))) {
          refs.push({ path, sha });
        }
      }
      return refs.toSorted(byPath);
    },

    async readFile(path) {
      return (await readFiles([path])).get(path)!;
    },

    readFiles,

    async readBlob(sha) {
      return (await readBlobs(ctx, [sha])).get(sha)!.slice();
    },

    async head() {
      return (await current()).headOid;
    },

    async commit(changes, message) {
      const base = await current();
      // A missing or broken schema leaves the default prefix, so the schema can still be fixed on such a branch.
      const prefix = ctx.branchPrefix ?? resolveGitStyle(base.schema?.git).branchPrefix;
      const refused = {
        issues: [{ path: '', message: `Commits must go to a branch named ${prefix}*, not "${branch}"` }],
      };
      if (!branch.startsWith(prefix)) return refused;
      if (branch === (ctx.baseBranch ?? base.schema?.git.baseBranch)) return refused;

      const seen = new Set<string>();
      const duplicates = new Set<string>();
      for (const { path } of changes) (seen.has(path) ? duplicates : seen).add(path);
      if (duplicates.size > 0) {
        return { issues: [...duplicates].map((file) => ({ file, path: '', message: 'Duplicate path in changes' })) };
      }
      const prepared = await Promise.all(changes.map((c) => prepareChange(c, served, base)));
      /** The editor's content is now what GitHub has: later commits are based on it. */
      const markServed = () => {
        for (const c of prepared) {
          if (c.next === null) served.delete(c.path);
          else served.set(c.path, c.next);
        }
      };

      const nextSchema = batchSchema(base.schemaPath, prepared);

      let snap = base;
      for (let attempt = 1; ; attempt++) {
        // what the commit lands on: `snap`, widened to the new contentDir when the batch moves it
        const view = await withMovedContentDir(ctx, snap, nextSchema);
        const conflicts: Issue[] = [];
        const todo: PreparedChange[] = [];
        for (const c of prepared) {
          const now = view.files.get(c.path) ?? null;
          if (c.next !== null && now === c.next) continue; // already applied (or unchanged)
          if (now === c.expected) todo.push(c);
          else if (now !== c.next) conflicts.push({ file: c.path, path: '', message: CONFLICT_MESSAGE });
          // else: deleted already
        }
        if (conflicts.length > 0) return { issues: conflicts };
        if (todo.length === 0) {
          markServed();
          return { issues: [] };
        }

        const issues = await validateOn(ctx, view, todo, message, nextSchema);
        if (issues.length > 0) return { issues };

        const input = {
          branch: { repositoryNameWithOwner: `${ctx.owner}/${ctx.repo}`, branchName: branch },
          expectedHeadOid: snap.headOid,
          message: commitMessage(message),
          fileChanges: {
            additions: todo.flatMap((c) => (c.bytes === null ? [] : [{ path: c.path, contents: toBase64(c.bytes) }])),
            deletions: todo.flatMap((c) => (c.bytes === null ? [{ path: c.path }] : [])),
          },
        };
        let commit: { oid: string; url: string };
        try {
          const data = await ctx.client.graphql<{ createCommitOnBranch: { commit: { oid: string; url: string } } }>(
            COMMIT_MUTATION,
            { input },
          );
          commit = data.createCommitOnBranch.commit;
        } catch (error) {
          if (!isStale(error)) throw error;
          if (attempt >= MAX_COMMIT_ATTEMPTS) {
            return { issues: [{ path: '', message: 'Branch keeps changing; try again' }] };
          }
          snap = await reload(false); // the head moved: read it in full, not by its ETag
          continue;
        }

        ++generation; // an older in-flight reload must not overwrite this
        loading = null;
        snapshot = applyToSnapshot(snap, todo, commit.oid);
        headRef = null; // the ETag named the head before this commit
        const blobs = todo.flatMap((c) =>
          c.bytes === null ? [] : [{ sha: c.next!, bytes: c.bytes, kind: kindOf(c.path) }],
        );
        await ctx.cache.putBlobs(blobs).catch(() => undefined); // best-effort: the commit already landed
        markServed();
        return { issues: [], commit: { oid: commit.oid, url: commit.url } };
      }
    },

    async history(path) {
      const repo = await repoQuery<{
        ref: { target: { history?: { totalCount: number; nodes: HistoryNode[] } } | null } | null;
      }>(ctx, HISTORY_QUERY, { ref: `refs/heads/${branch}`, path });
      const history = repo.ref?.target?.history;
      const [latest] = history?.nodes ?? [];
      if (!history || !latest) return { updated: null, created: null, commits: 0 };
      const total = history.totalCount;
      let created = nodeEvent(latest);
      if (total > 1) {
        // The oldest commit is the last page of a one-per-page listing.
        const query = new URLSearchParams({ sha: branch, path, per_page: '1', page: String(total) });
        const [oldest] = await ctx.client.rest<RestCommit[]>('GET', `/repos/${ctx.owner}/${ctx.repo}/commits?${query}`);
        if (oldest) created = restEvent(oldest);
      }
      return { updated: nodeEvent(latest), created, commits: total };
    },

    lastCommits,

    async listVersions(path, limit) {
      const repo = await repoQuery<{
        ref: { target: { history?: { nodes: VersionNode[] } } | null } | null;
      }>(ctx, VERSIONS_QUERY, { ref: `refs/heads/${branch}`, path, first: versionLimit(limit) });
      return (repo.ref?.target?.history?.nodes ?? []).map(versionOf);
    },

    async readVersion(path, commit) {
      const entry = await entryAt(ctx, commit, path);
      if (entry?.type !== 'blob') {
        throw new EditletError([{ file: path, path: '', message: `Not in ${commit.slice(0, 7)}: ${path}` }]);
      }
      const images = new Set(isImagePath(path) ? [entry.oid] : []);
      return (await readBlobs(ctx, [entry.oid], images)).get(entry.oid)!.slice();
    },

    baseBranch,

    branchPrefix,

    withBranch,

    ...makeRepoOps({
      ctx,
      branch,
      baseBranch,
      branchPrefix,
      withBranch,
      repoQuery: (query, variables) => repoQuery(ctx, query, variables),
      loadSnapshot: (b) => loadSnapshot(ctx, b),
      loadSnapshotAt: (oid) => loadSnapshotAt(ctx, oid),
    }),
  };
}
