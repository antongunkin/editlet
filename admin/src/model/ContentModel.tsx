import { useQueryClient } from '@tanstack/react-query';

import { CopyButton } from './CopyButton';
import { chatPrompts, referenceEdges } from './model';
import { CollectionCard, CollectionsTable } from './ModelSections';

import './model.css';
import type { ProblemFile } from './problems';
import { useEntryProblems, useGithubPoll, useSchemaChanges } from './useModelData';

import { EditletError, type Issue } from '../../../core/issues';
import { entryRefs, invalidateFiles, useFiles, useSchema, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { issueText } from '../screens/BrokenSchema';
import { PageTop } from '../screens/PageTop';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';

const issueLine = (issue: Issue) => (issue.path ? `${issue.path} — ${issue.message}` : issue.message);

function ProblemsBlock({
  schemaIssues,
  problems,
  pending,
}: {
  schemaIssues: Issue[] | null;
  problems: ProblemFile[];
  pending: boolean;
}) {
  const none = !schemaIssues && problems.length === 0;
  return (
    <section aria-labelledby="editlet-model-problems" className="editlet-u-stack editlet-u-gap-2">
      <h2 id="editlet-model-problems" className="editlet-model__heading">
        Problems
      </h2>
      {schemaIssues ? (
        <div className="editlet-card editlet-card--banner">
          <div className="editlet-u-stack editlet-u-gap-1">
            <strong>The schema file has errors. Showing the last valid version.</strong>
            <ul className="editlet-u-stack editlet-u-gap-1">
              {schemaIssues.map((issue, i) => (
                <li key={i}>{issueText(issue)}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
      {problems.map((p) => (
        <div key={p.file} className="editlet-u-stack editlet-u-gap-1">
          {p.entry ? (
            <RouteLink
              to={{ kind: 'entry', collection: p.entry.collection, slug: p.entry.slug }}
              className="editlet-link editlet-u-mono editlet-u-word-break-all editlet-model__problem-file"
            >
              {p.file}
            </RouteLink>
          ) : (
            <span className="editlet-u-mono editlet-u-word-break-all editlet-model__problem-file">{p.file}</span>
          )}
          <ul className="editlet-model__issues">
            {p.issues.map((issue, i) => (
              <li key={i}>{issueLine(issue)}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="editlet-u-text-muted editlet-model__status" role="status">
        {pending ? 'Checking entries…' : none ? 'No problems' : ''}
      </p>
    </section>
  );
}

function PromptsCard({ prompts }: { prompts: ReturnType<typeof chatPrompts> }) {
  return (
    <section aria-labelledby="editlet-model-prompts">
      <Card>
        <CardHeader>
          <h2 id="editlet-model-prompts" className="editlet-model__heading">
            Ask Claude Code
          </h2>
        </CardHeader>
        <CardContent>
          <ul className="editlet-model__prompts">
            {prompts.map((p) => (
              <li key={p.id} className="editlet-model__prompt">
                <div className="editlet-u-row editlet-u-gap-2">
                  <strong id={`editlet-model-prompt-${p.id}`} className="editlet-u-flex-1">
                    {p.title}
                  </strong>
                  <CopyButton text={p.text} describedBy={`editlet-model-prompt-${p.id}`} />
                </div>
                <code className="editlet-model__prompt-text">{p.text}</code>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

/** The content model: problems, a collections overview, one card per collection and copyable Claude Code prompts. */
export function ContentModel({ schema: data }: { schema: SchemaData }) {
  useGithubPoll();
  const client = useQueryClient();
  const files = useFiles();
  const { refreshError } = useSchema();
  const { problems, pending } = useEntryProblems(data);
  const { changes, updatedAt } = useSchemaChanges(data.schema);
  const { schema, schemaPath } = data;

  const schemaIssues = refreshError
    ? refreshError instanceof EditletError
      ? refreshError.issues
      : [{ path: '', message: refreshError.message }]
    : null;
  const edges = referenceEdges(schema);
  const prompts = chatPrompts(schema, schemaPath, { hasProblems: problems.length > 0 || schemaIssues !== null });

  return (
    <section className="editlet-screen editlet-model">
      <PageTop title="Content model">
        {updatedAt ? (
          <span className="editlet-u-text-muted editlet-u-text-sm">Updated {updatedAt.toLocaleTimeString()}</span>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void invalidateFiles(client)}>
          Refresh
        </Button>
        <CopyButton text={JSON.stringify(schema, null, 2)} label="Copy schema" />
      </PageTop>
      <ProblemsBlock schemaIssues={schemaIssues} problems={problems} pending={pending} />
      <section aria-labelledby="editlet-model-collections" className="editlet-u-stack editlet-u-gap-2">
        <h2 id="editlet-model-collections" className="editlet-model__heading">
          Collections
        </h2>
        <CollectionsTable schema={schema} files={files.data} removed={changes?.removed ?? []} />
      </section>
      {Object.keys(schema.collections).map((key) => (
        <CollectionCard
          key={key}
          schema={schema}
          collectionKey={key}
          edges={edges}
          changes={changes}
          count={files.data ? entryRefs(schema, files.data, key).length : undefined}
        />
      ))}
      <PromptsCard prompts={prompts} />
    </section>
  );
}
