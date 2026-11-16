import { createMemoryCache, type GitHubCache } from './cache.ts';
import { createGitHubClient, type GitHubClient, type GitHubClientOptions } from './client.ts';
import { loadSnapshotAt, readBlobs, type SourceContext } from './source.ts';

import { EditletError } from '../core/issues.ts';
import { isHiddenContentPath, isImagePath } from '../core/paths.ts';
import type { Schema } from '../core/schema.ts';

export interface ReadCommitOptions {
  owner: string;
  repo: string;
  /** Full commit sha. */
  sha: string;
  /** Exactly one of `token` or `client`. */
  token?: GitHubClientOptions['token'];
  client?: GitHubClient;
  /** Default `cms/schema.json`. */
  schemaPath?: string;
  /** Default: one module-level memory cache shared by every call (blobs are keyed by sha, so sharing is safe). */
  cache?: GitHubCache;
}

export interface CommitFiles {
  schema: Schema;
  /** The schema file plus every non-hidden content file except images. */
  files: Map<string, Uint8Array>;
  /** Every path in the commit tree, images and hidden files included (for existence checks). */
  paths: Set<string>;
}

const sharedCache = createMemoryCache();

/** Reads the schema and content files of one commit. Server-side: never touches IndexedDB. */
export async function readCommit(options: ReadCommitOptions): Promise<CommitFiles> {
  if ((options.token === undefined) === (options.client === undefined)) {
    throw new TypeError('readCommit: pass exactly one of `token` or `client`');
  }
  const ctx: SourceContext = {
    client: options.client ?? createGitHubClient({ token: options.token! }),
    cache: options.cache ?? sharedCache,
    owner: options.owner,
    repo: options.repo,
    schemaPath: options.schemaPath ?? 'cms/schema.json',
  };
  const snapshot = await loadSnapshotAt(ctx, options.sha);
  const { schema } = snapshot;
  if (!schema) {
    const message = snapshot.schemaSha === null ? `Schema not found: ${ctx.schemaPath}` : 'Invalid schema';
    throw new EditletError([{ file: ctx.schemaPath, path: '', message }]);
  }

  const wanted = [...snapshot.files].filter(
    ([path]) => path === ctx.schemaPath || (!isHiddenContentPath(schema, path) && !isImagePath(path)),
  );
  const blobs = await readBlobs(ctx, [...new Set(wanted.map(([, sha]) => sha))]);
  const files = new Map<string, Uint8Array>();
  for (const [path, sha] of wanted) files.set(path, blobs.get(sha)!);
  return { schema, files, paths: new Set(snapshot.files.keys()) };
}
