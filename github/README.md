# Editlet GitHub source

Lets the Editlet admin read and write content through GitHub, straight from the browser, with the editor's own token.

**Why it exists.** In production the admin has no server. This library is everything it needs from GitHub: a
`ContentSource` bound to one branch, plus branches, pull requests, publish and deployment status. It has no UI, no
React and no Node imports. It stores no token: the admin passes one in.

**What it is.** One entry point, `createGitHubSource({ owner, repo, branch, token })`. It returns a `GitHubSource`
(`kind: 'github'`) that follows the [content source contract](../../../docs/core/content-source.md).

```ts
import { createGitHubSource } from 'editlet/github';

const source = createGitHubSource({ owner: 'acme', repo: 'site', branch: 'editlet/home-edits', token: () => session.accessToken });
const text = new TextDecoder().decode(await source.readFile('cms/content/home.md'));
// expected sha = the one readFile served, so a foreign edit since then is a conflict, not an overwrite
const { issues, commit } = await source.commit([{ path: 'cms/content/home.md', content: edited(text) }], 'Edit home');
const diff = await source.compare(); // diff.files (CMS) and diff.otherFiles (everything else the merge brings in)
const result = await source.publish({ headOid: diff.headOid });
```

## How it works

1. `listFiles` reads the branch head and the schema in one GraphQL call, then the content tree. Every later read uses that
   one commit.
2. `commit` checks the change against the schema, then makes one atomic commit with `createCommitOnBranch`. It only
   writes to branches with the prefix (`git.branchPrefix`, default `editlet/`).
3. `publish` opens or finds the pull request, checks that its head is the reviewed `headOid` and that GitHub allows
   the merge, and merges it. Renames, deletes and publish leave the pending queue to the admin.

## Features

| Feature | Doc |
|---|---|
| Reading files and the tree, file history, blob cache, pending edits | [docs/github/source.md](../../../docs/github/source.md) |
| Commit: atomic write, `sha` conflicts, issues | [docs/github/commit.md](../../../docs/github/commit.md) |
| Branches, pull requests (draft, labels, body refresh, reviews), branch diff, `CODEOWNERS` | [docs/github/branches.md](../../../docs/github/branches.md) |
| Publish: the merge gate and blocked reasons | [docs/github/publish.md](../../../docs/github/publish.md) |
| Deployments and the deploy hook | [docs/github/deployments.md](../../../docs/github/deployments.md) |
| Client, errors, rate limits | [docs/github/rate-limits.md](../../../docs/github/rate-limits.md) |

## Configuration

| Option | Required | Meaning |
|---|---|---|
| `owner`, `repo`, `branch` | yes | The repository and the branch this source is bound to |
| `token` | one of `token` or `client` | A token, or a function returning one. It is called for every request |
| `client` | one of `token` or `client` | A shared `GitHubClient` (one set of rate limits for several sources) |
| `baseBranch` | no | Default: `git.baseBranch` from the schema on `branch` |
| `branchPrefix` | no | Default: `git.branchPrefix` from the schema on `branch`, else `editlet/` |
| `schemaPath` | no | Default `cms/schema.json` |
| `cache` | no | Default `openGitHubCache()` (IndexedDB) |

The GitHub App behind the token needs these repository permissions:

| Permission | Level | Used for |
|---|---|---|
| Contents | Read and write | Files, commits, branches, merge |
| Pull requests | Read and write | Open, labels, body refresh, reviews, mark ready, merge |
| Deployments | Read | Preview and live status |

## Files

| File | Role |
|---|---|
| `source.ts` | `createGitHubSource`: snapshot, reads, commit |
| `repo.ts` | Branches, pull requests, compare, publish, deployments |
| `codeowners.ts` | `readCodeowners`, `parseCodeowners`, `ownersOf`: `CODEOWNERS` as GitHub matches it |
| `client.ts` | HTTP client: auth, rate limits, `GitHubError` |
| `cache.ts` | Dexie cache of blobs and pending edits, memory fallback |
| `deploy.ts`, `base64.ts` | Deploy hook call, base64 helper |
| `smoke.ts` | Manual check against a real repository (not run in CI) |

## Manual smoke test

Use a throwaway repository that already has `cms/schema.json`. The token needs the permissions above.

```sh
GITHUB_TOKEN=ghp_… GITHUB_REPO=owner/name npx jiti packages/editlet/github/smoke.ts
```

It creates an `editlet/smoke-<time>` branch, commits one entry, compares, opens the pull request, tries to publish and
prints the latest deployment. It leaves the branch or the pull request behind if publish is blocked.
