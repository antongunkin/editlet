import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { diffModel, type ModelChanges } from './model';
import {
  entryProblems,
  maybeProblem,
  problemCandidates,
  projectContext,
  type ProblemCandidate,
  type ProblemFile,
  type ReadResult,
} from './problems';

import { EditletError } from '../../../core/issues';
import type { Schema } from '../../../core/schema';
import { entryFileQuery, invalidateFiles, useFiles, type EntryFileData, type SchemaData } from '../data/queries';
import { useSummaries, type SummaryRef } from '../data/summaries';
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

type EntryCandidate = ProblemCandidate & { entry: NonNullable<ProblemCandidate['entry']> };

const isEntry = (c: ProblemCandidate): c is EntryCandidate => c.entry !== null;

/**
 * Entries that fail the current schema. First the summary of every entry (`useSummaries`: no full file when it is kept),
 * then the full files of the suspects only (`maybeProblem`, and a summary that failed), through the shared entry-file
 * cache, validated as `entryProblems` does.
 */
export function useEntryProblems(data: SchemaData): { problems: ProblemFile[]; pending: boolean } {
  const source = useSource();
  const files = useFiles();
  const { schema, schemaPath } = data;
  const listed = files.data;
  const candidates = useMemo(
    () => (listed ? problemCandidates(schema, schemaPath, listed) : []),
    [schema, schemaPath, listed],
  );
  const entryCandidates = useMemo(() => candidates.filter(isEntry), [candidates]);
  const refs = useMemo(
    () => entryCandidates.map(({ path, sha, entry }): SummaryRef => ({ path, sha, ...entry })),
    [entryCandidates],
  );
  const { rows, errors } = useSummaries(refs);

  const { suspects, clean } = useMemo(() => {
    const toRead: EntryCandidate[] = [];
    const passed = new Set<string>();
    const ctx = projectContext(listed ?? [], candidates);
    entryCandidates.forEach((c, i) => {
      const summary = rows[i];
      // A summary that failed: the full read gives the error to report, with this file's path.
      if (errors[i] || (summary && maybeProblem(schema, ctx, c.path, c.entry, summary))) toRead.push(c);
      else if (summary) passed.add(c.path);
    });
    return { suspects: toRead, clean: passed };
  }, [schema, listed, candidates, entryCandidates, rows, errors]);

  const results = useQueries({
    queries: suspects.map((c) => entryFileQuery(source, c)),
    combine: combineReads,
  });

  return useMemo(() => {
    if (!listed) return { problems: [], pending: !files.error };
    const byPath = new Map(suspects.map((c, i) => [c.path, results[i]]));
    const read = candidates.map((c): ReadResult => {
      if (!c.entry || clean.has(c.path)) return { issues: [] };
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
  }, [schema, listed, files.error, candidates, suspects, clean, results]);
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
