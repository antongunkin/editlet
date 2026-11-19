import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { useChangesTray } from './trayContext';
import type { ChangedEntry } from './useChanges';
import { deriveEntries } from './useChanges';

import { entriesSubject } from '../../../core/gitStyle';
import type { Issue } from '../../../core/issues';
import { MAX_COMMIT_BYTES } from '../../../github';
import { IssuesError, useCommit, useFiles, useSchema } from '../data/queries';
import { ReviewDialog, useWide, type ReviewEntry } from '../diff/ReviewDialog';
import { COMPARE_MESSAGES, referencedAssets } from '../entry/changes';
import { entryDiff, formKeyOf, type FieldDiffRow } from '../entry/diff';
import { entryToForm, formToEntry, serializeEntry } from '../entry/values';
import { errorText } from '../github/errors';
import { NewBranchField, useNewBranch } from '../github/NewBranchField';
import { ApprovalNote, useCodeowners, useCommitMessage, useSaveTo } from '../github/style';
import { BRANCHES_KEY, useWorkspace } from '../github/workspace';
import { useSiteRefresh } from '../preview/PreviewProvider';
import { isBranchTaken } from '../screens/EntryEditor';
import { ActionRow, Confirm, Icon, IconButton } from '../ui';
import { ActionSheet } from '../ui/parts/action-sheet';
import { toastManager } from '../ui/primitives/toast';
import { useRoute } from '../useRoute';

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

/** The row's badge: why this entry blocks the save, and its tone (*Changed elsewhere* is the warning amber). */
function noteOf(entry: ChangedEntry): Pick<ReviewEntry, 'note' | 'tone'> {
  switch (entry.blocked) {
    case 'conflict':
      return { note: 'Changed elsewhere', tone: 'unsaved' };
    case 'taken':
      return { note: 'The address is taken now', tone: 'danger' };
    case 'deleted':
      return { note: 'Deleted elsewhere', tone: 'danger' };
    case 'problems':
      return { note: `${entry.issues.length} ${plural(entry.issues.length, 'problem')}`, tone: 'danger' };
    case 'newer-admin':
      return { note: 'Saved by a newer Editlet', tone: 'danger' };
    default:
      return {};
  }
}

/** A buffer operation the database refused: said, not thrown. */
const failed = () => toastManager.add({ title: 'Could not update your changes', type: 'error' });

const refusedMessage = (issues: Issue[]) =>
  issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join('; ');

const byteLength = (content: string | Uint8Array | null) =>
  content === null ? 0 : typeof content === 'string' ? new TextEncoder().encode(content).length : content.byteLength;

/** How long the tray stays mounted after it closes: its sheets finish their exit animation. */
const UNMOUNT_AFTER_MS = 600;

/**
 * *Your changes* across entries, mounted only while it is open (and a moment after): it reads the branches and the
 * CODEOWNERS file, which no other screen should pay for.
 */
export function ChangesTray() {
  const { open } = useChangesTray();
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open || !mounted) return;
    const timer = setTimeout(() => setMounted(false), UNMOUNT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);
  return mounted ? <OpenTray /> : null;
}

/**
 * *Your changes* across entries (FigCraft *Your changes*): every buffered entry, the open one first, and one save of all
 * of them as one commit. The caller of `ReviewDialog` for the entry screen, Home and the status chip. The rows come
 * from the changes buffer (`useChanges`); the open form hands over its live entry (`FormHandle`).
 */
function OpenTray() {
  const tray = useChangesTray();
  const changes = tray.changes!;
  const { store, entries: all } = changes;
  const schema = useSchema().data?.schema;
  const files = useFiles().data;
  const workspace = useWorkspace();
  const commit = useCommit();
  const client = useQueryClient();
  const commitMessage = useCommitMessage();
  const codeowners = useCodeowners();
  const saveTo = useSaveTo();
  const refreshSite = useSiteRefresh();
  const wide = useWide();
  const { navigate } = useRoute();
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [discardAllOpen, setDiscardAllOpen] = useState(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  const openPath = tray.open ? (tray.handle()?.path ?? null) : null;
  // The open entry first, then the rest by path.
  const entries = all.toSorted((a, b) => Number(b.path === openPath) - Number(a.path === openPath));
  // A row of a newer Editlet is listed but never committed.
  const saveable = entries.filter((e) => e.blocked !== 'newer-admin');
  const first = saveable[0] ?? entries[0];
  const def = first ? schema?.collections[first.collection] : undefined;
  const newBranch = useNewBranch(first?.collection ?? 'content', first?.slug ?? 'changes', def?.singleton === true);

  // Nothing left (the last one discarded or reverted, or saved in another tab): the tray closes.
  useEffect(() => {
    if (tray.open && changes.ready && all.length === 0 && !commit.isPending) tray.setOpen(false);
  }, [tray, changes.ready, all.length, commit.isPending]);

  if (!schema) return null;

  const rowsCount = saveable.reduce((n, e) => n + e.rows.length, 0);
  const conflicts = saveable.filter(
    (e) => e.blocked === 'conflict' || e.blocked === 'taken' || e.blocked === 'deleted',
  );
  const problems = saveable.filter((e) => e.blocked === 'problems');
  const referenced = new Set(
    saveable.flatMap((e) =>
      e.after
        ? [...referencedAssets(schema, schema.collections[e.collection]!, e.path, e.after.data, e.after.body)]
        : [],
    ),
  );
  const imageRows = changes.images.filter((r) => referenced.has(r.path));
  const bytes =
    saveable.reduce((n, e) => n + byteLength(e.row.content), 0) +
    imageRows.reduce((n, r) => n + byteLength(r.content), 0);
  const tooLarge = bytes > MAX_COMMIT_BYTES;

  const openEntry = (entry: ChangedEntry) => {
    tray.setOpen(false);
    navigate({ kind: 'entry', collection: entry.collection, slug: entry.slug });
  };

  /** The CTA when the save is not possible yet: it takes the editor to the first entry to fix. */
  const blockedEntry = conflicts[0] ?? problems[0];
  const label = conflicts.length
    ? `Resolve ${conflicts.length} ${plural(conflicts.length, 'conflict')}`
    : problems.length
      ? `Fix ${problems.length} ${plural(problems.length, 'entry', 'entries')}`
      : tooLarge
        ? 'Too large for one commit'
        : saveable.length === 1 && saveable[0]!.isNew
          ? 'Save'
          : `Save ${rowsCount} ${plural(rowsCount, 'change')}`;

  const save = async () => {
    if (!store || commit.isPending || !schema) return;
    const pinned = store; // the scope stays this one while the save runs, even if the branch moves under it
    const handle = tray.handle();
    const submitted = handle ? await handle.flush() : null;
    // The rows as they are now (the open form's flush has landed), against the current listing.
    const fresh = deriveEntries(schema, await pinned.read(), filesRef.current).filter(
      (e) => e.blocked !== 'newer-admin',
    );
    if (fresh.length === 0 || fresh.some((e) => e.blocked !== null))
      return void client.invalidateQueries({ queryKey: ['changes'] });
    const used = new Set(
      fresh.flatMap((e) =>
        e.after
          ? [...referencedAssets(schema, schema.collections[e.collection]!, e.path, e.after.data, e.after.body)]
          : [],
      ),
    );
    const images = (await pinned.read()).filter((r) => used.has(r.path) && r.content instanceof Uint8Array);
    const action = fresh.every((e) => e.isNew) ? 'create' : 'update';
    const message = commitMessage(entriesSubject(action, fresh), '', note);
    handle?.commitStart();
    try {
      await commit.mutateAsync({
        changes: [
          ...fresh.map((e) => ({ path: e.path, content: e.row.content as string, sha: e.row.sha })),
          ...images.map((r) => ({ path: r.path, content: r.content as Uint8Array, sha: null })),
        ],
        message,
        newBranch: newBranch.branch,
      });
    } catch (error) {
      handle?.commitEnd(false);
      if (isBranchTaken(error)) return void client.invalidateQueries({ queryKey: BRANCHES_KEY });
      const issues =
        error instanceof IssuesError
          ? error.issues
          : [
              {
                path: '',
                message: workspace
                  ? errorText(error, { repo: `${workspace.config.owner}/${workspace.config.repo}` })
                  : error instanceof Error
                    ? error.message
                    : String(error),
              },
            ];
      // The branch was created before the refusal: the rows follow the editor to it.
      if (error instanceof IssuesError && newBranch.branch && workspace) {
        await pinned.moveScope(pinned.scope, `${workspace.config.owner}/${workspace.config.repo}#${newBranch.branch}`);
      }
      // A newer file: read it again; the rows then show *Changed elsewhere* and the entry compares.
      if (issues.some((i) => COMPARE_MESSAGES.has(i.message))) void client.invalidateQueries({ queryKey: ['files'] });
      // Nothing was written: the tray closes onto the open entry, whose banner and fields say why (a toast without one).
      if (handle) {
        tray.setOpen(false);
        handle.showError(
          error instanceof IssuesError
            ? new IssuesError(issues.filter((i) => !i.file || i.file === handle.path))
            : error,
        );
      } else {
        toastManager.add({ title: 'Not saved', description: refusedMessage(issues), type: 'error' });
      }
      return;
    }
    handle?.commitEnd(true);
    if (handle && submitted) handle.saved(submitted);
    // Each committed row leaves the buffer, unless it was written again after the save started.
    // A buffer that cannot be cleaned up (a failing database) must not turn a saved commit into an error.
    await Promise.allSettled([
      ...fresh.map((e) => pinned.removeIf(e.path, e.row.updatedAt)),
      ...images.map((r) => pinned.removeIf(r.path, r.updatedAt)),
    ]);
    await pinned.pruneImages(schema).catch(() => undefined);
    setNote('');
    tray.setOpen(false);
    toastManager.add({ title: workspace ? 'Saved · 1 commit' : 'Saved to disk' });
    void refreshSite();
  };

  /** *Revert this change*: the open entry through its form, any other by rewriting its row. */
  const revert = async (ref: string, row: FieldDiffRow) => {
    const entry = entries.find((e) => e.ref === ref);
    if (!entry || !store) return;
    const handle = tray.handle();
    if (handle && handle.path === entry.path) return handle.revert(row);
    const collection = schema.collections[entry.collection]!;
    const key = formKeyOf(collection, row.key);
    if (key === null || !entry.after || !entry.before) return;
    const values = entryToForm(collection, entry.after);
    values[key] = entryToForm(collection, entry.before)[key];
    const next = formToEntry(collection, values);
    const keyOrder = Object.keys(entry.before.data);
    const empty = entryDiff(collection, entry.before, { data: next.data, body: next.body }).length === 0;
    if (empty) await store.removeEntry(entry.path);
    else await store.writeEntry({ ...entry.row, content: serializeEntry(collection, next.data, next.body, keyOrder) });
    await store.pruneImages(schema);
  };

  const discard = async (ref: string) => {
    const entry = entries.find((e) => e.ref === ref);
    if (!entry || !store) return;
    const handle = tray.handle();
    if (handle && handle.path === entry.path) handle.discard();
    await store.removeEntry(entry.path);
    await store.pruneImages(schema);
  };

  const discardAll = async () => {
    tray.handle()?.discard();
    await store?.clearAll();
    setDiscardAllOpen(false);
    tray.setOpen(false);
  };

  const reviewEntries: ReviewEntry[] = entries.map((e) => ({
    key: e.ref,
    title: e.title,
    sub: `${schema.collections[e.collection]?.label ?? e.collection} · ${e.rows.map((r) => r.label).join(', ')}`,
    rows: e.rows,
    revertable: e.revertable,
    ...noteOf(e),
  }));
  const approval = workspace ? (
    <ApprovalNote paths={[...saveable.map((e) => e.path), ...imageRows.map((r) => r.path)]} rules={codeowners} />
  ) : undefined;
  const cannotSave = !store || tooLarge || (newBranch.needed && newBranch.branch === undefined && !blockedEntry);

  return (
    <>
      <ReviewDialog
        open={tray.open}
        onOpenChange={tray.setOpen}
        entries={reviewEntries}
        newFiles={imageRows.map((r) => r.path)}
        saveTo={saveTo}
        newBranch={newBranch.needed && !blockedEntry ? <NewBranchField {...newBranch} /> : undefined}
        note={approval}
        confirmLabel={label}
        blocked={blockedEntry !== undefined}
        busy={commit.isPending}
        confirmDisabled={cannotSave}
        inline={wide}
        onConfirm={() => (blockedEntry ? openEntry(blockedEntry) : void save())}
        onRevert={(ref, row) => void revert(ref, row).catch(failed)}
        onOpenEntry={(ref) => {
          const entry = entries.find((e) => e.ref === ref);
          if (entry) openEntry(entry);
        }}
        onDiscardEntry={(ref) => void discard(ref).catch(failed)}
        commitNote={workspace ? { value: note, onChange: setNote } : undefined}
        headerMenu={
          <IconButton
            label="More actions"
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
            icon={<Icon name="more" size={20} />}
          />
        }
      />
      <ActionSheet open={menuOpen} onOpenChange={setMenuOpen} title="Your changes">
        <ActionRow
          icon="trash"
          danger
          onClick={() => {
            setMenuOpen(false);
            setDiscardAllOpen(true);
          }}
        >
          Discard all changes
        </ActionRow>
      </ActionSheet>
      <Confirm
        open={discardAllOpen}
        onOpenChange={setDiscardAllOpen}
        title={`Discard changes to ${entries.length} ${plural(entries.length, 'entry', 'entries')}?`}
        description="They cannot be brought back."
        confirmLabel="Discard"
        onConfirm={() => void discardAll().catch(failed)}
      />
    </>
  );
}
