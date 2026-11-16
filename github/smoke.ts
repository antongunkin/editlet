/**
 * Manual smoke test against a throwaway repository. Never run in CI (not a `*.test.ts` file).
 *
 *   GITHUB_TOKEN=… GITHUB_REPO=owner/name npx jiti packages/editlet/github/smoke.ts
 *
 * Optional: GITHUB_BASE (default main).
 * The repository needs `cms/schema.json` and a collection to write an entry for. The entry path is
 * `GITHUB_ENTRY_PATH` (default `cms/content/smoke-<time>.md`) and its text is a minimal front-matter file, so
 * point it at a collection your schema accepts.
 */
import { createGitHubSource, createMemoryCache } from './index.ts';

const out = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  const [owner, repo] = (process.env.GITHUB_REPO ?? '').split('/');
  if (!token || !owner || !repo) throw new Error('Set GITHUB_TOKEN and GITHUB_REPO=owner/name');

  const stamp = Date.now();
  const entryPath = process.env.GITHUB_ENTRY_PATH ?? `cms/content/smoke-${stamp}.md`;
  const cache = createMemoryCache();
  const trunk = createGitHubSource({ owner, repo, branch: process.env.GITHUB_BASE ?? 'main', token, cache });
  const base = await trunk.baseBranch();
  out(`base branch: ${base}`);

  const source = await createGitHubSource({ owner, repo, branch: base, token, cache }).createBranch(
    `editlet/smoke-${stamp}`,
  );
  out(`created ${source.branch}`);

  const files = await source.listFiles();
  out(`files on branch: ${files.length}`);

  const result = await source.commit([{ path: entryPath, content: `---\ntitle: Smoke ${stamp}\n---\n` }], 'Smoke test');
  if (result.issues.length > 0) {
    out(`commit refused: ${JSON.stringify(result.issues)}`);
    return;
  }
  out(`commit ${result.commit?.oid ?? '(nothing to do)'} ${result.commit?.url ?? ''}`);

  const diff = await source.compare();
  out(
    `compare: ${diff.status}, ahead ${diff.aheadBy}, files ${diff.files.map((f) => `${f.status}:${f.path}`).join(', ')}`,
  );
  out(`other files${diff.complete ? '' : ' (incomplete)'}: ${diff.otherFiles.map((f) => f.path).join(', ') || 'none'}`);

  const pr = await source.openPullRequest({ title: `Smoke ${stamp}` });
  out(`pull request #${pr.number} ${pr.url}`);

  const published = await source.publish({ headOid: diff.headOid });
  if (published.status === 'merged') {
    out(`merged ${published.mergeOid}, branch deleted: ${published.branchDeleted}`);
  } else {
    out(`publish blocked: ${published.reason} ${published.message ?? ''} (${published.pullRequest.url})`);
  }

  const deployment = await (published.status === 'merged' ? trunk : source).latestDeployment(
    published.status === 'merged' ? base : undefined,
  );
  out(deployment ? `deployment: ${deployment.state} ${deployment.url ?? '(no url)'}` : 'deployment: none');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}\n`);
  process.exitCode = 1;
});
