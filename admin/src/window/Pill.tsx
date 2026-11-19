import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { useWindowPill } from './channel';

import { cn } from '../ui/cn';
import { Pill as PillShape } from '../ui/parts/chrome';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { useBridge } from '../useRoute';

/**
 * The collapsed window: Pencil + Editlet (expands it again) | × (closes the editor for real, after the unsaved-changes
 * guard, with a short fade). Always mounted, so it can fade in and out (and be measured); window.js sizes the dialog
 * to it while `collapsed`.
 */
export function Pill({ collapsed, onExpand }: { collapsed: boolean; onExpand: () => void }) {
  const { close } = useBridge();
  const ref = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  useWindowPill(ref, collapsed);
  // Keyboard users keep their place: the × they pressed is gone now, so focus the pill's Editlet button.
  useEffect(() => {
    if (collapsed) ref.current?.querySelector('button')?.focus();
  }, [collapsed]);
  // The exit animation runs once the guard allowed the close; `close` is sent when it ends.
  const exit = () => {
    flushSync(() => setClosing(true));
    const animations = ref.current?.getAnimations?.() ?? [];
    return animations.length ? Promise.all(animations.map((a) => a.finished)).then(() => {}) : null;
  };
  return (
    <PillShape
      data-editlet="pill"
      data-open={collapsed ? '' : undefined}
      // Fixed at the iframe's top left, where window.js lands the dialog; hidden (faded, blurred, smaller) while the
      // window is open, and it shrinks away on the real close (app.css `morph`, `pill-closing`).
      className={cn(
        'fixed top-0 left-0 z-1 font-sans whitespace-nowrap text-foreground morph',
        !collapsed && 'morph-out scale-80',
        closing && 'pill-closing',
      )}
      ref={ref}
      inert={!collapsed}
    >
      <Button variant="primary" icon={<Icon name="pencil" size={16} />} onClick={onExpand}>
        Editlet
      </Button>
      <IconButton
        variant="ghost"
        label="Close Editlet"
        title="Close"
        onClick={() => close({ exit })}
        icon={<Icon name="x" size={16} />}
      />
    </PillShape>
  );
}
