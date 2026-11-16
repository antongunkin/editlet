import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { diffModel, type ModelChanges } from './model';
import { entryProblems, problemCandidates, type ProblemFile, type ReadResult } from './problems';

import { EditletError } from '../../../core/issues';
import type { Schema } from '../../../core/schema';
import { entryFileQuery, invalidateFiles, useFiles, type EntryFileData, type SchemaData } from '../data/queries';
import { useSource } from '../source/context';

export const GITHUB_POLL_MS = 30_000;

/**
 * GitHub mode does not poll the file list on its own. While the model screen is open, invalidate `['files']` every
 * 30 s (one snapshot query per poll; trees and blobs are cached by sha).
 */
export function useGithubPoll(): void {
  const source = useSource();
  const client = useQueryClient();
  const github = source.kind === 'github';
  useEffect(() => {
    if (!github) return;
    const timer = setInterval(() => {
      if (!document.hidden) void invalidateFiles(client);
    }, GITHUB_POLL_MS);
    return () => clearInterval(timer);
  }, [github, client]);
}

type ReadState = { data: EntryFileData | undefined; error: Error | null };

/** Stable (structurally shared) read states, so the problems memo only re-runs when a result changes. */
const combineReads = (rs: { data: EntryFileData | undefined; error: Error | null }[]): ReadState[] =>
  rs.map((r) => ({ data: r.data, error: r.error }));

/** Entries that fail the current schema, reading each entry file through the shared entry-file cache. */
export function useEntryProblems(data: SchemaData): { problems: ProblemFile[]; pending: boolean } {
  const source = useSource();
  const files = useFiles();
  const { schema, schemaPath } = data;
  const candidates = useMemo(
    () => (files.data ? problemCandidates(schema, schemaPath, files.data) : []),
    [schema, schemaPath, files.data],
  );
  const entryCandidates = useMemo(() => candidates.filter((c) => c.entry), [candidates]);
  const results = useQueries({
    queries: entryCandidates.map((c) => entryFileQuery(source, c)),
    combine: combineReads,
  });
  const listed = files.data;
  return useMemo(() => {
    if (!listed) return { problems: [], pending: !files.error };
    const byPath = new Map(entryCandidates.map((c, i) => [c.path, results[i]]));
    const read = candidates.map((c): ReadResult => {
      if (!c.entry) return { issues: [] };
      const result = byPath.get(c.path);
      if (result?.data) return { file: result.data.file };
      if (result?.error) {
        const error = result.error;
        return {
          issues: error instanceof EditletError ? error.issues : [{ file: c.path, path: '', message: error.message }],
        };
      }
      return undefined;
    });
    return entryProblems(schema, listed, candidates, read);
  }, [schema, listed, files.error, candidates, entryCandidates, results]);
}

/** Marks what changed between the previous and the current schema. `null` until the schema changes once. */
export function useSchemaChanges(schema: Schema): { changes: ModelChanges | null; updatedAt: Date | null } {
  const previous = useRef(schema);
  const [state, setState] = useState<{ changes: ModelChanges | null; updatedAt: Date | null }>({
    changes: null,
    updatedAt: null,
  });
  useEffect(() => {
    if (previous.current === schema) return;
    setState({ changes: diffModel(previous.current, schema), updatedAt: new Date() });
    previous.current = schema;
  }, [schema]);
  return state;
}
