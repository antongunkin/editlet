import { useCallback, useEffect, useState } from 'react';

export type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/**
 * Copies text to the clipboard. `copied` names what was copied (a prompt's id, or any key) for a moment, so the button
 * of that row says *Copied*; `failed` says *Copy failed* the same way.
 */
export function useCopy(): {
  copied: string | null;
  state: CopyState;
  copy(text: string, key?: string): Promise<boolean>;
} {
  const [shown, setShown] = useState<{ state: CopyState; key: string } | null>(null);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), RESET_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  const copy = useCallback(async (text: string, key = '') => {
    try {
      await navigator.clipboard.writeText(text);
      setShown({ state: 'copied', key });
      return true;
    } catch {
      setShown({ state: 'failed', key });
      return false;
    }
  }, []);
  return { copied: shown?.state === 'copied' ? shown.key : null, state: shown?.state ?? 'idle', copy };
}
