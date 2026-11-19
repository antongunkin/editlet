import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { buildSnapshot, mergePreviews } from './snapshot';

import { announceSnapshot, clearSnapshot, setPreviewFlag, writeSnapshot } from '../../../loader/preview/db';
import type { PreviewValue } from '../../../loader/protocol';
import { DEFAULT_SESSION_MINUTES } from '../../config';
import { useBridge } from '../useRoute';

type EntryPreviews = Record<string, PreviewValue>;

/** Writes the page preview snapshot (see `docs/admin/preview.md`). */
export interface Preview {
  /** The open form's changes for entry `ref` (`<collection>/<slug>`); `null` or `{}` drops them. */
  setFormPreview(ref: string, fields: EntryPreviews | null): void;
  /**
   * The unsaved entries of the changes buffer (`<collection>/<slug>` → fields), every entry in the buffer, not only
   * the open one. Between the branch layer and the open forms; `null` or `{}` drops it.
   */
  setBufferPreview(entries: Record<string, EntryPreviews> | null): void;
  /**
   * The active branch and what it changes against the base branch. `entries: null` on the base branch (or signed
   * out): the snapshot then holds the form changes only.
   */
  setBranchPreview(branch: string, entries: Record<string, EntryPreviews> | null): void;
  /** Replaces what `useSiteRefresh()` does after a save (`null` restores the bridge's `refresh` message). */
  setRefreshSite(fn: (() => Promise<void>) | null): void;
  /** A one-line notice about the preview, shown by the shell (`usePreviewNotice`); `null` hides it. */
  setNotice(text: string | null): void;
}

type Ctx = Preview & { refreshRef: { current: (() => Promise<void>) | null } };

const noop = () => {};

/** Outside a provider (screen tests that render a screen alone): nothing is written. */
const NO_PREVIEW: Ctx = {
  setFormPreview: noop,
  setBufferPreview: noop,
  setBranchPreview: noop,
  setRefreshSite: noop,
  setNotice: noop,
  refreshRef: { current: null },
};

const PreviewContext = createContext<Ctx>(NO_PREVIEW);
/** Its own context: a new notice re-renders the shell only, not every `usePreview()` caller. */
const NoticeContext = createContext<string | null>(null);

export const PREVIEW_DEBOUNCE_MS = 100;

/**
 * Keeps one preview snapshot in IndexedDB for the site page: the branch layer (`setBranchPreview`), the changes buffer
 * (`setBufferPreview`) and the open forms (`setFormPreview`), each over the one before, rewritten 100 ms after the last change (and once after mount) and announced on the
 * preview channel. Before the admin sends `close`, the form and buffer layers are dropped and the
 * snapshot written at once (the site without the admin shows saved content only; the next open writes them again).
 * `flag`: also set the preview flag (GitHub mode) while a non-base branch is active. Needs `BridgeProvider` above.
 */
export function PreviewProvider({
  flag,
  sessionMinutes = DEFAULT_SESSION_MINUTES,
  children,
}: {
  flag: boolean;
  sessionMinutes?: number;
  children?: ReactNode;
}) {
  const state = useRef({
    branch: null as string | null,
    branchEntries: null as Record<string, EntryPreviews> | null,
    buffer: {} as Record<string, EntryPreviews>,
    form: {} as Record<string, EntryPreviews>,
  });
  const options = useRef({ flag, sessionMinutes });
  options.current = { flag, sessionMinutes };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Writes run one after another, so a slow write never lands after a newer one. */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const flush = useCallback(async () => {
    const { branch, branchEntries, buffer, form } = state.current;
    const { flag: setFlag, sessionMinutes: minutes } = options.current;
    const entries = mergePreviews(mergePreviews(branchEntries ?? {}, buffer), form);
    const label = branch ?? 'local';
    if (branchEntries !== null) {
      // A non-base branch: always a snapshot, even with no changes, so the pill says which branch the page shows.
      await writeSnapshot(buildSnapshot(label, entries, minutes));
      announceSnapshot();
      if (setFlag) setPreviewFlag(label);
      return;
    }
    if (setFlag) setPreviewFlag(null);
    if (Object.keys(entries).length > 0) await writeSnapshot(buildSnapshot(label, entries, minutes));
    else await clearSnapshot();
    announceSnapshot();
  }, []);

  /** React runs the provider's unmount cleanup before its children's: their last calls must not write. */
  const mounted = useRef(true);
  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (!mounted.current) return;
    timer.current = setTimeout(() => {
      queue.current = queue.current.then(flush, flush);
    }, PREVIEW_DEBOUNCE_MS);
  }, [flush]);

  // One write on mount: a form layer left by an admin the loader tore down (no React cleanup ran) is dropped.
  useEffect(() => {
    mounted.current = true;
    schedule();
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
    };
  }, [schedule]);

  // Before the admin sends `close` (the loader removes the iframe at once): drop the open forms and write now.
  const { addBeforeClose } = useBridge();
  useEffect(
    () =>
      addBeforeClose(() => {
        if (Object.keys(state.current.form).length === 0 && Object.keys(state.current.buffer).length === 0) return null;
        clearTimeout(timer.current);
        state.current.form = {};
        state.current.buffer = {};
        queue.current = queue.current.then(flush, flush);
        return queue.current;
      }),
    [addBeforeClose, flush],
  );

  const setFormPreview = useCallback(
    (ref: string, fields: EntryPreviews | null) => {
      const form = state.current.form;
      if (fields === null || Object.keys(fields).length === 0) {
        if (!Object.hasOwn(form, ref)) return;
        const rest = { ...form };
        delete rest[ref];
        state.current.form = rest;
      } else {
        state.current.form = { ...form, [ref]: fields };
      }
      schedule();
    },
    [schedule],
  );

  const setBufferPreview = useCallback(
    (entries: Record<string, EntryPreviews> | null) => {
      const next = entries ?? {};
      if (Object.keys(next).length === 0 && Object.keys(state.current.buffer).length === 0) return;
      state.current.buffer = next;
      schedule();
    },
    [schedule],
  );

  const setBranchPreview = useCallback(
    (branch: string, entries: Record<string, EntryPreviews> | null) => {
      const s = state.current;
      if (s.branch === branch && s.branchEntries === null && entries === null) return;
      state.current = { ...s, branch, branchEntries: entries };
      schedule();
    },
    [schedule],
  );

  const setRefreshSite = useCallback((fn: (() => Promise<void>) | null) => {
    refreshRef.current = fn;
  }, []);

  const value = useMemo(
    (): Ctx => ({ setFormPreview, setBufferPreview, setBranchPreview, setRefreshSite, setNotice, refreshRef }),
    [setFormPreview, setBufferPreview, setBranchPreview, setRefreshSite],
  );
  return (
    <PreviewContext.Provider value={value}>
      <NoticeContext.Provider value={notice}>{children}</NoticeContext.Provider>
    </PreviewContext.Provider>
  );
}

export function usePreview(): Preview {
  const { setFormPreview, setBufferPreview, setBranchPreview, setRefreshSite, setNotice } = useContext(PreviewContext);
  return useMemo(
    () => ({ setFormPreview, setBufferPreview, setBranchPreview, setRefreshSite, setNotice }),
    [setFormPreview, setBufferPreview, setBranchPreview, setRefreshSite, setNotice],
  );
}

/** The notice set by `usePreview().setNotice`, or `null`. */
export function usePreviewNotice(): string | null {
  return useContext(NoticeContext);
}

/**
 * Asks the site to show saved content: the function set by `setRefreshSite` when there is one, else the bridge's
 * `refresh` message (a no-op without a parent page).
 */
export function useSiteRefresh(): () => Promise<void> {
  const { refreshRef } = useContext(PreviewContext);
  const { send } = useBridge();
  return useCallback(async () => {
    if (refreshRef.current) return refreshRef.current();
    send({ type: 'refresh' });
  }, [refreshRef, send]);
}
