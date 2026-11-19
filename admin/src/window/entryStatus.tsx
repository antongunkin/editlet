import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { ChangesChip } from '../ui/parts/status-chips';
import { StatusBadge } from '../ui/StatusBadge';

/** What the open entry form tells the window's status bar. */
export interface EntryStatus {
  draft: boolean;
  /** The form differs from the saved file. */
  dirty: boolean;
  /** The entry has no file yet. */
  isNew: boolean;
  /** Fields that differ from the saved file. */
  changes: number;
  /** Opens the review dialog (the diff, then Save). */
  review: () => void;
}

type Slot = {
  status: EntryStatus | null;
  report: (status: EntryStatus | null) => void;
};

const EntryStatusContext = createContext<Slot>({ status: null, report: () => undefined });

/** The window chrome owns the slot; the entry form fills it, the status bar reads it. */
export function EntryStatusProvider({ children }: { children: ReactNode }) {
  const [status, report] = useState<EntryStatus | null>(null);
  const value = useMemo(() => ({ status, report }), [status]);
  return <EntryStatusContext.Provider value={value}>{children}</EntryStatusContext.Provider>;
}

export function useEntryStatus(): EntryStatus | null {
  return useContext(EntryStatusContext).status;
}

/** Entry form: show this state in the status bar while the form is open (a no-op outside the window). */
export function useReportEntryStatus(
  { draft, dirty, isNew, changes }: Omit<EntryStatus, 'review'>,
  onReview: () => void,
): void {
  const { report } = useContext(EntryStatusContext);
  const review = useRef(onReview);
  review.current = onReview;
  useEffect(() => {
    report({ draft, dirty, isNew, changes, review: () => review.current() });
    return () => report(null);
  }, [report, draft, dirty, isNew, changes]);
}

/** What is not saved yet, as a link that opens the review dialog. Nothing when the form is clean. */
export function UnsavedLink({ entry }: { entry: EntryStatus }) {
  if (!entry.dirty && !entry.isNew) return null;
  return (
    <ChangesChip title="Review and save" onClick={entry.review}>
      {entry.isNew ? 'New entry' : `Unsaved changes (${entry.changes})`}
    </ChangesChip>
  );
}

/** Only the exception is shown: a draft is not live. Published is the normal state and stays silent. */
export function DraftBadge({ entry }: { entry: EntryStatus }) {
  return entry.draft ? <StatusBadge draft /> : null;
}
