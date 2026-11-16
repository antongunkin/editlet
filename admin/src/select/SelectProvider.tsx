import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { parseRefKey } from '../../../core/paths';
import { isSelectMessage, type SelectMessage } from '../../../loader/window/channel';
import { useRoute } from '../useRoute';

/** A selection the editor sent from the page with **Edit**, waiting for its entry's form to pick it up. */
export type SelectRequest = Omit<SelectMessage, 'source' | 'type'> & { id: number };

type Value = { request: SelectRequest | null; finish(id: number): void };

const SelectContext = createContext<Value>({ request: null, finish: () => {} });

/** A request no form took this long after it came (another entry's unsaved changes kept it open) is dropped. */
const REQUEST_MS = 10_000;

/**
 * Takes `select` messages from window.js (the site page, the admin's own origin), opens the entry, and keeps the
 * request until the entry's form has applied it (`finish`).
 */
export function SelectProvider({ children }: { children: ReactNode }) {
  const { navigate } = useRoute();
  const nav = useRef(navigate);
  nav.current = navigate;
  const [request, setRequest] = useState<SelectRequest | null>(null);

  useEffect(() => {
    let next = 0;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== window.location.origin || !isSelectMessage(e.data)) return;
      const { source: _source, type: _type, ...body } = e.data;
      const ref = parseRefKey(body.entry);
      if (!ref) return;
      next += 1;
      setRequest({ ...body, id: next });
      nav.current({ kind: 'entry', collection: ref.collection, slug: ref.slug });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!request) return;
    const timer = setTimeout(() => setRequest((r) => (r?.id === request.id ? null : r)), REQUEST_MS);
    return () => clearTimeout(timer);
  }, [request]);

  const finish = useCallback((id: number) => setRequest((r) => (r?.id === id ? null : r)), []);
  const value = useMemo(() => ({ request, finish }), [request, finish]);
  return <SelectContext.Provider value={value}>{children}</SelectContext.Provider>;
}

export const useSelectRequest = () => useContext(SelectContext);
