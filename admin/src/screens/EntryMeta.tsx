import { useQuery } from '@tanstack/react-query';

import { DEV_API_BASE } from '../../../core/devApi';
import type { FileActor, FileEvent, FileHistory } from '../../../core/source';
import { relativeTime } from '../github/relativeTime';
import { useBranches, useWorkspace } from '../github/workspace';
import { sourceKey, useSource } from '../source/context';
import { cn } from '../ui/cn';

type Source = ReturnType<typeof useSource>;
type Workspace = ReturnType<typeof useWorkspace>;

/** Query options for a file's git history: GitHub commits of the active branch, or `git log` through the dev API. */
export function fileHistoryQuery(source: Source, workspace: Workspace, path: string, version: string | null) {
  return {
    queryKey: ['file-history', sourceKey(source), path, version] as const,
    enabled: version !== null,
    retry: false,
    queryFn: async (): Promise<FileHistory> => {
      if (workspace) return workspace.source.history(path);
      const res = await fetch(`${DEV_API_BASE}/history?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error(`history: ${res.status}`);
      return (await res.json()) as FileHistory;
    },
  };
}

/** The file's git history (`fileHistoryQuery`). */
function useFileHistory(path: string, version: string | null) {
  return useQuery(fileHistoryQuery(useSource(), useWorkspace(), path, version));
}

export function Avatar({ actor }: { actor: FileActor }) {
  const initial = (actor.login ?? actor.name).slice(0, 1).toUpperCase();
  return actor.avatarUrl ? (
    <img className="size-5 flex-none rounded-full object-cover" src={actor.avatarUrl} alt="" width={20} height={20} />
  ) : (
    <span
      className="inline-grid size-5 flex-none place-items-center rounded-full bg-accent text-xs font-semibold"
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

/** A GitHub login as is; a git author name as first name and last initial ("Anton Gunkin" → "Anton G"). */
export function shortName(actor: FileActor): string {
  if (actor.login) return actor.login;
  const [first, ...rest] = actor.name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last.slice(0, 1)}` : actor.name;
}

export function When({ date }: { date: string }) {
  return (
    <time dateTime={date} title={new Date(date).toLocaleString()}>
      {relativeTime(date)}
    </time>
  );
}

function Who({ event }: { event: FileEvent }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Avatar actor={event.actor} />
      <span title={event.actor.name}>{shortName(event.actor)}</span>
      <span className="text-tray-muted-foreground">
        <When date={event.date} />
      </span>
    </span>
  );
}

/**
 * The entry's file history: who changed it last (with the open pull request of the branch), who created it, how many
 * commits. `version` is the file's sha, so the history reloads after a save; `null` for an entry that is not saved yet.
 */
export function useEntryHistory(path: string, version: string | null) {
  const workspace = useWorkspace();
  const branches = useBranches();
  const history = useFileHistory(path, version);
  const { updated, created, commits } = history.data ?? { updated: null, created: null, commits: 0 };
  const pr =
    workspace && !workspace.onBase ? branches.data?.find((b) => b.name === workspace.active)?.pullRequest : null;
  const historyUrl = workspace
    ? `https://github.com/${workspace.config.owner}/${workspace.config.repo}/commits/${workspace.active}/${path}`
    : null;
  return { path, version, updated, created, commits, pr: pr ?? null, historyUrl };
}

export type EntryHistory = ReturnType<typeof useEntryHistory>;

/** The line under the entry's title (FigCraft `BigTitle`): *Updated 5d ago by Dana K*. */
export function EntryUpdated({ history }: { history: EntryHistory }) {
  if (!history.updated) return null;
  return (
    <span>
      Updated <When date={history.updated.date} /> by {shortName(history.updated.actor)}
    </span>
  );
}

// The details are on a sheet (the tray): its muted text is `tray-muted-foreground`, 4.5 : 1 there.
const term = 'm-0 text-sm font-medium text-tray-muted-foreground';
const detail = 'm-0 flex flex-wrap items-center gap-2 text-base';
// A 44 px tall target (the row grows to it), its ring outside the text.
const external =
  'inline-flex min-h-11 items-center rounded-md text-foreground underline underline-offset-2 outline-none focused:outline-2 focused:outline-offset-2 focused:outline-ring';

/** The entry's details (⋯ → Details): its file, who changed and created it, its commits with a link to the history. */
export function EntryDetails({ history }: { history: EntryHistory }) {
  const { path, version, updated, created, commits, pr, historyUrl } = history;
  return (
    <dl className="m-0 flex flex-col gap-1 px-4 pb-4" aria-label="Details">
      <dt className={term}>File</dt>
      <dd className={detail}>
        <code className="font-mono text-sm break-all">{path}</code>
      </dd>
      {version === null ? (
        <>
          <dt className={cn(term, 'mt-3')}>Status</dt>
          <dd className={detail}>Not saved yet</dd>
        </>
      ) : null}
      {updated ? (
        <>
          <dt className={cn(term, 'mt-3')}>Updated</dt>
          <dd className={detail}>
            <Who event={updated} />
            {pr ? (
              <a className={external} href={pr.url} target="_blank" rel="noreferrer">
                PR #{pr.number} <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </dd>
        </>
      ) : null}
      {created ? (
        <>
          <dt className={cn(term, 'mt-3')}>Created</dt>
          <dd className={detail}>
            <Who event={created} />
          </dd>
        </>
      ) : null}
      {commits > 0 ? (
        <>
          <dt className={cn(term, 'mt-3')}>Commits</dt>
          <dd className={detail}>
            {commits}
            {historyUrl ? (
              <a className={external} href={historyUrl} target="_blank" rel="noreferrer">
                View history <span aria-hidden="true">↗</span>
              </a>
            ) : null}
          </dd>
        </>
      ) : null}
    </dl>
  );
}
