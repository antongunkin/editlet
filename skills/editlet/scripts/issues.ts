import type { Issue } from '../../../core/issues';

function format(issue: Issue): string {
  if (!issue.file) return `${issue.path || '(schema)'} — ${issue.message}`;
  return issue.path ? `${issue.file}: ${issue.path} — ${issue.message}` : `${issue.file} — ${issue.message}`;
}

/** Prints one issue per line to stderr and marks the process as failed. */
export function reportIssues(issues: Issue[]): void {
  for (const issue of issues) process.stderr.write(`${format(issue)}\n`);
  process.exitCode = 1;
}
