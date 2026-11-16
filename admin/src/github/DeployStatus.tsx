import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { DeploymentInfo, GitHubSource } from '../../../github';
import { withEditletRoute } from '../../../loader/protocol';

const POLL_MS = 10_000;

const NO_PREVIEW =
  "No preview yet. The build may still be starting, or the host doesn't report deployments to GitHub. Review the diff below.";

type Phase = 'none' | 'ready' | 'building' | 'failed';

function phaseOf(deployment: DeploymentInfo | null, expectSha: string): Phase {
  if (deployment === null) return 'none';
  if (deployment.state === 'failure' || deployment.state === 'error') return 'failed';
  if (deployment.state === 'success' && deployment.sha === expectSha) return 'ready';
  return 'building';
}

/**
 * The newest GitHub Deployment of the head of `ref` (`['deployment', ref]`). Polls every 10 s while there is none,
 * while it is not final (success, failure, error), and while a success is for another sha than `expectSha`.
 */
export function useDeployment(
  source: GitHubSource,
  ref: string,
  expectSha: string,
): UseQueryResult<DeploymentInfo | null> {
  return useQuery({
    queryKey: ['deployment', ref],
    queryFn: () => source.latestDeployment(ref),
    refetchInterval: (query) => {
      const phase = query.state.data === undefined ? 'none' : phaseOf(query.state.data, expectSha);
      return phase === 'ready' || phase === 'failed' ? false : POLL_MS;
    },
  });
}

/** `url` if it is an `http(s)` URL, else `null`: deployment statuses come from any app that can write them. */
function webUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="editlet-link editlet-deploy-status__link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/**
 * The branch preview card: "Open preview" opens the admin's `previewRoute` on the preview URL of `expectSha` (the
 * reviewed head), under the site's query parameter `param` (default `editlet`). `undefined` = still loading.
 */
export function DeployStatus({
  deployment,
  expectSha,
  previewRoute,
  param,
}: {
  deployment: DeploymentInfo | null | undefined;
  expectSha: string;
  previewRoute: string;
  param?: string;
}) {
  let text: string;
  let link: ReactNode = null;

  if (deployment === undefined) {
    text = 'Checking deployments…';
  } else {
    const url = webUrl(deployment?.url);
    const logUrl = webUrl(deployment?.logUrl);
    switch (phaseOf(deployment, expectSha)) {
      case 'none':
        text = NO_PREVIEW;
        break;
      case 'failed':
        text = 'Preview build failed';
        if (logUrl) link = <ExternalLink href={logUrl}>Build log</ExternalLink>;
        break;
      case 'ready':
        text = 'Preview ready';
        if (url) link = <ExternalLink href={withEditletRoute(url, previewRoute, param)}>Open preview</ExternalLink>;
        break;
      case 'building':
        text = 'Build in progress';
        if (url) link = <ExternalLink href={withEditletRoute(url, previewRoute, param)}>Older preview</ExternalLink>;
        break;
    }
  }

  return (
    <section className="editlet-card editlet-deploy-status" aria-label="Preview">
      <div className="editlet-card__header">
        <h2 className="editlet-card__title">Preview</h2>
      </div>
      <div className="editlet-card__content editlet-deploy-status__body" aria-live="polite">
        <span>{text}</span>
        {link}
      </div>
    </section>
  );
}
