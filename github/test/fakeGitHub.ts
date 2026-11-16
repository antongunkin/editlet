// In-memory fake of the GitHub REST + GraphQL endpoints the github source uses, behind an injectable `fetch`.
// Test-only (node APIs allowed). Later tasks extend `restRoutes` and `graphqlOps`.
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export type FileInput = string | Uint8Array;

export interface FakeCommit {
  oid: string;
  parent: string | null;
  message: string;
  /** path → blob sha (for a submodule, the submodule commit oid). */
  files: Map<string, string>;
  /** Non-default modes only: `120000` symlink, `160000` submodule. Absent means `100644`. */
  modes: Map<string, string>;
}

export interface FakeOptions {
  /** Forces `truncated: true` (with half the entries) on recursive tree reads. */
  truncateTrees?: boolean;
  /** sha → the text GraphQL `Blob.text` returns instead of the real decoding (simulates lossy decoding). */
  graphqlTextOverride: Map<string, string>;
  /** Called with the input at the start of every `Commit` mutation (e.g. to move the head first). */
  beforeCommit?: (input: CommitInput) => void;
  /** Page size of the `Branches` GraphQL listing (default 100). */
  refsPageSize?: number;
  /** `POST /issues/{n}/labels` answers 403. */
  labelsFail?: boolean;
}

export interface FakePull {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  /** Label names added through `POST /issues/{n}/labels`. */
  labels?: string[];
  /** What `PullReview` answers; default: no decision, no requests, no reviews. */
  review?: { decision?: string | null; requested?: string[]; approved?: string[]; changesRequested?: string[] };
  /** Head branch name. */
  head: string;
  base: string;
  state: 'open' | 'closed' | 'merged';
}

/** `CreateCommitOnBranchInput` as the source sends it. */
export interface CommitInput {
  branch: { repositoryNameWithOwner: string; branchName: string };
  expectedHeadOid: string;
  message: { headline: string; body?: string };
  fileChanges: { additions?: { path: string; contents: string }[]; deletions?: { path: string }[] };
}

export interface FakeState {
  owner: string;
  repo: string;
  /** branch name → commit oid. */
  refs: Map<string, string>;
  commits: Map<string, FakeCommit>;
  blobs: Map<string, Uint8Array>;
  /** tree oid → where it points (tree oids are synthetic: sha1 of `<commit>:<dir>`). */
  trees: Map<string, { commit: string; dir: string }>;
  pulls: FakePull[];
  /** REST deployment objects, newest first. */
  deployments: { id: number; sha: string; ref: string; environment: string; created_at: string; updated_at: string }[];
  /** deployment id → statuses, newest first. */
  deploymentStatuses: Map<number, { state: string; environment_url?: string; log_url?: string; created_at: string }[]>;
  /** PR number → `mergeStateStatus` sequence; one entry is consumed per `PullState` query, the last one repeats. */
  mergeStates: Map<number, string[]>;
  /** PR number → forced merge failure. */
  mergeFail: Map<number, 405 | 409>;
  options: FakeOptions;
}

export interface FakeCall {
  method: string;
  url: string;
  /** GraphQL operation name (`Snapshot`, `Blobs`, …); undefined for REST. */
  operation?: string;
}

export interface GraphQLResult {
  data?: unknown;
  errors?: { type?: string; path?: (string | number)[]; message: string }[];
}

export type GraphQLOp = (variables: Record<string, unknown>, query: string) => GraphQLResult;

export interface RestRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
  match: RegExpMatchArray;
}

export interface RestRoute {
  method: string;
  /** Matched against the pathname after `/repos/:owner/:repo`. */
  pattern: RegExp;
  handle(req: RestRequest): Response;
}

const encoder = new TextEncoder();
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const lenientUtf8 = new TextDecoder('utf-8', { ignoreBOM: true });
const GRAPHQL_TEXT_LIMIT = 512_000;
const RAW_ACCEPT = 'application/vnd.github.raw+json';

export const sha1 = (data: string | Uint8Array): string => createHash('sha1').update(data).digest('hex');

export function blobSha(bytes: Uint8Array): string {
  return sha1(Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`), bytes]));
}

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const branchOf = (ref: string) => (ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref);

function checkAuth(headers: Headers): Response | null {
  const auth = headers.get('authorization');
  if (!auth || auth === 'Bearer bad' || !auth.startsWith('Bearer ')) {
    return json({ message: 'Bad credentials', status: '401' }, 401);
  }
  return null;
}

const unprocessable = (message: string, errors?: { message: string }[]) =>
  json({ message, ...(errors ? { errors } : {}) }, 422);
const decodeRef = (s: string) => s.split('/').map(decodeURIComponent).join('/');

const notFound = () => json({ message: 'Not Found', status: '404' }, 404);

/** A failed `createCommitOnBranch` (HTTP 200, `data.createCommitOnBranch: null`, one typed error). */
const commitFailed = (type: string, message: string): GraphQLResult => ({
  data: { createCommitOnBranch: null },
  errors: [{ type, path: ['createCommitOnBranch'], message }],
});

/** `@login` or `@org/team` as a GraphQL `requestedReviewer`. */
function reviewerOf(name: string) {
  const [org, slug] = name.replace(/^@/, '').split('/');
  return slug ? { slug, organization: { login: org } } : { login: org };
}

export function createFakeGitHub(init: {
  owner?: string;
  repo?: string;
  branches: Record<string, Record<string, FileInput>>;
  /** Applied to every initial commit: path → `120000` (symlink) or `160000` (submodule). */
  modes?: Record<string, string>;
}) {
  const state: FakeState = {
    owner: init.owner ?? 'o',
    repo: init.repo ?? 'r',
    refs: new Map(),
    commits: new Map(),
    blobs: new Map(),
    trees: new Map(),
    pulls: [],
    deployments: [],
    deploymentStatuses: new Map(),
    mergeStates: new Map(),
    mergeFail: new Map(),
    options: { graphqlTextOverride: new Map() },
  };
  const calls: FakeCall[] = [];
  let counter = 0;

  function putBlob(content: FileInput): string {
    const bytes = typeof content === 'string' ? encoder.encode(content) : new Uint8Array(content);
    const sha = blobSha(bytes);
    state.blobs.set(sha, bytes);
    return sha;
  }

  function newCommit(
    parent: string | null,
    files: Map<string, string>,
    modes: Map<string, string>,
    message: string,
  ): FakeCommit {
    const oid = sha1(`${parent ?? ''}${message}${counter++}`);
    const created: FakeCommit = { oid, parent, message, files, modes };
    state.commits.set(oid, created);
    return created;
  }

  /** Commits `files` (null deletes) on top of `branch` (created as a root commit when missing). Returns the oid. */
  function commit(branch: string, files: Record<string, FileInput | null>, message = 'Fake commit'): string {
    const parentOid = state.refs.get(branch) ?? null;
    const parent = parentOid ? state.commits.get(parentOid) : undefined;
    const next = new Map(parent?.files);
    const modes = new Map(parent?.modes);
    for (const [path, content] of Object.entries(files)) {
      if (content === null) {
        next.delete(path);
        modes.delete(path);
      } else {
        next.set(path, putBlob(content));
        modes.delete(path);
      }
    }
    const c = newCommit(parentOid, next, modes, message);
    state.refs.set(branch, c.oid);
    return c.oid;
  }

  // Initial branches: the first is a root commit; the others are children of it (so they share a merge base).
  let root: string | null = null;
  for (const [branch, files] of Object.entries(init.branches)) {
    const map = new Map<string, string>();
    for (const [path, content] of Object.entries(files)) map.set(path, putBlob(content));
    const modes = new Map(Object.entries(init.modes ?? {}).filter(([p]) => map.has(p)));
    const c = newCommit(root, map, modes, `Initial ${branch}`);
    root ??= c.oid;
    state.refs.set(branch, c.oid);
  }

  function treeOid(commitOid: string, dir: string): string {
    const oid = sha1(`${commitOid}:${dir}`);
    state.trees.set(oid, { commit: commitOid, dir });
    return oid;
  }

  /** GraphQL `Commit.file(path:)`: a TreeEntry for a blob, submodule or directory, else null. */
  function fileEntry(c: FakeCommit, path: string): { oid: string; type: string; mode: number } | null {
    const sha = c.files.get(path);
    if (sha !== undefined) {
      const mode = c.modes.get(path) ?? '100644';
      return { oid: sha, type: mode === '160000' ? 'commit' : 'blob', mode: Number.parseInt(mode, 8) };
    }
    const prefix = `${path}/`;
    for (const p of c.files.keys()) {
      if (p.startsWith(prefix)) return { oid: treeOid(c.oid, path), type: 'tree', mode: 0o40000 };
    }
    return null;
  }

  interface TreeItem {
    path: string;
    mode: string;
    type: 'blob' | 'tree' | 'commit';
    sha: string;
    size?: number;
  }

  function listTree(c: FakeCommit, dir: string, recursive: boolean): TreeItem[] {
    const prefix = dir === '' ? '' : `${dir}/`;
    const items = new Map<string, TreeItem>();
    const addDir = (rel: string) => {
      if (!items.has(rel)) {
        items.set(rel, { path: rel, mode: '040000', type: 'tree', sha: treeOid(c.oid, prefix + rel) });
      }
    };
    for (const [path, sha] of c.files) {
      if (!path.startsWith(prefix)) continue;
      const rel = path.slice(prefix.length);
      const segs = rel.split('/');
      if (!recursive && segs.length > 1) {
        addDir(segs[0]!);
        continue;
      }
      for (let i = 1; i < segs.length; i++) addDir(segs.slice(0, i).join('/'));
      const mode = c.modes.get(path) ?? '100644';
      const type = mode === '160000' ? 'commit' : 'blob';
      items.set(rel, {
        path: rel,
        mode,
        type,
        sha,
        ...(type === 'blob' ? { size: state.blobs.get(sha)?.length } : {}),
      });
    }
    return [...items.values()].toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  function blobNode(sha: string) {
    const bytes = state.blobs.get(sha);
    if (!bytes) return null;
    const isBinary = bytes.includes(0);
    let text: string | null = null;
    let isTruncated = false;
    if (!isBinary) {
      isTruncated = bytes.length > GRAPHQL_TEXT_LIMIT;
      const visible = isTruncated ? bytes.subarray(0, GRAPHQL_TEXT_LIMIT) : bytes;
      try {
        text = strictUtf8.decode(visible);
      } catch {
        text = lenientUtf8.decode(visible); // lossy, like GitHub transcoding a non-UTF-8 text file
      }
      const override = state.options.graphqlTextOverride.get(sha);
      if (override !== undefined) text = override;
    }
    return { oid: sha, byteSize: bytes.length, text, isBinary, isTruncated };
  }

  const repoMissing = (): GraphQLResult => ({
    data: { repository: null },
    errors: [
      {
        type: 'NOT_FOUND',
        path: ['repository'],
        message: `Could not resolve to a Repository with the name '${state.owner}/${state.repo}'.`,
      },
    ],
  });
  const isRepo = (v: Record<string, unknown>) => v.owner === state.owner && v.name === state.repo;

  /** Commits from `oid` back that changed `path`, newest first. */
  function touching(oid: string, path: string): FakeCommit[] {
    const out: FakeCommit[] = [];
    for (let cur = state.commits.get(oid); cur; cur = cur.parent ? state.commits.get(cur.parent) : undefined) {
      const before = cur.parent ? state.commits.get(cur.parent)?.files.get(path) : undefined;
      if (cur.files.get(path) !== before) out.push(cur);
    }
    return out;
  }

  const fakeAuthor = { name: 'Jane Doe', user: { login: 'jane', avatarUrl: 'https://avatars.test/jane' } };

  const graphqlOps: Record<string, GraphQLOp> = {
    History(v) {
      if (!isRepo(v)) return repoMissing();
      const oid = state.refs.get(branchOf(String(v.ref)));
      if (!oid) return { data: { repository: { ref: null } } };
      const all = touching(oid, String(v.path));
      const nodes = all.slice(0, 1).map((c) => ({
        url: `https://github.test/${c.oid}`,
        messageHeadline: c.message,
        committedDate: '2025-11-19T14:48:00Z',
        author: fakeAuthor,
      }));
      return { data: { repository: { ref: { target: { history: { totalCount: all.length, nodes } } } } } };
    },
    Snapshot(v) {
      if (!isRepo(v)) return repoMissing();
      const oid = state.refs.get(branchOf(String(v.ref)));
      const c = oid ? state.commits.get(oid) : undefined;
      if (!c) return { data: { repository: { ref: null } } };
      const schema = fileEntry(c, String(v.schemaPath));
      return { data: { repository: { ref: { target: { oid: c.oid, schema: schema && { oid: schema.oid } } } } } };
    },
    Dir(v) {
      if (!isRepo(v)) return repoMissing();
      const c = state.commits.get(String(v.oid));
      if (!c) return { data: { repository: { object: null } } };
      const entry = fileEntry(c, String(v.path));
      return { data: { repository: { object: { file: entry && { oid: entry.oid, type: entry.type } } } } };
    },
    // createCommitOnBranch: atomic; additions replace, deletions of a missing path abort, paths unique overall.
    Commit(v) {
      const input = v.input as CommitInput;
      state.options.beforeCommit?.(input);
      if (input.branch.repositoryNameWithOwner !== `${state.owner}/${state.repo}`) {
        return commitFailed(
          'NOT_FOUND',
          `Could not resolve to a Repository '${input.branch.repositoryNameWithOwner}'.`,
        );
      }
      const headOid = state.refs.get(input.branch.branchName);
      const head = headOid ? state.commits.get(headOid) : undefined;
      if (!head)
        return commitFailed('NOT_FOUND', `A ref named "refs/heads/${input.branch.branchName}" does not exist.`);
      if (input.expectedHeadOid !== head.oid) {
        return commitFailed(
          'STALE_DATA',
          `Expected branch to point to "${input.expectedHeadOid}" but it did not. Pull and try again.`,
        );
      }
      const additions = input.fileChanges.additions ?? [];
      const deletions = input.fileChanges.deletions ?? [];
      const paths = [...additions, ...deletions].map((c) => c.path);
      if (new Set(paths).size !== paths.length) return commitFailed('UNPROCESSABLE', 'Duplicate path in file changes');
      const files = new Map(head.files);
      const modes = new Map(head.modes);
      for (const { path } of deletions) {
        if (!files.delete(path))
          return commitFailed(
            'UNPROCESSABLE',
            `A path was requested for deletion which does not exist as of commit oid \`${head.oid}\``,
          );
        modes.delete(path);
      }
      for (const { path, contents } of additions) {
        files.set(path, putBlob(new Uint8Array(Buffer.from(contents, 'base64'))));
        modes.delete(path);
      }
      const { headline, body } = input.message;
      const created = newCommit(head.oid, files, modes, body ? `${headline}\n\n${body}` : headline);
      state.refs.set(input.branch.branchName, created.oid);
      const url = `https://github.com/${state.owner}/${state.repo}/commit/${created.oid}`;
      return { data: { createCommitOnBranch: { commit: { oid: created.oid, url } } } };
    },
    Branches(v, query) {
      if (!isRepo(v)) return repoMissing();
      const prefix = /refPrefix:\s*"refs\/heads\/([^"]*)"/.exec(query)?.[1] ?? '';
      const names = [...state.refs.keys()].filter((b) => b.startsWith(prefix)).toSorted();
      const size = state.options.refsPageSize ?? 100;
      const start = v.after ? Number(v.after) : 0;
      const page = names.slice(start, start + size);
      const end = start + page.length;
      const nodes = page.map((b) => {
        const oid = state.refs.get(b)!;
        const pr = state.pulls.find((p) => p.head === b && p.base === v.base && p.state === 'open');
        const prs = pr
          ? [{ number: pr.number, url: pullUrl(pr), title: pr.title, isDraft: pr.draft, headRefOid: oid }]
          : [];
        return {
          name: b.slice(prefix.length),
          target: { oid, committedDate: '2026-01-01T00:00:00Z' },
          associatedPullRequests: { nodes: prs },
        };
      });
      const hasNextPage = end < names.length;
      const pageInfo = { hasNextPage, endCursor: hasNextPage ? String(end) : null };
      return { data: { repository: { refs: { nodes, pageInfo } } } };
    },
    PullReview(v) {
      if (!isRepo(v)) return repoMissing();
      const pr = state.pulls.find((p) => p.number === v.number);
      if (!pr) return { data: { repository: { pullRequest: null } } };
      const r = pr.review ?? {};
      const reviews = [
        ...(r.approved ?? []).map((login) => ({ state: 'APPROVED', author: { login } })),
        ...(r.changesRequested ?? []).map((login) => ({ state: 'CHANGES_REQUESTED', author: { login } })),
      ];
      return {
        data: {
          repository: {
            pullRequest: {
              reviewDecision: r.decision ?? null,
              reviewRequests: { nodes: (r.requested ?? []).map((n) => ({ requestedReviewer: reviewerOf(n) })) },
              latestOpinionatedReviews: { nodes: reviews },
            },
          },
        },
      };
    },
    PullState(v) {
      if (!isRepo(v)) return repoMissing();
      const pr = state.pulls.find((p) => p.number === v.number);
      if (!pr) return { data: { repository: { pullRequest: null } } };
      const seq = state.mergeStates.get(pr.number) ?? ['CLEAN'];
      const mergeStateStatus = seq.length > 1 ? seq.shift()! : seq[0]!;
      const pullRequest = {
        id: `PR_${pr.number}`,
        isDraft: pr.draft,
        mergeable: 'MERGEABLE',
        mergeStateStatus,
        headRefOid: state.refs.get(pr.head) ?? null,
      };
      return { data: { repository: { pullRequest } } };
    },
    Ready(v) {
      const pr = state.pulls.find((p) => `PR_${p.number}` === v.id);
      if (!pr) return { data: { markPullRequestReadyForReview: null }, errors: [{ message: 'Not found' }] };
      pr.draft = false;
      return { data: { markPullRequestReadyForReview: { pullRequest: { isDraft: false } } } };
    },
    Blobs(v, query) {
      if (!isRepo(v)) return repoMissing();
      const repository: Record<string, unknown> = {};
      for (const m of query.matchAll(/(\w+)\s*:\s*object\(\s*oid\s*:\s*"([^"]*)"\s*\)/g)) {
        repository[m[1]!] = blobNode(m[2]!);
      }
      return { data: { repository } };
    },
  };

  const pullUrl = (p: FakePull) => `https://github.com/${state.owner}/${state.repo}/pull/${p.number}`;
  const pullJson = (p: FakePull) => ({
    number: p.number,
    html_url: pullUrl(p),
    title: p.title,
    body: p.body,
    draft: p.draft,
    state: p.state,
    head: { ref: p.head, sha: state.refs.get(p.head) ?? null },
    base: { ref: p.base },
  });

  /** oid → distance from `oid` for every ancestor (itself included). */
  function ancestry(oid: string): Map<string, number> {
    const out = new Map<string, number>();
    let n = 0;
    for (let cur: string | null = oid; cur; cur = state.commits.get(cur)?.parent ?? null) out.set(cur, n++);
    return out;
  }

  function compareRefs(base: string, head: string) {
    const baseOid = state.refs.get(base);
    const headOid = state.refs.get(head);
    if (!baseOid || !headOid) return null;
    const a = ancestry(baseOid);
    const h = ancestry(headOid);
    const mergeBase = [...h.keys()].find((oid) => a.has(oid));
    if (!mergeBase) return null;
    return { mergeBase, ahead: h.get(mergeBase)!, behind: a.get(mergeBase)!, headOid };
  }

  const restRoutes: RestRoute[] = [
    {
      method: 'GET',
      pattern: /^\/commits$/,
      handle({ url }) {
        const oid = state.refs.get(url.searchParams.get('sha') ?? '');
        if (!oid) return notFound();
        const all = touching(oid, url.searchParams.get('path') ?? '');
        const page = Number(url.searchParams.get('page') ?? 1);
        const c = all[page - 1];
        return json(
          c
            ? [
                {
                  html_url: `https://github.test/${c.oid}`,
                  commit: { message: c.message, author: { name: 'Old Timer', date: '2025-10-02T09:00:00Z' } },
                  author: { login: 'old', avatar_url: 'https://avatars.test/old' },
                },
              ]
            : [],
        );
      },
    },
    {
      method: 'GET',
      pattern: /^\/git\/ref\/heads\/(.+)$/,
      handle({ match }) {
        const name = decodeRef(match[1]!);
        const sha = state.refs.get(name);
        if (!sha) return notFound();
        return json({ ref: `refs/heads/${name}`, object: { sha, type: 'commit' } });
      },
    },
    {
      method: 'POST',
      pattern: /^\/git\/refs$/,
      handle({ body }) {
        const { ref, sha } = body as { ref: string; sha: string };
        const name = branchOf(ref);
        if (state.refs.has(name)) return unprocessable('Reference already exists');
        if (!state.commits.has(sha)) return unprocessable('Object does not exist');
        state.refs.set(name, sha);
        return json({ ref, object: { sha, type: 'commit' } }, 201);
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/git\/refs\/heads\/(.+)$/,
      handle({ match }) {
        if (!state.refs.delete(decodeRef(match[1]!))) return unprocessable('Reference does not exist');
        return new Response(null, { status: 204 });
      },
    },
    {
      method: 'POST',
      pattern: /^\/branches\/(.+)\/rename$/,
      handle({ match, body }) {
        const name = decodeRef(match[1]!);
        const next = (body as { new_name: string }).new_name;
        const sha = state.refs.get(name);
        if (!sha) return notFound();
        if (state.refs.has(next)) return unprocessable('Validation Failed', [{ message: 'Branch already exists' }]);
        state.refs.delete(name);
        state.refs.set(next, sha);
        for (const p of state.pulls) if (p.head === name) p.head = next;
        return json({ name: next, commit: { sha } }, 201);
      },
    },
    {
      method: 'GET',
      pattern: /^\/pulls$/,
      handle({ url }) {
        const head = url.searchParams.get('head');
        const base = url.searchParams.get('base');
        const st = url.searchParams.get('state') ?? 'open';
        const list = state.pulls.filter(
          (p) =>
            (head === null || `${state.owner}:${p.head}` === head) &&
            (base === null || p.base === base) &&
            (st === 'all' || p.state === st),
        );
        return json(list.map(pullJson));
      },
    },
    {
      method: 'POST',
      pattern: /^\/pulls$/,
      handle({ body }) {
        const {
          title,
          head,
          base,
          body: text,
          draft,
        } = body as { title: string; head: string; base: string; body?: string; draft?: boolean };
        if (state.pulls.some((p) => p.head === head && p.base === base && p.state === 'open')) {
          const message = `A pull request already exists for ${state.owner}:${head}.`;
          return unprocessable('Validation Failed', [{ message }]);
        }
        const cmp = compareRefs(base, head);
        if (!cmp) return unprocessable('Validation Failed', [{ message: 'Head or base does not exist' }]);
        if (cmp.ahead === 0) {
          return unprocessable('Validation Failed', [{ message: `No commits between ${base} and ${head}` }]);
        }
        const pull: FakePull = {
          number: state.pulls.length + 1,
          title,
          body: text ?? '',
          draft: draft === true,
          head,
          base,
          state: 'open',
        };
        state.pulls.push(pull);
        return json(pullJson(pull), 201);
      },
    },
    {
      method: 'PATCH',
      pattern: /^\/pulls\/(\d+)$/,
      handle({ match, body }) {
        const pr = state.pulls.find((p) => p.number === Number(match[1]));
        if (!pr) return notFound();
        const { body: text, title } = body as { body?: string; title?: string };
        if (text !== undefined) pr.body = text;
        if (title !== undefined) pr.title = title;
        return json(pullJson(pr));
      },
    },
    {
      method: 'POST',
      pattern: /^\/issues\/(\d+)\/labels$/,
      handle({ match, body }) {
        const pr = state.pulls.find((p) => p.number === Number(match[1]));
        if (!pr) return notFound();
        const { labels } = body as { labels: string[] };
        if (state.options.labelsFail) return json({ message: 'Resource not accessible by integration' }, 403);
        pr.labels = [...new Set([...(pr.labels ?? []), ...labels])];
        return json(pr.labels.map((name) => ({ name })));
      },
    },
    {
      method: 'GET',
      pattern: /^\/contents\/(.+)$/,
      handle({ url, match, headers }) {
        const ref = url.searchParams.get('ref') ?? 'main';
        const oid = state.refs.get(ref) ?? (state.commits.has(ref) ? ref : undefined);
        const sha = oid === undefined ? undefined : state.commits.get(oid)!.files.get(decodeURIComponent(match[1]!));
        const bytes = sha === undefined ? undefined : state.blobs.get(sha);
        if (!bytes) return notFound();
        if (headers.get('accept') === RAW_ACCEPT) {
          return new Response(bytes.slice(), {
            status: 200,
            headers: { 'content-type': 'application/vnd.github.raw' },
          });
        }
        return json({ sha, size: bytes.length, content: Buffer.from(bytes).toString('base64'), encoding: 'base64' });
      },
    },
    {
      method: 'PUT',
      pattern: /^\/pulls\/(\d+)\/merge$/,
      handle({ match, body }) {
        const pr = state.pulls.find((p) => p.number === Number(match[1]));
        if (!pr) return notFound();
        const forced = state.mergeFail.get(pr.number);
        if (forced === 405) return json({ message: 'Pull Request is not mergeable' }, 405);
        if (forced === 409) {
          return json({ message: 'Head branch was modified. Review and try the merge again.' }, 409);
        }
        const { sha } = body as { merge_method: string; sha?: string };
        const headOid = state.refs.get(pr.head);
        if (sha !== headOid) {
          return json({ message: 'Head branch was modified. Review and try the merge again.' }, 409);
        }
        const head = state.commits.get(headOid!)!;
        const baseOid = state.refs.get(pr.base)!;
        const merged = newCommit(baseOid, new Map(head.files), new Map(head.modes), `Merge pull request #${pr.number}`);
        state.refs.set(pr.base, merged.oid);
        pr.state = 'merged';
        return json({ sha: merged.oid, merged: true, message: 'Pull Request successfully merged' });
      },
    },
    {
      method: 'GET',
      pattern: /^\/deployments$/,
      handle({ url }) {
        const sha = url.searchParams.get('sha');
        const ref = url.searchParams.get('ref');
        const list = state.deployments.filter(
          (d) => (sha === null || d.sha === sha) && (ref === null || d.ref === ref),
        );
        return json(list);
      },
    },
    {
      method: 'GET',
      pattern: /^\/deployments\/(\d+)\/statuses$/,
      handle({ match }) {
        return json(state.deploymentStatuses.get(Number(match[1])) ?? []);
      },
    },
    {
      method: 'GET',
      pattern: /^\/compare\/(.+)\.\.\.(.+)$/,
      handle({ match }) {
        const cmp = compareRefs(decodeRef(match[1]!), decodeRef(match[2]!));
        if (!cmp) return notFound();
        const status =
          cmp.ahead > 0 && cmp.behind > 0
            ? 'diverged'
            : cmp.ahead > 0
              ? 'ahead'
              : cmp.behind > 0
                ? 'behind'
                : 'identical';
        const merge_base_commit = { sha: cmp.mergeBase };
        // changed files between the merge base and the head (GitHub caps the list at 300)
        const from = state.commits.get(cmp.mergeBase)!.files;
        const to = state.commits.get(cmp.headOid)!.files;
        const files: { filename: string; status: string }[] = [];
        for (const path of new Set([...from.keys(), ...to.keys()])) {
          const a = from.get(path);
          const b = to.get(path);
          if (a === b) continue;
          files.push({ filename: path, status: a === undefined ? 'added' : b === undefined ? 'removed' : 'modified' });
        }
        files.sort((x, y) => (x.filename < y.filename ? -1 : x.filename > y.filename ? 1 : 0));
        return json({
          status,
          ahead_by: cmp.ahead,
          behind_by: cmp.behind,
          merge_base_commit,
          files: files.slice(0, 300),
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/git\/trees\/([^/]+)$/,
      handle({ url, match }) {
        const sha = decodeURIComponent(match[1]!);
        const target = state.trees.get(sha) ?? (state.commits.has(sha) ? { commit: sha, dir: '' } : undefined);
        const c = target && state.commits.get(target.commit);
        if (!target || !c) return notFound();
        const recursive = url.searchParams.has('recursive');
        let tree = listTree(c, target.dir, recursive);
        const truncated = recursive && state.options.truncateTrees === true;
        if (truncated) tree = tree.slice(0, Math.floor(tree.length / 2));
        return json({ sha, url: url.toString(), tree, truncated });
      },
    },
    {
      method: 'GET',
      pattern: /^\/git\/blobs\/([^/]+)$/,
      handle({ headers, url, match }) {
        const sha = decodeURIComponent(match[1]!);
        const bytes = state.blobs.get(sha);
        if (!bytes) return notFound();
        if (headers.get('accept') === RAW_ACCEPT) {
          return new Response(bytes.slice(), {
            status: 200,
            headers: { 'content-type': 'application/vnd.github.raw' },
          });
        }
        const content = (
          Buffer.from(bytes)
            .toString('base64')
            .match(/.{1,60}/g) ?? []
        ).join('\n');
        return json({ sha, size: bytes.length, url: url.toString(), content: `${content}\n`, encoding: 'base64' });
      },
    },
  ];

  async function fakeFetch(input: RequestInfo | URL, reqInit: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (reqInit.method ?? 'GET').toUpperCase();
    const headers = new Headers(reqInit.headers);
    const rawBody = typeof reqInit.body === 'string' ? reqInit.body : undefined;
    const body: unknown = rawBody === undefined ? undefined : JSON.parse(rawBody);

    if (url.origin === 'https://api.github.com' && url.pathname === '/graphql') {
      const { query, variables } = body as { query: string; variables?: Record<string, unknown> };
      const operation = /^\s*(?:query|mutation)\s+(\w+)/.exec(query)?.[1];
      calls.push({ method, url: url.toString(), operation });
      const auth = checkAuth(headers);
      if (auth) return auth;
      const op = operation ? graphqlOps[operation] : undefined;
      if (!op) return json({ errors: [{ message: `Fake GitHub: unknown operation ${operation ?? '(anonymous)'}` }] });
      return json(op(variables ?? {}, query));
    }

    calls.push({ method, url: url.toString() });
    const auth = checkAuth(headers);
    if (auth) return auth;
    const repoPrefix = `/repos/${state.owner}/${state.repo}`;
    if (url.origin !== 'https://api.github.com' || !url.pathname.startsWith(`${repoPrefix}/`)) return notFound();
    const rest = url.pathname.slice(repoPrefix.length);
    for (const route of restRoutes) {
      if (route.method !== method) continue;
      const match = rest.match(route.pattern);
      if (match) return route.handle({ method, url, headers, body, match });
    }
    return notFound();
  }

  return {
    fetch: fakeFetch as typeof fetch,
    state,
    commit,
    calls,
    /** Extension points for later tasks: GraphQL operations by name, REST routes in match order. */
    graphqlOps,
    restRoutes,
    /** Helpers for extensions. */
    putBlob,
    fileEntry,
    treeOid,
  };
}

export type FakeGitHub = ReturnType<typeof createFakeGitHub>;
