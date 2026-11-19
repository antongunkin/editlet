import { decodeUtf8 } from './entryFile';
import { EditletError, type Issue } from './issues';
import { parseSchemaText, type Schema } from './schema';
import { gitBlobSha } from './sha';
import { validateCommit } from './writes';

export interface FileRef {
  path: string;
  sha: string;
}

export interface FileChange {
  path: string;
  /** New file content; `null` deletes the file. */
  content: Uint8Array | string | null;
}

/** Who did something to a file: a git author (GitHub adds `login` and `avatarUrl` when the author has an account). */
export interface FileActor {
  name: string;
  login?: string;
  avatarUrl?: string;
}

/** One commit that touched a file. */
export interface FileEvent {
  actor: FileActor;
  /** ISO 8601. */
  date: string;
  /** First line of the commit message. */
  message: string;
  /** The commit on GitHub; absent for the local source. */
  url?: string;
}

/** The git history of one file, for the Meta block. `updated` / `created` are `null` while no commit touched it. */
export interface FileHistory {
  updated: FileEvent | null;
  created: FileEvent | null;
  commits: number;
}

/** One version of a file: a commit that touched it, and the file's blob sha after that commit. */
export interface FileVersion extends FileEvent {
  /** The commit id (40 hex digits). */
  commit: string;
  /** The file's git blob sha after this commit; `null` when this commit deleted the file. */
  sha: string | null;
}

/** `listVersions` returns this many versions when no limit is given, and never more than `MAX_FILE_VERSIONS`. */
export const DEFAULT_FILE_VERSIONS = 30;
export const MAX_FILE_VERSIONS = 100;

/**
 * Where content lives (the local dev API or GitHub). Validation and conflict problems (invalid entries, stale shas,
 * an empty message) come back as `issues`; transport and auth failures (network, 401/403, 5xx) reject the promise.
 * A missing file on `readFile` rejects with an `EditletError`.
 */
export interface ContentSource {
  readonly kind: 'local' | 'github';
  listFiles(): Promise<FileRef[]>;
  readFile(path: string): Promise<Uint8Array>;
  /** Atomic: a non-empty `issues` means nothing was written. */
  commit(changes: FileChange[], message: string): Promise<{ issues: Issue[] }>;
  /**
   * Optional, for History (a source without git history leaves both out, and the admin hides History): the commits
   * that touched `path` on this branch (GitHub) or in this checkout (local), newest first, at most `limit` (default
   * `DEFAULT_FILE_VERSIONS`, capped at `MAX_FILE_VERSIONS`). `[]` when none did or there is no git. Renames are not
   * followed: the list starts at the commit that created the file under this path.
   */
  listVersions?(path: string, limit?: number): Promise<FileVersion[]>;
  /**
   * Present with `listVersions`: the file as `commit` (a full id from `listVersions`) left it. Rejects with
   * `EditletError` when it is not a file in that commit; an unknown commit rejects too (GitHub: `GitHubError`).
   */
  readVersion?(path: string, commit: string): Promise<Uint8Array>;
}

/** `limit` for `listVersions`: an integer in 1..`MAX_FILE_VERSIONS`, else the default. */
export function versionLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isInteger(limit) || limit < 1) return DEFAULT_FILE_VERSIONS;
  return Math.min(limit, MAX_FILE_VERSIONS);
}

/** In-memory `ContentSource` (test double for the local and github sources). */
export function createMemorySource(
  files: Record<string, string | Uint8Array>,
  schemaPath = 'cms/schema.json',
): ContentSource {
  const encoder = new TextEncoder();
  const toBytes = (content: string | Uint8Array) =>
    typeof content === 'string' ? encoder.encode(content) : content.slice();
  const store = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(files)) store.set(path, toBytes(content));

  return {
    kind: 'local',
    async listFiles() {
      const refs = await Promise.all([...store].map(async ([path, bytes]) => ({ path, sha: await gitBlobSha(bytes) })));
      return refs.toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async readFile(path) {
      const bytes = store.get(path);
      if (!bytes) throw new EditletError([{ file: path, path: '', message: `File not found: ${path}` }]);
      return bytes.slice();
    },
    async commit(changes, message) {
      const stored = store.get(schemaPath);
      let schema: Schema | null = null;
      if (stored) {
        try {
          schema = parseSchemaText(new TextDecoder().decode(stored), schemaPath);
        } catch {
          schema = null;
        }
      }
      const read = (path: string) => {
        const bytes = store.get(path);
        const decoded = bytes && decodeUtf8(bytes, path);
        return decoded && 'text' in decoded ? decoded.text : undefined;
      };
      const issues = validateCommit(
        { schema, schemaPath, exists: (p) => store.has(p), read, list: () => store.keys() },
        changes,
        message,
      );
      if (issues.length > 0) return { issues };
      for (const change of changes) {
        if (change.content === null) store.delete(change.path);
        else store.set(change.path, toBytes(change.content));
      }
      return { issues: [] };
    },
  };
}
