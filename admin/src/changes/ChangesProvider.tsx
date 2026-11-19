import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import { BufferPreview } from './BufferPreview';
import { ChangesTray } from './ChangesTray';
import { TrayContext, type FormHandle, type Tray } from './trayContext';
import { useChanges } from './useChanges';

/**
 * *Your changes* across entries: the tray's open state and the handle of the open entry's form. Inside the window (the
 * sheets portal into it), below the source and the schema; not in `WindowFrame`, which the gate screens share.
 */
export function ChangesProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const changes = useChanges();
  const handles = useRef<FormHandle[]>([]);
  const register = useCallback((handle: FormHandle) => {
    handles.current = [...handles.current, handle];
    return () => {
      handles.current = handles.current.filter((h) => h !== handle);
    };
  }, []);
  const value = useMemo<Tray>(
    () => ({ changes, open, setOpen, register, handle: () => handles.current.at(-1) ?? null }),
    [changes, open, register],
  );
  return (
    <TrayContext.Provider value={value}>
      {children}
      <BufferPreview />
      <ChangesTray />
    </TrayContext.Provider>
  );
}
