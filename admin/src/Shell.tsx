import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ChangesProvider } from './changes/ChangesProvider';
import { invalidateFiles, useFiles, useSchema, type SchemaData } from './data/queries';
import { BranchScreen, BranchUnavailableScreen } from './github/BranchScreen';
import { errorText } from './github/errors';
import { useWorkspace, type Workspace } from './github/workspace';
import { MediaScreen } from './media/MediaScreen';
import { ContentModel } from './model/ContentModel';
import { usePreviewNotice } from './preview/PreviewProvider';
import type { Route } from './route';
import { AllContent } from './screens/AllContent';
import { BrokenSchema, BrokenSchemaScreen, issueText } from './screens/BrokenSchema';
import { Collection } from './screens/Collection';
import { Entry } from './screens/EntryScreen';
import { Loading } from './screens/GateLoading';
import { Home } from './screens/Home';
import { NotFound } from './screens/NotFound';
import { SelectProvider } from './select/SelectProvider';
import { Banner, BannerRegion } from './ui/primitives/banner';
import { Button } from './ui/primitives/button';
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
    case 'content':
      return <AllContent schema={schema} />;
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
      return <BranchUnavailableScreen title="Branch preview" text="Branch preview is available in production mode." />;
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
  return (
    <BannerRegion assertive className="not-empty:mx-4 not-empty:mt-3">
      {filesError || schemaError ? (
        <Banner
          tone="danger"
          action={
            filesError && onRetry ? (
              <Button size="md" onClick={onRetry}>
                Try again
              </Button>
            ) : undefined
          }
        >
          {filesError ? (
            filesError
          ) : (
            <div className="flex flex-col gap-1">
              <strong>The schema has errors</strong>
              <ul className="flex flex-col gap-1">
                {issuesOf(schemaError!).map((issue, i) => (
                  <li key={i}>{issueText(issue)}</li>
                ))}
              </ul>
            </div>
          )}
        </Banner>
      ) : null}
    </BannerRegion>
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

/**
 * The window chrome around the connection and branch banners and the routed screen. `overlay`: a modal that lives
 * inside the window's sheets (*Sign in again*, GitHubApp.tsx), so it pushes the screen back like the others.
 */
export function Shell({ overlay }: { overlay?: ReactNode } = {}) {
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
    main = <BrokenSchemaScreen issues={issuesOf(schema.error)} status />;
  else main = <Loading loading={!filesError} status />;

  const banners = (
    <>
      <BannerRegion className="not-empty:mx-4 not-empty:mt-3">
        {status === 'disconnected' ? <Banner tone="danger">Not connected to the site</Banner> : null}
        {workspace?.fallbackNotice ? <Banner tone="branch">{workspace.fallbackNotice}</Banner> : null}
        {previewNotice ? <Banner tone="branch">{previewNotice}</Banner> : null}
      </BannerRegion>
      <RefreshBanner
        filesError={(schema.data || workspace) && filesError ? filesErrorText(filesError, workspace) : null}
        schemaError={schema.data || workspace ? schema.refreshError : null}
        onRetry={workspace ? () => void invalidateFiles(queryClient) : undefined}
      />
    </>
  );

  // The window (in the loader's iframe); each screen draws its own header and bottom bar, with the banners.
  return (
    <SelectProvider>
      <WindowFrame banners={banners}>
        <ChangesProvider>
          <main>{main}</main>
          {overlay}
        </ChangesProvider>
      </WindowFrame>
    </SelectProvider>
  );
}
