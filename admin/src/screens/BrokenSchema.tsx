import type { Issue } from '../../../core/issues';

/** `<file>: <path>: <message>`, leaving out the empty parts. */
export function issueText(issue: Issue): string {
  const where = [issue.file, issue.path].filter(Boolean).join(': ');
  return where ? `${where}: ${issue.message}` : issue.message;
}

/** Why the schema does not load: title, hint and the issues. */
export function SchemaIssues({ issues }: { issues: Issue[] }) {
  return (
    <>
      <h1 className="editlet-layout__sign-in-title">The schema has errors</h1>
      <p className="editlet-layout__sign-in-subtitle">Fix these problems in the schema file.</p>
      <ul className="editlet-issues" role="alert">
        {issues.map((issue, i) => (
          <li key={i} className="editlet-issues__item">
            {issueText(issue)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** The schema on disk does not load; list why (full page, local mode). */
export function BrokenSchema({ issues }: { issues: Issue[] }) {
  return (
    <div className="editlet-layout__sign-in">
      <div className="editlet-layout__sign-in-inner">
        <SchemaIssues issues={issues} />
      </div>
    </div>
  );
}
