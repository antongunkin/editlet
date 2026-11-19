import { parseEntryPath } from './paths';
import { isRefPath, type GitConfig, type Schema } from './schema';

/** How branches, commits and pull requests are named: `git` of the schema with every default filled in. */
export interface GitStyle {
  branchPrefix: string;
  commitMessage: string;
  pullRequest: { title: string; labels: string[]; draft: boolean };
}

export const DEFAULT_BRANCH_PREFIX = 'editlet/';
export const DEFAULT_COMMIT_MESSAGE = '{Action} {target}';
export const DEFAULT_PULL_REQUEST_TITLE = 'Update {branch}';
export const DEFAULT_LABELS: readonly string[] = ['editlet'];
/** Git trailer key that tells who made a commit: `Editlet-Source: admin` or `Editlet-Source: agent`. */
export const SOURCE_TRAILER = 'Editlet-Source';
/** Editlet owns only the text between these markers in a pull request body. */
export const PULL_REQUEST_BODY_START = '<!-- editlet:start -->';
export const PULL_REQUEST_BODY_END = '<!-- editlet:end -->';

/** The style of a schema's `git` section; `null` (no or broken schema) gives the defaults. */
export function resolveGitStyle(git?: GitConfig | null): GitStyle {
  return {
    branchPrefix: git?.branchPrefix ?? DEFAULT_BRANCH_PREFIX,
    commitMessage: git?.commitMessage ?? DEFAULT_COMMIT_MESSAGE,
    pullRequest: {
      title: git?.pullRequest?.title ?? DEFAULT_PULL_REQUEST_TITLE,
      labels: [...(git?.pullRequest?.labels ?? DEFAULT_LABELS)],
      draft: git?.pullRequest?.draft ?? false,
    },
  };
}

/** `<prefix><name>` where the whole name is valid ref segments and `<name>` is not empty. */
export function isEditletBranchName(name: string, prefix: string = DEFAULT_BRANCH_PREFIX): boolean {
  return name.length > prefix.length && name.startsWith(prefix) && isRefPath(name);
}

export type CommitAction = 'create' | 'update' | 'delete' | 'upload' | 'rename';

/** What a commit is about; fills the `commitMessage` placeholders. */
export interface CommitSubject {
  action: CommitAction;
  collection: string;
  slug: string;
  target: string;
}

/** One entry. */
export function entrySubject(action: CommitAction, collection: string, slug: string): CommitSubject {
  return { action, collection, slug, target: `${collection}/${slug}` };
}

/** An entry's new slug (its references and images move in the same commit): `Rename post/old → post/new`. */
export function renameSubject(collection: string, from: string, to: string): CommitSubject {
  return { action: 'rename', collection, slug: to, target: `${collection}/${from} → ${collection}/${to}` };
}

/** Several entries in one commit (for example alt text in every entry that uses an image). */
export function entriesSubject(action: CommitAction, entries: { collection: string; slug: string }[]): CommitSubject {
  const [first, ...rest] = entries;
  if (!first) return { action, collection: 'content', slug: '', target: 'content' };
  if (rest.length === 0) return entrySubject(action, first.collection, first.slug);
  const collection = rest.every((e) => e.collection === first.collection) ? first.collection : 'content';
  const more = ` +${rest.length}`;
  return { action, collection, slug: `${first.slug}${more}`, target: `${first.collection}/${first.slug}${more}` };
}

/**
 * Files that are not entries (images). The collection is the folder under `contentDir` when it is a collection key,
 * else `media`; one file is named, several are counted.
 */
export function filesSubject(schema: Schema, action: CommitAction, paths: string[]): CommitSubject {
  const collectionOf = (path: string): string => {
    const rel = path.startsWith(`${schema.contentDir}/`) ? path.slice(schema.contentDir.length + 1) : '';
    const top = rel.split('/')[0] ?? '';
    return rel.includes('/') && Object.hasOwn(schema.collections, top) ? top : 'media';
  };
  const collections = new Set(paths.map(collectionOf));
  const collection = collections.size === 1 ? [...collections][0]! : 'media';
  if (paths.length === 1) {
    const name = paths[0]!.split('/').pop()!;
    return { action, collection, slug: name, target: `${collection}/${name}` };
  }
  const count = `${paths.length} images`;
  return { action, collection, slug: count, target: count };
}

/** The schema file, alone or with the entries it rewrites. */
export function schemaSubject(entries = 0): CommitSubject {
  const more = entries > 0 ? ` +${entries}` : '';
  return {
    action: 'update',
    collection: 'schema',
    slug: `schema.json${more}`,
    target: entries > 0 ? `schema +${entries} entries` : 'schema',
  };
}

type FileStatus = 'added' | 'modified' | 'removed';
const ACTION_OF: Record<FileStatus, CommitAction> = { added: 'create', modified: 'update', removed: 'delete' };

/**
 * The subject of a commit from its changed files (for example `git diff --cached --name-status`): the schema with the
 * entries it rewrites, else the entries, else the other files (images). One action when every file agrees, else
 * `update`; new images are an `upload`.
 */
export function changesSubject(
  schema: Schema,
  schemaPath: string,
  files: { path: string; status: FileStatus }[],
): CommitSubject {
  const entries = files.flatMap((f) => {
    const ref = parseEntryPath(schema, f.path);
    return ref ? [{ ...ref, status: f.status }] : [];
  });
  if (files.some((f) => f.path === schemaPath)) return schemaSubject(entries.length);
  const one = (statuses: FileStatus[]): FileStatus | null =>
    statuses.every((s) => s === statuses[0]) ? (statuses[0] ?? null) : null;
  if (entries.length > 0) {
    const status = one(entries.map((e) => e.status));
    return entriesSubject(status ? ACTION_OF[status] : 'update', entries);
  }
  const status = one(files.map((f) => f.status));
  const action = status === 'added' ? 'upload' : status ? ACTION_OF[status] : 'update';
  return filesSubject(
    schema,
    action,
    files.map((f) => f.path),
  );
}

function fill(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{([A-Za-z]+)\}/g, (whole, key: string) => (Object.hasOwn(values, key) ? values[key]! : whole))
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatCommitMessage(style: GitStyle, subject: CommitSubject): string {
  const Action = subject.action.charAt(0).toUpperCase() + subject.action.slice(1);
  return fill(style.commitMessage, { ...subject, Action });
}

/**
 * The message plus a blank line and `Editlet-Source: <source>`. A `body` (the editor's note) goes between them, trimmed,
 * without lines that would read as the source trailer; an empty body adds nothing.
 */
export function withTrailer(message: string, source: 'admin' | 'agent', body = ''): string {
  const note = body
    .split(/\r\n|\r|\n/)
    .filter((line) => !line.trimStart().toLowerCase().startsWith(`${SOURCE_TRAILER.toLowerCase()}:`))
    .join('\n')
    .trim();
  return `${message}\n\n${note === '' ? '' : `${note}\n\n`}${SOURCE_TRAILER}: ${source}`;
}

/** The branch name without the prefix (the `?editlet=branch:<name>` value). */
export function branchShortName(style: GitStyle, branch: string): string {
  return branch.startsWith(style.branchPrefix) ? branch.slice(style.branchPrefix.length) : branch;
}

export function formatPullRequestTitle(style: GitStyle, values: { branch: string; login: string }): string {
  return fill(style.pullRequest.title, { ...values, name: branchShortName(style, values.branch) });
}

/** One line of the pull request body: an entry, or another CMS file by path. */
export interface PullRequestChange {
  /** The collection label (`Post`), or `null` for a file that is not an entry. */
  label: string | null;
  /** Slug for an entry, path for another file. */
  name: string;
  status: 'created' | 'updated' | 'deleted';
}

const CHANGE_STATUS = { added: 'created', modified: 'updated', removed: 'deleted' } as const;

/** The changed CMS files of a branch as body lines: entries with their collection label first, then other files. */
export function describeChanges(
  schema: Schema | null,
  files: { path: string; status: 'added' | 'modified' | 'removed' }[],
): PullRequestChange[] {
  const entries: PullRequestChange[] = [];
  const others: PullRequestChange[] = [];
  for (const file of files) {
    const status = CHANGE_STATUS[file.status];
    const ref = schema ? parseEntryPath(schema, file.path) : null;
    if (ref) entries.push({ label: schema!.collections[ref.collection]!.label, name: ref.slug, status });
    else others.push({ label: null, name: file.path, status });
  }
  return [...entries, ...others];
}

const MAX_BODY_LINES = 30;

/** The Editlet part of a pull request body, between the markers. */
export function pullRequestBlock(input: {
  login: string;
  changes: PullRequestChange[];
  reviewUrl: string | null;
}): string {
  const lines = input.changes
    .slice(0, MAX_BODY_LINES)
    .map((c) => `- ${c.label === null ? `\`${c.name}\`` : `${c.label} · ${c.name}`} — ${c.status}`);
  if (input.changes.length > MAX_BODY_LINES) lines.push(`- …and ${input.changes.length - MAX_BODY_LINES} more`);
  return [
    PULL_REQUEST_BODY_START,
    `Opened in Editlet by @${input.login}.`,
    '',
    '**Changes**',
    ...(lines.length > 0 ? lines : ['- none yet']),
    ...(input.reviewUrl ? ['', `Review on the site: ${input.reviewUrl}`] : []),
    PULL_REQUEST_BODY_END,
  ].join('\n');
}

/**
 * `current` with its Editlet part replaced by `block`. An empty body becomes `block`. `null` when the body has no
 * complete pair of markers (someone removed them: the body is theirs now).
 */
export function mergePullRequestBody(current: string | null, block: string): string | null {
  if (current === null || current.trim() === '') return block;
  const start = current.indexOf(PULL_REQUEST_BODY_START);
  const end = current.indexOf(PULL_REQUEST_BODY_END, start);
  if (start < 0 || end < 0) return null;
  return current.slice(0, start) + block + current.slice(end + PULL_REQUEST_BODY_END.length);
}
