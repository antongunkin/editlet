// Batched entry reads (docs/admin/search.md#data-and-limits): the paths asked in one task go out together through
// `ContentSource.readFiles` (the GitHub source reads 50 blobs per GraphQL query), not one request per file.

import { EditletError } from '../../../core/issues';
import type { ContentSource } from '../../../core/source';
import { GitHubError, type GitHubSource } from '../../../github';

/** The most paths one `readFiles` call asks for (the GitHub source splits them into queries of 50, 6 at a time). */
export const BATCH_LIMIT = 200;

export interface BatchedReader {
  /** The file at `path`, read with the other paths asked in the same task. */
  read(path: string): Promise<Uint8Array>;
}

interface Waiter {
  path: string;
  resolve(bytes: Uint8Array): void;
  reject(error: unknown): void;
}

const readers = new WeakMap<ContentSource, BatchedReader>();
const unkeptReaders = new WeakMap<ContentSource, BatchedReader>();

/** The GitHub source takes `keep` in `readFiles`; the `ContentSource` contract does not. */
const takesKeep = (source: ContentSource): source is GitHubSource =>
  source.kind === 'github' && source.readFiles !== undefined;

/**
 * One reader per source: every query of a source shares its queue. Without `readFiles`, it reads one file at a time.
 * `keep: false` is for bytes the caller does not need again: a GitHub source writes none of them to its blob cache. It
 * is a second reader with its own queue, so a batch never mixes the two; any other source has the one reader.
 */
export function batchedReader(source: ContentSource, { keep = true }: { keep?: boolean } = {}): BatchedReader {
  if (!keep && takesKeep(source)) {
    let reader = unkeptReaders.get(source);
    if (!reader) {
      reader = queueReader((paths) => source.readFiles(paths, { keep: false }));
      unkeptReaders.set(source, reader);
    }
    return reader;
  }
  let reader = readers.get(source);
  if (!reader) {
    reader = source.readFiles ? queueReader(source.readFiles.bind(source)) : { read: (path) => source.readFile(path) };
    readers.set(source, reader);
  }
  return reader;
}

const pathsOf = (batch: Waiter[]) => [...new Set(batch.map((w) => w.path))];

/** A batch failed for the batch as a whole and may work in smaller pieces: one bad blob, an over-long response. */
const splittable = (error: unknown) =>
  error instanceof GitHubError && (error.code === 'graphql_error' || error.code === 'http_error');

function queueReader(readFiles: (paths: string[]) => Promise<Map<string, Uint8Array>>): BatchedReader {
  let queue: Waiter[] = [];

  // `useQueries` starts every fetch of one render in one commit: a microtask gathers them, and stays out of fake timers.
  const flush = () => {
    const waiting = queue;
    queue = [];
    const paths = pathsOf(waiting);
    for (let i = 0; i < paths.length; i += BATCH_LIMIT) {
      const chunk = new Set(paths.slice(i, i + BATCH_LIMIT));
      void send(waiting.filter((w) => chunk.has(w.path)));
    }
  };

  const send = async (batch: Waiter[]): Promise<void> => {
    const paths = pathsOf(batch);
    let read: Map<string, Uint8Array>;
    try {
      read = await readFiles(paths);
    } catch (error) {
      fail(batch, paths, error);
      return;
    }
    for (const w of batch) {
      const bytes = read.get(w.path);
      if (bytes) w.resolve(bytes);
      else w.reject(missing([w.path]));
    }
  };

  const fail = (batch: Waiter[], paths: string[], error: unknown) => {
    // Missing paths: those reject with their own issue, the rest go out again as one batch.
    if (error instanceof EditletError) {
      const gone = new Set(
        error.issues.flatMap((i) => (i.file !== undefined && paths.includes(i.file) ? [i.file] : [])),
      );
      if (gone.size > 0) {
        for (const w of batch) {
          if (gone.has(w.path)) w.reject(new EditletError(error.issues.filter((i) => i.file === w.path)));
        }
        const rest = batch.filter((w) => !gone.has(w.path));
        if (rest.length > 0) void send(rest);
        return;
      }
    }
    // A failure of the whole request: halves, so a bad blob ends up alone, not 200 single queries.
    if (splittable(error) && paths.length > 1) {
      const first = new Set(paths.slice(0, Math.ceil(paths.length / 2)));
      void send(batch.filter((w) => first.has(w.path)));
      void send(batch.filter((w) => !first.has(w.path)));
      return;
    }
    // Rate limits, auth and network errors: the client already waited and retried; every path rejects with it.
    for (const w of batch) w.reject(error);
  };

  return {
    read(path) {
      return new Promise<Uint8Array>((resolve, reject) => {
        if (queue.length === 0) queueMicrotask(flush);
        queue.push({ path, resolve, reject });
      });
    },
  };
}

function missing(paths: string[]): EditletError {
  return new EditletError(paths.map((p) => ({ file: p, path: '', message: `File not found: ${p}` })));
}
