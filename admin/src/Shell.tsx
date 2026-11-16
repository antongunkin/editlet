import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { invalidateFiles, useFiles, useSchema, type SchemaData } from './data/queries';
import { BranchScreen } from './github/BranchScreen';
import { errorText } from './github/errors';
import { useWorkspace, type Workspace } from './github/workspace';
import { MediaScreen } from './media/MediaScreen';
import { ContentModel } from './model/ContentModel';
import { usePreviewNotice } from './preview/PreviewProvider';
import type { Route } from './route';
import { BrokenSchema, issueText, SchemaIssues } from './screens/BrokenSchema';
import { Collection } from './screens/Collection';
import { Entry } from './screens/EntryScreen';
import { Home } from './screens/Home';
import { NotFound } from './screens/NotFound';
import { Placeholder } from './screens/Placeholder';
import { SelectProvider } from './select/SelectProvider';
import { Button } from './ui/Button';
import { Icon } from './ui/Icon';
import { useBridge, useRoute } from './useRoute';
import { WindowFrame } from './window/WindowFrame';

import { EditletError } from '../../core/issues';
import { isValidSlug } from '../../core/paths';
import { GitHubError } from '../../github';

function Screen({ route, schema }: { route: Route; schema: SchemaData }) {
  const workspace = useWorkspace();
  const collections = schema.schema.collections;
  switch (route.kind) {
    case 'home':
      return <Home schema={schema} />;
    case 'collection': {
      const c = collections[route.collection];
      if (!c || !Object.hasOwn(collections, route.collection)) return <NotFound />;
      if (c.singleton) return <Entry key={`${route.collection}/index`} collection={route.collection} slug="index" />;
      return <Collection key={route.collection} collection={route.collection} schema={schema} />;
    }
    case 'entry': {
      const c = Object.hasOwn(collections, route.collection) ? collections[route.collection] : undefined;
      const ok = c && (c.singleton ? route.slug === 'index' : isValidSlug(route.slug));
      if (!ok) return <NotFound />;
      const key = `${route.collection}/${route.slug}`;
      return <Entry key={key} collection={route.collection} slug={route.slug} />;
    }
    case 'schema':
      return <ContentModel schema={schema} />;
    case 'media':
      return <MediaScreen schema={schema} />;
    case 'branch':
      if (workspace) return <BranchScreen name={route.name} />;
      return <Placeholder title="Branch preview" text="Branch preview is available in production mode" />;
    case 'unknown':
      return <NotFound />;
  }
}

const issuesOf = (error: Error) =>
  error instanceof EditletError ? error.issues : [{ path: '', message: error.message }];

/**
 * The file list failed (dev server poll, or GitHub), or the schema on disk broke. An open screen keeps the last good
 * data, so unsaved edits stay. `onRetry` (GitHub mode, which does not poll) adds "Try again" to a files error.
 */
function RefreshBanner({
  filesError,
  schemaError,
  onRetry,
}: {
  filesError: string | null;
  schemaError: Error | null;
  onRetry?: () => void;
}) {
  if (!filesError && !schemaError) return null;
  return (
    <div className="editlet-card editlet-card--banner editlet-shell__banner" role="alert">
      <Icon.Alert />
      {filesError ? (
        <>
          <span className="editlet-u-flex-1">{filesError}</span>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </>
      ) : (
        <div className="editlet-u-flex-1 editlet-u-stack editlet-u-gap-1">
          <strong>The schema has errors</strong>
          <ul className="editlet-u-stack editlet-u-gap-1">
            {issuesOf(schemaError!).map((issue, i) => (
              <li key={i}>{issueText(issue)}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The file list failed because the branch restored from storage is gone; the workspace is about to fall back. */
function isRestoredBranchGone(workspace: Workspace | null, error: Error | null): boolean {
  return workspace?.restoring === true && error instanceof GitHubError && error.code === 'not_found';
}

function filesErrorText(error: Error, workspace: Workspace | null): string {
  if (!workspace) return `Can't reach the dev server: ${error.message}`;
  return `Can't load from GitHub: ${errorText(error, { repo: `${workspace.config.owner}/${workspace.config.repo}` })}`;
}

/** The window chrome around the connection and branch banners and the routed screen. */
export function Shell() {
  const { route } = useRoute();
  const { status } = useBridge();
  const workspace = useWorkspace();
  const previewNotice = usePreviewNotice();
  const queryClient = useQueryClient();
  const files = useFiles();
  const schema = useSchema();
  const fallingBack = isRestoredBranchGone(workspace, files.error);
  const filesError = files.error && !fallingBack ? files.error : null;
  // Local mode: a schema that does not load is a full page. GitHub mode keeps the shell (the branch chip, to leave a
  // broken branch): a failed file list shows the banner, a broken schema file its issues in `<main>`.
  if (!schema.data && schema.error && !workspace) return <BrokenSchema issues={issuesOf(schema.error)} />;

  let main: ReactNode = null;
  // Keyed by the workspace's switches: a branch switch replaces the open screen (and its form) with the new branch's.
  if (schema.data) main = <Screen key={workspace?.switches ?? 0} route={route} schema={schema.data} />;
  else if (schema.error && schema.error !== files.error)
    main = (
      <section className="editlet-screen">
        <SchemaIssues issues={issuesOf(schema.error)} />
      </section>
    );
  else if (!filesError)
    main = (
      <p className="editlet-u-text-muted" role="status">
        Loading…
      </p>
    );

  const banners = (
    <>
      {status === 'disconnected' ? (
        <div className="editlet-card editlet-card--banner editlet-shell__banner" role="status">
          <Icon.Alert />
          <span className="editlet-u-flex-1">Not connected to the site</span>
        </div>
      ) : null}
      {workspace?.fallbackNotice ? (
        <div className="editlet-card editlet-card--banner editlet-shell__banner" role="status">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{workspace.fallbackNotice}</span>
        </div>
      ) : null}
      {previewNotice ? (
        <div className="editlet-card editlet-card--banner editlet-shell__banner" role="status">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{previewNotice}</span>
        </div>
      ) : null}
      {schema.data || workspace ? (
        <RefreshBanner
          filesError={filesError ? filesErrorText(filesError, workspace) : null}
          schemaError={schema.refreshError}
          onRetry={workspace ? () => void invalidateFiles(queryClient) : undefined}
        />
      ) : null}
    </>
  );

  // The window chrome (in the loader's iframe) holds the navigation, the branch and the account.
  return (
    <SelectProvider>
      <WindowFrame schema={schema.data} route={route}>
        {banners}
        <main className="editlet-page-content">{main}</main>
      </WindowFrame>
    </SelectProvider>
  );
}
