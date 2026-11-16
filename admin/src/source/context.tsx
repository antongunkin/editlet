import { createContext, useContext, type ReactNode } from 'react';

import type { ContentSource } from '../../../core/source';

const SourceContext = createContext<ContentSource | null>(null);

export function SourceProvider({ source, children }: { source: ContentSource; children: ReactNode }) {
  return <SourceContext.Provider value={source}>{children}</SourceContext.Provider>;
}

export function useSource(): ContentSource {
  const source = useContext(SourceContext);
  if (!source) throw new Error('useSource must be used inside <SourceProvider>');
  return source;
}

/** Identifies what a source reads, for query keys: the branch of a GitHub source, else the source kind. */
export function sourceKey(source: ContentSource): string {
  return 'branch' in source ? String(source.branch) : source.kind;
}

/** Prefix of every file-list query key (invalidates them all). */
export const FILES_KEY = ['files'] as const;

/** The file-list query key of one source: `['files', <branch or source kind>]`. */
export function filesKey(source: ContentSource) {
  return [...FILES_KEY, sourceKey(source)] as const;
}
