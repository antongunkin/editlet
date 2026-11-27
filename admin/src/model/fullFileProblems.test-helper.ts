// The phase 1 `useEntryProblems`: every entry file read in full and validated. Not source: the tests hold the hook that
// reads summaries first (`useModelData.ts`) to its answers.

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { entryProblems, problemCandidates, type ProblemFile, type ReadResult } from './problems';

import { EditletError } from '../../../core/issues';
import { entryFileQuery, useFiles, type SchemaData } from '../data/queries';
import { useSource } from '../source/context';

export function useFullFileProblems(data: SchemaData): { problems: ProblemFile[]; pending: boolean } {
  const source = useSource();
  const files = useFiles();
  const { schema, schemaPath } = data;
  const candidates = useMemo(
    () => (files.data ? problemCandidates(schema, schemaPath, files.data) : []),
    [schema, schemaPath, files.data],
  );
  const entryCandidates = useMemo(() => candidates.filter((c) => c.entry), [candidates]);
  const results = useQueries({ queries: entryCandidates.map((c) => entryFileQuery(source, c)) });
  const listed = files.data;
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
}
