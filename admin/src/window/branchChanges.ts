import { useQuery } from '@tanstack/react-query';

import { useFiles } from '../data/queries';
import { useWorkspace } from '../github/workspace';

/** The files the active branch changes against the base: one compare call, refetched after every save. */
export function useBranchChanges(): number | null {
  const workspace = useWorkspace();
  const files = useFiles();
  const enabled = workspace !== null && !workspace.onBase;
  const changes = useQuery({
    queryKey: ['branch-changes', workspace?.active, files.dataUpdatedAt],
    queryFn: async () => (await workspace!.source.compare()).files.length,
    enabled,
  });
  return enabled ? (changes.data ?? null) : null;
}
