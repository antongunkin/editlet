import { useQuery } from '@tanstack/react-query';

import { DEV_API_BASE } from '../../../core/devApi';
import type { FileActor, FileEvent, FileHistory } from '../../../core/source';
import { relativeTime } from '../github/relativeTime';
import { useBranches, useWorkspace } from '../github/workspace';
import { sourceKey, useSource } from '../source/context';
import { Icon } from '../ui/Icon';

/** The file's git history: GitHub commits of the active branch, or `git log` through the dev API. */
function useFileHistory(path: string, version: string | null) {
  const source = useSource();
  const workspace = useWorkspace();
  return useQuery({
    queryKey: ['file-history', sourceKey(source), path, version],
    enabled: version !== null,
    retry: false,
    queryFn: async (): Promise<FileHistory> => {
      if (workspace) return workspace.source.history(path);
      const res = await fetch(`${DEV_API_BASE}/history?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`history: ${res.status}`);
      return (await res.json()) as FileHistory;
    },
  });
}

function Avatar({ actor }: { actor: FileActor }) {
  const initial = (actor.login ?? actor.name).slice(0, 1).toUpperCase();
  return actor.avatarUrl ? (
    <img className="editlet-meta__avatar" src={actor.avatarUrl} alt="" width={20} height={20} />
  ) : (
    <span className="editlet-meta__avatar editlet-meta__avatar--initial" aria-hidden="true">
      {initial}
    </span>
  );
}

/** A GitHub login as is; a git author name as first name and last initial ("Anton Gunkin" → "Anton G"). */
function shortName(actor: FileActor): string {
  if (actor.login) return actor.login;
  const [first, ...rest] = actor.name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.slice(0, 1)}` : actor.name;
}

function When({ date }: { date: string }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {relativeTime(date)}
    </time>
  );
}

function Who({ event }: { event: FileEvent }) {
  return (
    <span className="editlet-meta__who">
      <Avatar actor={event.actor} />
      <span title={event.actor.name}>{shortName(event.actor)}</span>
      <When date={event.date} />
    </span>
  );
}

/**
 * Collapsible "Meta" block of an entry: its file, who changed it last (with the open pull request of the branch) and who
 * created it. `version` is the file's sha, so the history reloads after a save; `null` for an entry that is not saved yet.
 */
export function EntryMeta({ path, version }: { path: string; version: string | null }) {
  const workspace = useWorkspace();
  const branches = useBranches();
  const history = useFileHistory(path, version);
  const { updated, created, commits } = history.data ?? { updated: null, created: null, commits: 0 };
  const pr =
    workspace && !workspace.onBase ? branches.data?.find((b) => b.name === workspace.active)?.pullRequest : null;
  const historyUrl = workspace
    ? `https://github.com/${workspace.config.owner}/${workspace.config.repo}/commits/${workspace.active}/${path}`
    : null;

  return (
    <details className="editlet-meta">
      <summary className="editlet-meta__summary">
        <Icon.ChevronRight size={14} className="editlet-meta__chevron" />
        <span className="editlet-meta__title">Meta</span>
        {updated ? (
          <span className="editlet-meta__hint">
            Updated <When date={updated.date} /> by {shortName(updated.actor)}
          </span>
        ) : null}
      </summary>
      <dl className="editlet-meta__list">
        <dt>File</dt>
        <dd>
          <code className="editlet-meta__file">{path}</code>
        </dd>
        {version === null ? (
          <>
            <dt>Status</dt>
            <dd>Not saved yet</dd>
          </>
        ) : null}
        {updated ? (
          <>
            <dt>Updated</dt>
            <dd>
              <Who event={updated} />
              {pr ? (
                <a className="editlet-link" href={pr.url} target="_blank" rel="noreferrer">
                  PR #{pr.number} <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </dd>
          </>
        ) : null}
        {created ? (
          <>
            <dt>Created</dt>
            <dd>
              <Who event={created} />
            </dd>
          </>
        ) : null}
        {commits > 0 ? (
          <>
            <dt>Commits</dt>
            <dd>
              {commits}
              {historyUrl ? (
                <a className="editlet-link" href={historyUrl} target="_blank" rel="noreferrer">
                  View history <span aria-hidden="true">↗</span>
                </a>
              ) : null}
            </dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}
