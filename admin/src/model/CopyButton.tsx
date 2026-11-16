import { useEffect, useState } from 'react';

import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';

type CopyState = 'idle' | 'copied' | 'failed';

const RESET_MS = 2000;

/** Copies `text` to the clipboard; the label says `Copied` or `Copy failed` for a moment. */
export function CopyButton({
  text,
  label = 'Copy',
  describedBy,
}: {
  text: string;
  label?: string;
  describedBy?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), RESET_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };
  const shown = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        icon={state === 'copied' ? <Icon.Check /> : undefined}
        onClick={copy}
        aria-describedby={describedBy}
      >
        {shown}
      </Button>
      <span role="status" className="editlet-sr-only">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed' : ''}
      </span>
    </>
  );
}
