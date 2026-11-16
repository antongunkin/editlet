import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';

import { usePreview } from './PreviewProvider';
import { deletePreview, postPreview } from './previewRoute';
import { fieldPreviews, type DataBody } from './snapshot';

import { decodeUtf8, parseEntryFile } from '../../../core/entryFile';
import { parseEntryPath } from '../../../core/paths';
import type { Schema } from '../../../core/schema';
import type { GitHubSource } from '../../../github';
import { clearSnapshot, setPreviewFlag } from '../../../loader/preview/db';
import type { PreviewValue } from '../../../loader/protocol';
import { useFiles, useSchema } from '../data/queries';
import { mimeType } from '../data/useAssetUrl';
import { useAuth } from '../github/auth';
import { useWorkspace } from '../github/workspace';
import { useBridge } from '../useRoute';

type BranchEntries = Record<string, Record<string, PreviewValue>>;

function parseBlob(bytes: Uint8Array, path: string): DataBody | null {
  const decoded = decodeUtf8(bytes, path);
  if ('issue' in decoded) return null;
  try {
    return parseEntryFile(decoded.text);
  } catch {
    return null;
  }
}

/**
 * Preview values for every entry file `source`'s branch changes against the base branch: `from` = the merge-base
 * side, `to` = the branch head. Removed entries and files that do not parse are skipped. Images are read from the
 * branch.
 */
export async function branchPreviews(source: GitHubSource, schema: Schema): Promise<BranchEntries> {
  const diff = await source.compare();
  const readImage = async (path: string): Promise<Blob | null> => {
    try {
      const bytes = await source.readFile(path);
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(path) });
    } catch {
      return null;
    }
  };
  const out: BranchEntries = {};
  await Promise.all(
    diff.files.map(async (f) => {
      const parsed = parseEntryPath(schema, f.path);
      if (!parsed || f.sha === null) return;
      const [before, after] = await Promise.all([
        f.baseSha === null ? null : source.readBlob(f.baseSha).then((b) => parseBlob(b, f.path)),
        source.readBlob(f.sha).then((b) => parseBlob(b, f.path)),
      ]);
      if (!after) return;
      const fields = await fieldPreviews(schema, parsed.collection, f.path, before, after, readImage);
      if (Object.keys(fields).length > 0) out[`${parsed.collection}/${parsed.slug}`] = fields;
    }),
  );
  return out;
}

export const PREVIEW_NOTICE = 'Preview could not update; the page shows the last saved state';

/** Every preview-route call waits for the one before, so the last call's cookie is the one the site keeps. */
let routeQueue: Promise<unknown> = Promise.resolve();
function queued<T>(op: () => Promise<T>): Promise<T> {
  const run = routeQueue.then(op, op);
  routeQueue = run.catch(() => undefined);
  return run;
}

/** The last route call: the `branch@sha` posted (with its result), or `'deleted'`. */
type Posted = { key: string; done: Promise<boolean> } | 'deleted' | null;

/**
 * GitHub mode: keeps the branch layer of the preview snapshot in step with the active branch. An Editlet branch writes
 * its changes against the base branch (again after every new head) and the preview flag; the base branch, sign-out
 * and unmount clear the snapshot and the flag.
 *
 * `preview` (`config.preview`, Layer B): also keeps the site's signed preview cookie on the active branch head. Each
 * new head is posted to the preview route with the editor's token; the base branch, a lapsed session and sign-out send
 * `DELETE`. After a save, the site refresh posts the new head first and sends `refresh` only after the route answered,
 * so `router.refresh()` renders the new commit. A failed post still refreshes and shows `PREVIEW_NOTICE`. `fetch`: for
 * the route calls (default `globalThis.fetch`).
 */
export function GitHubPreviewSync({
  preview: route = false,
  fetch: fetchFn,
}: { preview?: boolean; fetch?: typeof fetch } = {}) {
  const workspace = useWorkspace();
  const { session, getToken } = useAuth();
  const { setBranchPreview, setRefreshSite, setNotice } = usePreview();
  const { send } = useBridge();
  const files = useFiles();
  const schema = useSchema().data?.schema;
  const branch = workspace?.active ?? null;
  const source = workspace?.source;
  const live = workspace !== null && !workspace.onBase && session !== null;

  /** The head the file list was read at: a save (or a commit elsewhere, once listed) gives a new one. */
  const head = useQuery({
    queryKey: ['preview', branch, 'head', files.dataUpdatedAt],
    queryFn: () => source!.head(),
    enabled: live && files.data !== undefined,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === branch ? prev : undefined),
  });
  const headOid = head.data;
  const preview = useQuery({
    queryKey: ['preview', branch, headOid],
    queryFn: () => branchPreviews(source!, schema!),
    enabled: live && headOid !== undefined && schema !== undefined,
    staleTime: Infinity,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === branch ? prev : undefined),
  });

  useEffect(() => {
    if (branch === null) return;
    if (!live) {
      setBranchPreview(branch, null);
      setPreviewFlag(null);
      void clearSnapshot();
      return;
    }
    // Until the branch's changes load, an empty layer: the page never shows another branch's changes.
    setBranchPreview(branch, preview.data ?? {});
    setPreviewFlag(branch);
  }, [branch, live, preview.data, setBranchPreview]);

  // Sign-out unmounts the workspace before a render with `session === null` reaches the effect above.
  useEffect(() => {
    if (branch === null) return;
    return () => {
      setBranchPreview(branch, null);
      setPreviewFlag(null);
      void clearSnapshot();
    };
  }, [branch, setBranchPreview]);

  // Layer B: the preview cookie.
  const posted = useRef<Posted>(null);
  /** Read when the refresh runs: a save that created a branch has switched to it by then. */
  const latest = useRef({ branch, source, live });
  latest.current = { branch, source, live };

  /** Posts `branch@sha` once; a second call for the same head (the save, then the new file list) waits for the first. */
  const post = useCallback(
    (name: string, sha: string): Promise<boolean> => {
      const key = `${name}@${sha}`;
      const last = posted.current;
      // Ended (base branch, signed out): a late post would put the cookie back with no pill on the site.
      if (last === 'deleted' && !latest.current.live) return Promise.resolve(false);
      if (last !== null && last !== 'deleted' && last.key === key) return last.done;
      const done = queued(async () => {
        try {
          return await postPreview({ branch: name, sha, token: await getToken(), fetch: fetchFn });
        } catch {
          return false; // no token (the session ended): no preview
        }
      }).then((ok) => {
        const now = posted.current;
        if (now !== null && now !== 'deleted' && now.key === key) {
          if (!ok) posted.current = null; // the next head or save tries again
          setNotice(ok ? null : PREVIEW_NOTICE);
        }
        return ok;
      });
      posted.current = { key, done };
      return done;
    },
    [getToken, fetchFn, setNotice],
  );

  const end = useCallback(() => {
    if (posted.current === 'deleted') return;
    posted.current = 'deleted';
    setNotice(null);
    void queued(() => deletePreview(fetchFn));
  }, [fetchFn, setNotice]);

  useEffect(() => {
    if (!route || branch === null) return;
    if (!live) end();
    else if (headOid !== undefined) void post(branch, headOid);
  }, [route, branch, live, headOid, post, end]);

  const endRef = useRef<(() => void) | null>(null);
  endRef.current = route ? end : null;
  useEffect(() => () => endRef.current?.(), []);

  useEffect(() => {
    if (!route) return;
    setRefreshSite(async () => {
      const now = latest.current;
      if (now.live && now.branch !== null && now.source) {
        let ok: boolean | null;
        try {
          const sha = await now.source.head();
          // The editor switched branch (or ended) while the head loaded: that switch owns the cookie now.
          const after = latest.current;
          ok = after.live && after.branch === now.branch ? await post(now.branch, sha) : null;
        } catch {
          ok = false;
        }
        if (ok === false) setNotice(PREVIEW_NOTICE);
      }
      send({ type: 'refresh' });
    });
    return () => setRefreshSite(null);
  }, [route, post, send, setRefreshSite, setNotice]);

  return null;
}
