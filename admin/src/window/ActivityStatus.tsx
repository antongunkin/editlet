import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

export type Activity = 'idle' | 'loading' | 'saving' | 'syncing';

const LABEL: Record<Exclude<Activity, 'idle'>, string> = {
  loading: 'Loading…',
  saving: 'Saving…',
  syncing: 'Syncing…',
};

/** How long a busy state stays on screen at least, so a quick fetch does not flash. */
export const ACTIVITY_HOLD_MS = 600;

/**
 * What the admin is doing with its data, from React Query: `saving` while a mutation runs (a commit), `loading` while a
 * query fetches data it does not have yet, `syncing` while it refreshes data it has, else `idle`. `syncing: false`
 * leaves refreshes out (the dev server's polling every few seconds would show it all the time).
 */
export function useActivity({ syncing }: { syncing: boolean }): Activity {
  const saving = useIsMutating() > 0;
  const loading = useIsFetching({ predicate: (query) => query.state.data === undefined }) > 0;
  const fetching = useIsFetching() > 0;
  return useHeld(saving ? 'saving' : loading ? 'loading' : syncing && fetching ? 'syncing' : 'idle');
}

/** `value`, except that a busy state is kept for `ACTIVITY_HOLD_MS` at least before it changes. */
function useHeld(value: Activity): Activity {
  const [shown, setShown] = useState(value);
  const since = useRef(Date.now());
  useEffect(() => {
    if (value === shown) return;
    const show = () => {
      since.current = Date.now();
      setShown(value);
    };
    // From Idle, a busy state shows at once; from a busy state, the change waits for the rest of the hold.
    const wait = shown === 'idle' ? 0 : since.current + ACTIVITY_HOLD_MS - Date.now();
    if (wait <= 0) return show();
    const timer = setTimeout(show, wait);
    return () => clearTimeout(timer);
  }, [value, shown]);
  return shown;
}

/**
 * The status bar's right end: Loading…, Saving… or Syncing… while the admin works with its data, nothing while it is
 * idle. Syncing is shown only where refreshes are worth seeing (GitHub mode), not for the dev server's polling. Not a
 * live region: refreshes would make a screen reader repeat it.
 */
export function ActivityStatus({ syncing }: { syncing: boolean }) {
  const activity = useActivity({ syncing });
  if (activity === 'idle') return null;
  return (
    <span className="editlet-window__activity" data-activity={activity}>
      {LABEL[activity]}
    </span>
  );
}
