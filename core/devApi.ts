import type { Issue } from './issues';
import type { FileRef, FileVersion } from './source';

export const DEV_API_BASE = '/__editlet';

// GET    /__editlet/files                 → 200 { files: FileRef[] }   (contentDir tree + the schema file; sha = git blob sha1 of content)
// GET    /__editlet/file?path=<repo path> → 200 raw bytes, Content-Type from extension
// PUT    /__editlet/file?path=<repo path> → 204 | 412 | 422 { issues: Issue[] }   body = raw bytes
// DELETE /__editlet/file?path=<repo path> → 204 | 404 | 412 | 422 { issues: Issue[] }
// POST   /__editlet/commit                → 204 | 400 | 409 | 422 { issues: Issue[] }   body = DevCommitRequest (JSON)
// GET    /__editlet/git                   → 200 DevGitResponse   (read-only: the checkout's branch, its uncommitted content
//                                            files (count and list) and the project id; no paths outside contentDir)
// GET    /__editlet/history?path=<path>   → 200 FileHistory      (read-only: `git log` of one file; empty without git)
// GET    /__editlet/versions?path=<path>[&limit=<n>] → 200 DevVersionsResponse (read-only: `git log` of one file,
//                                            newest first, with the file's blob sha per commit; [] without git)
// GET    /__editlet/version?path=<path>&commit=<id>  → 200 raw bytes | 404   (read-only: the file as that commit left it)
//
// Notes:
// - The listing includes every non-hidden file under contentDir, also stray files that are neither entries nor
//   images; those are not readable or deletable (GET / DELETE → 400), so the admin can show them but not open them.
// - DELETE of the schema file → 400. While the schema on disk is broken, only the schema file can be read or
//   written; other routes answer 500 with the schema's issues.
// - PUT / DELETE take an optional `If-Match: <sha>` (quoted or bare): when the file's current sha differs, or the
//   file is missing, the answer is 412 and nothing changes.
// - POST /commit applies a batch atomically: every path must be writable (else 400); every `sha` given must match
//   (`null` = the file must not exist; else 409); `validateChanges` and an empty message give 422. Then all writes
//   are staged to temp files and renamed into place; if staging fails nothing is applied. Deletes run last.
// - Deletes and schema changes re-validate every entry, so breaking a reference or an image is a 422.
// - Only reachable in dev, on localhost / 127.0.0.1 / [::1] / *.localhost (plus configured hosts), same-origin.
//   Adapters must build `req.url` from the real Host header (the host check reads it from the URL). The admin must
//   not run in a sandboxed (opaque-origin) iframe: browsers then send `Origin: null`, which gets 403.
// - /versions and /version take entry and image paths under contentDir and the schema path (else 400), a `limit` of
//   1..100 (default 30) and a full commit id (40 or 64 hex digits; else 400). /version answers 404 when the file is not in that
//   commit, the commit is unknown or there is no git. While the schema is broken, both answer 500 with its issues
//   for any other path.
// - Other errors (400 / 403 / 404 / 405 / 500) carry a DevErrorResponse body.

export interface DevFilesResponse {
  files: FileRef[];
}

export interface DevGitFile {
  /** Repo path as the listing has it (relative to the project root). A rename: the new path `added`, the old `removed`. */
  path: string;
  status: 'added' | 'modified' | 'removed';
}

export interface DevGitResponse {
  /** The checked-out branch; `null` when `root` is not a git checkout, git is missing, or HEAD is detached. */
  branch: string | null;
  /** Files under `contentDir` with uncommitted changes (modified, added, deleted or untracked); a rename counts once. */
  changes: number;
  /**
   * The uncommitted files under `contentDir`, one by one; `[]` when git is not usable. Also on a detached HEAD.
   * An older dev server leaves it out, so clients read a missing one as `[]`.
   */
  files: DevGitFile[];
  /**
   * A stable id of this project (a hex SHA-256 of its resolved root), for client-side storage keys; never the path.
   * Clients read a missing one (an older dev server) as `'default'`.
   */
  project: string;
}

export interface DevVersionsResponse {
  versions: FileVersion[];
}

export interface DevErrorResponse {
  issues: Issue[];
}

export interface DevCommitChange {
  path: string;
  /** New content; `null` deletes the file. */
  content: string | null;
  /** How `content` is encoded; default `'utf8'`. Use `'base64'` for binary files. */
  encoding?: 'utf8' | 'base64';
  /** Expected current git blob sha; `null` means the file must not exist yet. Omit to skip the check. */
  sha?: string | null;
}

export interface DevCommitRequest {
  message: string;
  changes: DevCommitChange[];
}
