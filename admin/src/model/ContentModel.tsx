import { useQueryClient } from '@tanstack/react-query';

import { CopyButton } from './CopyButton';
import { collectionPrompts, globalPrompts, referenceEdges } from './model';
import { CollectionBlock, PromptList } from './ModelSections';

import './model.css';
import type { ProblemFile } from './problems';
import { useEntryProblems, useGithubPoll, useSchemaChanges } from './useModelData';

import { EditletError, type Issue } from '../../../core/issues';
import { entryRefs, invalidateFiles, useFiles, useSchema, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { issueText } from '../screens/BrokenSchema';
import { PageTop } from '../screens/PageTop';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

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
  if (none) {
    return (
      <p className="editlet-model__status" role="status">
        {pending ? (
          'Checking entries…'
        ) : (
          <>
            <Icon.Check size={16} /> No problems: the schema and every entry are valid.
          </>
        )}
      </p>
    );
  }
  return (
    <section
      aria-labelledby="editlet-model-problems"
      className="editlet-card editlet-card--banner editlet-model__problems"
    >
      <h2 id="editlet-model-problems" className="editlet-model__heading">
        Problems
      </h2>
      {schemaIssues ? (
        <div className="editlet-u-stack editlet-u-gap-1">
          <strong>The schema file has errors. Showing the last valid version.</strong>
          <ul className="editlet-u-stack editlet-u-gap-1">
            {schemaIssues.map((issue, i) => (
              <li key={i}>{issueText(issue)}</li>
            ))}
          </ul>
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
      {pending ? (
        <p className="editlet-u-text-muted editlet-model__status" role="status">
          Checking entries…
        </p>
      ) : null}
    </section>
  );
}

/**
 * The content model, as a guide to changing it with a coding agent: what is wrong (only when something is), prompts
 * for the whole model, then one collapsed block per collection with its fields, references and its own prompts.
 */
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
  const prompts = globalPrompts(schema, schemaPath, { hasProblems: problems.length > 0 || schemaIssues !== null });
  const keys = Object.keys(schema.collections);
  const removed = changes?.removed ?? [];

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
      <p className="editlet-model__intro">
        The schema lives in <code>{schemaPath}</code>. To change it, ask your coding agent: copy a prompt into Claude
        Code, and this page shows the result within seconds.
      </p>
      <ProblemsBlock schemaIssues={schemaIssues} problems={problems} pending={pending} />
      <section aria-labelledby="editlet-model-prompts" className="editlet-u-stack editlet-u-gap-2">
        <h2 id="editlet-model-prompts" className="editlet-model__heading">
          Ask Claude Code
        </h2>
        <PromptList prompts={prompts} idPrefix="editlet-model-prompt" />
      </section>
      <section aria-labelledby="editlet-model-collections" className="editlet-u-stack editlet-u-gap-2">
        <h2 id="editlet-model-collections" className="editlet-model__heading">
          Collections <span className="editlet-model__count">{keys.length}</span>
        </h2>
        {removed.length > 0 ? <p className="editlet-model__removed">Removed: {removed.join(', ')}</p> : null}
        {keys.length === 0 ? (
          <div className="editlet-card editlet-card--empty">
            <p className="editlet-u-text-muted">No collections</p>
          </div>
        ) : (
          <div className="editlet-model__blocks">
            {keys.map((key) => (
              <CollectionBlock
                key={key}
                schema={schema}
                collectionKey={key}
                edges={edges}
                changes={changes}
                count={files.data ? entryRefs(schema, files.data, key).length : undefined}
                prompts={collectionPrompts(schema, schemaPath, key)}
              />
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
