import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { DeploymentInfo, GitHubSource } from '../../../github';
import { withEditletRoute } from '../../../loader/protocol';
import { StepRow, type StepKind } from '../ui/parts/rows';
import { Icon } from '../ui/primitives/icon';

const POLL_MS = 10_000;

/** The host may still be starting the build, or it does not report deployments to GitHub: the changes are below. */
const NO_PREVIEW = 'No preview yet';

type Phase = 'none' | 'ready' | 'building' | 'failed';

function phaseOf(deployment: DeploymentInfo | null, expectSha: string): Phase {
  if (deployment === null) return 'none';
  if (deployment.state === 'failure' || deployment.state === 'error') return 'failed';
  if (deployment.state === 'success' && deployment.sha === expectSha) return 'ready';
  return 'building';
}

/**
 * The newest GitHub Deployment of the head of `ref` (`['deployment', ref]`). Polls every 10 s while there is none,
 * while it is not final (success, failure, error), and while a success is for another sha than `expectSha`. Nothing
 * while `enabled` is false (the branch has not loaded, failed to load, or is gone).
 */
export function useDeployment(
  source: GitHubSource,
  ref: string,
  expectSha: string,
  enabled = true,
): UseQueryResult<DeploymentInfo | null> {
  return useQuery({
    queryKey: ['deployment', ref],
    enabled,
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

/** A link in a step's line: opens in a new tab, underlined (not told apart by colour alone). */
function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="rounded-md font-medium text-foreground underline underline-offset-2 outline-none focused:inset-ring-2 focused:inset-ring-ring"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <Icon name="arrow-up-right" size={16} className="ml-0.5 inline align-text-bottom" />
    </a>
  );
}

/** A step's words, then its link after a middle dot. */
const line = (text: string, link: ReactNode) =>
  link ? (
    <>
      {text} · {link}
    </>
  ) : (
    text
  );

/**
 * The *Preview* step of the branch screen (FigCraft *Publish · preview building*, *· preview failed*): its mark and its
 * line. *Open preview* opens the admin's `previewRoute` on the preview URL of `expectSha` (the reviewed head), under
 * the site's query parameter `param` (default `editlet`). `undefined` = still loading.
 */
export function PreviewStep({
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
  let kind: StepKind;
  let sub: ReactNode;

  if (deployment === undefined) {
    kind = 'busy';
    sub = 'Checking deployments…';
  } else {
    const url = webUrl(deployment?.url);
    const logUrl = webUrl(deployment?.logUrl);
    switch (phaseOf(deployment, expectSha)) {
      case 'none':
        kind = 'todo';
        sub = NO_PREVIEW;
        break;
      case 'failed':
        kind = 'fail';
        sub = (
          <span className="text-tint-danger-foreground">
            {line('Preview build failed', logUrl ? <ExternalLink href={logUrl}>Build log</ExternalLink> : null)}
          </span>
        );
        break;
      case 'ready':
        kind = 'done';
        sub = line(
          'Preview ready',
          url ? <ExternalLink href={withEditletRoute(url, previewRoute, param)}>Open preview</ExternalLink> : null,
        );
        break;
      case 'building':
        kind = 'busy';
        sub = line(
          'Build in progress',
          url ? <ExternalLink href={withEditletRoute(url, previewRoute, param)}>Older preview</ExternalLink> : null,
        );
        break;
    }
  }

  return <StepRow title="Preview" sub={<span aria-live="polite">{sub}</span>} kind={kind} />;
}
