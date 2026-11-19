import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useEntryEditor, EntryEditorFrame, isBranchTaken } from './EntryEditor';
import { EntryLoader, shaOf, type LoadedEntry } from './EntryLoader';
import { EntryDetails, EntryUpdated, useEntryHistory } from './EntryMeta';
import { EntrySheet, OnTopContext } from './EntrySheet';
import { EntryView } from './EntryView';
import { FieldRows } from './FieldRows';
import { OpenOnPageRow } from './OpenOnPage';
import { RenameDialog } from './RenameDialog';
import { ReferrerList, USED_BY_SHOWN, UsedBy } from './UsedBy';

import { entrySubject, renameSubject } from '../../../core/gitStyle';
import { parseEntryPath } from '../../../core/paths';
import { planRemove, type RenamePlan } from '../../../core/rename';
import { collectionNames, fieldGroups } from '../../../core/schema';
import { entryUrl } from '../../../core/urls';
import { useBuffer } from '../changes/trayContext';
import { useFiles, useReferrers, type PlanFile } from '../data/queries';
import { copyData, copySlug } from '../entry/duplicate';
import { groupOf, groupTabs } from '../entry/groups';
import { pendingCopies } from '../entry/pending';
import { removeChanges, removeIssues, renameChanges } from '../entry/plans';
import { DRAFT_KEY } from '../entry/values';
import { routeFromBranch } from '../github/branchName';
import { NewBranchField } from '../github/NewBranchField';
import { BRANCHES_KEY } from '../github/workspace';
import { EntryHistory, hasHistory } from '../history/EntryHistory';
import { useSiteRefresh } from '../preview/PreviewProvider';
import { parentRoute } from '../route';
import { RouteLink } from '../RouteLink';
import { useSearchActions } from '../search/SearchProvider';
import { SelectNoticeBanner } from '../select/SelectNoticeBanner';
import { useApplySelect, type SelectTarget } from '../select/useApplySelect';
import { useSource } from '../source/context';
import { useFileStatuses } from '../status/useFileStatus';
import {
  ActionRow,
  Badge,
  Banner,
  Button,
  buttonVariants,
  cn,
  Confirm,
  FieldRow,
  Icon,
  IconButton,
  Sheet,
} from '../ui';
import { ActionSheet } from '../ui/parts/action-sheet';
import { Checkbox } from '../ui/primitives/checkbox';
import { toastManager } from '../ui/primitives/toast';
import { StatusBadge } from '../ui/StatusBadge';
import { useBridge, useRoute } from '../useRoute';
import { useScreenChrome, type ScreenChrome } from '../window/chrome';
import { useReportEntryStatus } from '../window/entryStatus';

type EntryFormProps = {
  entry: LoadedEntry;
  /** The screen's chrome from the window (the header actions, the status line, the shell's banners). */
  chrome: ScreenChrome;
  /** The chosen field group (`null`: the first); kept by the screen, so a save or Reload keeps the tab. */
  group: string | null;
  onGroupChange(key: string): void;
};

/** The ⋯ rows that need the saved file stay off while the entry has unsaved edits (they live in the buffer). */
const SAVE_FIRST = 'Save or discard your changes first';

/**
 * The entry screen's form: the entry's editor (`useEntryEditor`: values, validation, review and save) inside the
 * screen's own parts: the header, ⋯ (Duplicate, Discard, Details, History, Rename, Set as draft, Delete), the field
 * groups, select-to-edit, the leave guard and the status line.
 */
function EntryForm({ entry, chrome, group, onGroupChange }: EntryFormProps) {
  const { schema, def, collection, slug, path, loaded } = entry;
  const ref = `${collection}/${slug}`;
  const isNew = loaded === null;
  const [selectTargets] = useState(() => new Map<string, SelectTarget>());
  const onTopCount = useRef(0);
  const editor = useEntryEditor({ entry, selectTargets, entrySheet: EntrySheet });
  const { form, values, dirty, dirtyRef, keptRef, saved, listed, ctx, items, bodyKey, titleOf, entryTitle, changes } =
    editor;
  const { commit, newBranch, blocked, workspace, showCommitError, onSave, openCompare, onDiscard, onRestore } = editor;
  const { newer, notices } = entry;
  const client = useQueryClient();
  const { navigate } = useRoute();
  const { setGuard } = useBridge();
  const refreshSite = useSiteRefresh();
  const source = useSource();
  const fileStatus = useFileStatuses().of(path);

  // The ⋯ button: every modal opened from it returns the focus there (`finalFocus`), also on Safari, which does not focus
  // a tapped button, so the browser's own "back to what had the focus" would find nothing.
  const more = useRef<HTMLButtonElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeRefs, setRemoveRefs] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The field whose modal is open (one field per modal): a row's tap, the Fix CTA, select-to-edit.
  const [openField, setOpenField] = useState<string | null>(null);
  const openFieldRef = useRef(openField);
  openFieldRef.current = openField;
  // Field groups (tabs): the chosen one shows its rows; opening a field elsewhere chooses its tab first.
  const groups = useMemo(() => fieldGroups(def), [def]);
  const tabbed = groups.length > 1;
  // `?? ''`: a collection with `groups` and no fields has no group at all.
  const activeGroup = group !== null && groups.some((g) => g.key === group) ? group : (groups[0]?.key ?? '');
  const activeGroupRef = useRef(activeGroup);
  activeGroupRef.current = activeGroup;
  const openAt = (key: string | null) => {
    if (key !== null && tabbed) onGroupChange(groupOf(groups, key));
    setOpenField(key);
  };

  // Guard: site navigate, close-request, close(), in-app navigation and page unload.
  const leavingRef = useRef(false);
  useEffect(() => {
    // Leaving asks only when the edits would be lost: they are kept in the buffer while it persists (`keptRef`).
    setGuard(
      () => leavingRef.current || !dirtyRef.current || keptRef.current || window.confirm('Discard unsaved changes?'),
    );
    return () => setGuard(null);
  }, [setGuard, dirtyRef, keptRef]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current || keptRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty, dirtyRef, keptRef]);

  const files = useFiles();
  const referrers = useReferrers(ref);
  const usedBy = isNew ? [] : (referrers.data ?? []);
  // The saved file as rename and delete plans see it (`core/rename.ts`).
  const self = useMemo<PlanFile | null>(
    () =>
      loaded
        ? {
            collection,
            slug,
            data: loaded.file.data,
            body: loaded.file.body,
            path,
            sha: loaded.sha,
            keyOrder: loaded.keyOrder,
          }
        : null,
    [loaded, collection, slug, path],
  );
  // Cheap (a few entries): computed on each render, as `usedBy` is.
  const removePlan =
    self && usedBy.length > 0
      ? planRemove(schema, [self, ...usedBy.map((u) => u.entry).filter((e) => e.path !== path)], ref)
      : null;
  const removeProblems = removePlan ? removeIssues(schema, removePlan) : [];
  // Delete and Rename rewrite the entries that reference this one: not while one of them has unsaved edits.
  const buffer = useBuffer();
  const bufferedReferrers = usedBy.filter((u) => buffer.of(u.entry.path) !== undefined).length;
  const referrersBuffered = bufferedReferrers > 0;
  const referrersNote = referrersBuffered
    ? `Save or discard your changes to ${bufferedReferrers} ${bufferedReferrers === 1 ? 'entry' : 'entries'} that ${bufferedReferrers === 1 ? 'references' : 'reference'} it first.`
    : null;
  const listedSha = (p: string) => files.data?.find((f) => f.path === p)?.sha ?? null;

  const selectNotice = useApplySelect(
    ref,
    def,
    () => form.state.values,
    selectTargets,
    openAt,
    bodyKey === undefined ? [] : [bodyKey],
    () => openFieldRef.current,
    () => {
      const from = activeGroupRef.current;
      return () => {
        if (tabbed) onGroupChange(from);
      };
    },
    () => onTopCount.current > 0,
  );

  /** ⋯ → Duplicate: the saved entry as a new, unsaved one at `<slug>-copy`; the toast's Undo comes back here. */
  const onDuplicate = () => {
    // The file list says which addresses are taken: without it a copy could open an entry that exists.
    if (!loaded || files.data === undefined) return;
    const taken = new Set<string>();
    for (const p of listed) {
      const parsed = parseEntryPath(schema, p);
      if (parsed?.collection === collection) taken.add(parsed.slug);
    }
    const to = copySlug(slug, taken);
    // Right after a save the loaded file is still the old one until the new sha loads: copy what was saved.
    const file = saved ?? loaded.file;
    pendingCopies.set(`${collection}/${to}`, { data: copyData(def, file.data), body: file.body });
    navigate({ kind: 'entry', collection, slug: to });
    const id = toastManager.add({
      title: 'Duplicated',
      type: 'copy',
      actionProps: {
        children: 'Undo',
        onClick: () => {
          toastManager.close(id);
          navigate({ kind: 'entry', collection, slug });
        },
      },
    });
  };

  /** ⋯ → Set as draft / Set as published: the `draft` flag as an unsaved edit. */
  const onToggleDraft = () => {
    const next = form.state.values[DRAFT_KEY] !== true;
    form.setFieldValue(DRAFT_KEY, next);
    toastManager.add({ title: `${next ? 'Set as draft' : 'Set as published'} · save to keep it` });
  };

  const confirmDelete = async () => {
    if (!loaded || blocked) return;
    entry.onCommitStart();
    const withRefs = removePlan !== null && removeRefs;
    try {
      await commit.mutateAsync({
        changes: withRefs ? removeChanges(schema, removePlan, listedSha) : [{ path, content: null, sha: loaded.sha }],
        message: editor.commitMessage(entrySubject('delete', collection, slug)),
        newBranch: newBranch.branch,
      });
    } catch (error) {
      entry.onCommitEnd(false);
      if (isBranchTaken(error)) return void client.invalidateQueries({ queryKey: BRANCHES_KEY });
      setDeleteOpen(false);
      showCommitError(error);
      return;
    }
    leavingRef.current = true;
    setDeleteOpen(false);
    // Navigate first: the site reloads on `refresh`, and it must reload on the collection, not the deleted entry.
    navigate(def.singleton ? { kind: 'home' } : { kind: 'collection', collection });
    void refreshSite();
  };

  const confirmRename = async (plan: RenamePlan<PlanFile>) => {
    if (!loaded || blocked) return;
    const to = plan.to.slice(plan.to.indexOf('/') + 1);
    entry.onCommitStart();
    try {
      const planned = await renameChanges(schema, plan, (p) => source.readFile(p), listedSha);
      await commit.mutateAsync({
        changes: planned,
        message: editor.commitMessage(renameSubject(collection, slug, to)),
        newBranch: newBranch.branch,
      });
    } catch (error) {
      entry.onCommitEnd(false);
      if (isBranchTaken(error)) return void client.invalidateQueries({ queryKey: BRANCHES_KEY });
      setRenameOpen(false);
      showCommitError(error);
      return;
    }
    leavingRef.current = true;
    setRenameOpen(false);
    navigate({ kind: 'entry', collection, slug: to });
    void refreshSite();
  };

  const draft = values[DRAFT_KEY] === true;
  // The status line's *Unsaved changes* link: with a newer file a save would be refused, so it compares too.
  useReportEntryStatus({ draft, dirty, isNew, changes }, newer && dirty ? openCompare : onSave);
  // Search's *Duplicate this entry*: the ⋯ action, offered and off on the same conditions. The saved title is what
  // Duplicate copies (the live one would re-register the action on every keystroke).
  const savedValue = loaded && def.titleField ? loaded.file.data[def.titleField] : undefined;
  useSearchActions(
    isNew || def.singleton
      ? []
      : [
          {
            id: 'duplicate',
            label: 'Duplicate this entry',
            sub: typeof savedValue === 'string' && savedValue.trim() !== '' ? savedValue.trim() : slug,
            icon: 'copy',
            keywords: ['duplicate', 'copy', 'clone'],
            disabled: dirty || files.data === undefined,
            note: dirty ? 'Save first' : undefined,
            run: onDuplicate,
          },
        ],
  );

  const history = useEntryHistory(path, isNew ? null : shaOf(loaded));
  const { invalidItems, emptyRequired, savable } = editor;
  const shownItems = tabbed ? items.filter((i) => groupOf(groups, i.key) === activeGroup) : items;

  const parent = parentRoute(def.singleton ? { kind: 'collection', collection } : { kind: 'entry', collection, slug });
  const back = parent ? (
    <RouteLink
      to={parent}
      className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
      aria-label="Back"
      title={`Back to ${def.singleton ? 'All content' : collectionNames(def).many}`}
    >
      <Icon name="chevron-left" size={20} />
    </RouteLink>
  ) : null;

  const cta = commit.isPending ? (
    <Button variant="primary" size="lg" full loading busyLabel="Saving…">
      Saving…
    </Button>
  ) : newer && dirty ? (
    // FigCraft *Entry · conflict*: the edits are kept, the one CTA opens the comparison.
    <Button variant="primary" size="lg" full aria-haspopup="dialog" onClick={openCompare}>
      Compare changes
    </Button>
  ) : invalidItems.length > 0 ? (
    // The CTA takes you to the field that blocks saving (FigCraft *Entry · blocked*).
    <Button variant="primary" size="lg" full onClick={() => openAt(invalidItems[0]!.key)}>
      Fix {invalidItems.length} {invalidItems.length === 1 ? 'field' : 'fields'}
    </Button>
  ) : emptyRequired.length > 0 ? (
    <Button variant="primary" size="lg" full onClick={() => openAt(emptyRequired[0]!.key)}>
      Fill {emptyRequired.length} required {emptyRequired.length === 1 ? 'field' : 'fields'}
    </Button>
  ) : savable ? (
    <Button variant="primary" size="lg" full onClick={onSave}>
      {editor.saveLabel}
    </Button>
  ) : workspace && !workspace.onBase ? (
    <RouteLink
      to={{ kind: 'branch', name: routeFromBranch(workspace.active, workspace.prefix) }}
      className={buttonVariants({ variant: 'primary', size: 'lg', full: true })}
    >
      <Icon name="eye" size={20} />
      Review changes
    </RouteLink>
  ) : null;

  const badge = isNew ? (
    <Badge tone="unsaved">New</Badge>
  ) : dirty ? (
    <Badge tone="unsaved">Unsaved</Badge>
  ) : (
    // A clean form: the file's status first (*In review*, *Changed*), else Draft / Published.
    <StatusBadge draft={draft} status={fileStatus} showPublished />
  );

  const banners = (
    <>
      {chrome.banners}
      {notices}
      <SelectNoticeBanner {...selectNotice} />
      {editor.issueBanners}
    </>
  );

  return (
    <OnTopContext.Provider value={onTopCount}>
      <EntryEditorFrame editor={editor}>
        <EntryView
          section={def.singleton ? 'All content' : collectionNames(def).many}
          back={back}
          actions={
            <>
              {isNew ? null : (
                <IconButton
                  ref={more}
                  label="More actions"
                  aria-haspopup="dialog"
                  onClick={() => setMoreOpen(true)}
                  icon={<Icon name="more" size={20} />}
                />
              )}
              {chrome.windowActions}
            </>
          }
          title={entryTitle}
          badge={badge}
          meta={<EntryUpdated history={history} />}
          banners={banners}
          groups={
            tabbed ? { tabs: groupTabs(groups, items), value: activeGroup, onValueChange: onGroupChange } : undefined
          }
          fieldsLabel={`${ref} fields`}
          fields={
            <FieldRows items={shownItems} ctx={ctx} sub={entryTitle} open={openField} onOpen={openAt} title={titleOf} />
          }
          after={<UsedBy schema={schema} title={entryTitle} items={usedBy} />}
          status={chrome.status}
          cta={cta}
        >
          {isNew ? null : (
            <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} title={entryTitle} finalFocus={more}>
              {def.singleton ? null : (
                <ActionRow
                  icon="copy"
                  disabled={dirty || files.data === undefined}
                  note={dirty ? SAVE_FIRST : undefined}
                  onClick={() => {
                    setMoreOpen(false);
                    onDuplicate();
                  }}
                >
                  Duplicate
                </ActionRow>
              )}
              <ActionRow
                icon="undo"
                disabled={!dirty}
                onClick={() => {
                  setMoreOpen(false);
                  setDiscardOpen(true);
                }}
              >
                Discard changes
              </ActionRow>
              <ActionRow
                icon="file"
                onClick={() => {
                  setMoreOpen(false);
                  setDetailsOpen(true);
                }}
              >
                Details
              </ActionRow>
              <OpenOnPageRow {...{ schema, collection, slug, dirty, draft }} onOpen={() => setMoreOpen(false)} />
              {hasHistory(source) ? (
                <ActionRow
                  icon="clock"
                  note={history.commits > 0 ? history.commits : undefined}
                  aria-haspopup="dialog"
                  onClick={() => {
                    setMoreOpen(false);
                    setHistoryOpen(true);
                  }}
                >
                  History
                </ActionRow>
              ) : null}
              {def.singleton ? null : (
                <ActionRow
                  icon="pencil"
                  disabled={dirty}
                  note={dirty ? SAVE_FIRST : undefined}
                  onClick={() => {
                    setMoreOpen(false);
                    setRenameOpen(true);
                  }}
                >
                  Rename…
                </ActionRow>
              )}
              <ActionRow
                icon="file"
                onClick={() => {
                  setMoreOpen(false);
                  onToggleDraft();
                }}
              >
                {draft ? 'Set as published' : 'Set as draft'}
              </ActionRow>
              <ActionRow
                icon="trash"
                danger
                disabled={dirty}
                note={dirty ? SAVE_FIRST : undefined}
                onClick={() => {
                  setMoreOpen(false);
                  setRemoveRefs(false);
                  setDeleteOpen(true);
                }}
              >
                Delete…
              </ActionRow>
            </ActionSheet>
          )}
          <Sheet open={detailsOpen} onOpenChange={setDetailsOpen} title="Details" sub={entryTitle} finalFocus={more}>
            <EntryDetails history={history} page={entryUrl(schema, collection, slug)} />
          </Sheet>
          {isNew ? null : (
            <EntryHistory
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              path={path}
              sha={shaOf(loaded)}
              entryTitle={entryTitle}
              def={def}
              current={editor.current}
              dirty={dirty}
              historyUrl={history.historyUrl}
              onRestore={onRestore}
              finalFocus={more}
            />
          )}
        </EntryView>
        {editor.dialogs}
        <Confirm
          open={discardOpen}
          onOpenChange={setDiscardOpen}
          title="Discard unsaved changes?"
          description="The form goes back to the saved file. New uploads that are not saved are dropped."
          confirmLabel="Discard"
          onConfirm={onDiscard}
          finalFocus={more}
        />
        <Confirm
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={`Delete ${ref}?`}
          description={
            usedBy.length > 0
              ? 'Other entries reference this one. Delete it together with those references, or remove them first.'
              : 'The entry file is deleted. Image files are kept.'
          }
          confirmLabel={
            (newBranch.needed ? 'Delete on branch' : 'Delete') +
            (usedBy.length > 0 && removeRefs ? ` and update ${usedBy.length}` : '')
          }
          pending={commit.isPending}
          confirmDisabled={
            blocked || referrersBuffered || (usedBy.length > 0 && (!removeRefs || removeProblems.length > 0))
          }
          onConfirm={() => void confirmDelete()}
          finalFocus={more}
        >
          {usedBy.length > 0 ? (
            <>
              {referrersNote ? <p className="m-0 text-sm text-destructive">{referrersNote}</p> : null}
              <ReferrerList schema={schema} items={usedBy} max={USED_BY_SHOWN} />
              {removeProblems.length > 0 ? (
                <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-destructive" role="alert">
                  <Icon name="x" size={16} />
                  <span>
                    Removing the references would leave these entries invalid; fix them first:{' '}
                    {removeProblems.join('; ')}
                  </span>
                </div>
              ) : (
                <label className="-ml-2.5 flex items-center text-sm">
                  <Checkbox checked={removeRefs} onCheckedChange={setRemoveRefs} />
                  Also remove the references from {usedBy.length} {usedBy.length === 1 ? 'entry' : 'entries'}
                </label>
              )}
            </>
          ) : null}
          <NewBranchField {...newBranch} />
        </Confirm>
        {self && !def.singleton ? (
          <RenameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            schema={schema}
            self={self}
            referrers={usedBy}
            files={(files.data ?? []).map((f) => f.path)}
            pending={commit.isPending}
            blocked={blocked || referrersBuffered}
            onConfirm={(plan) => void confirmRename(plan)}
            finalFocus={more}
          >
            {referrersNote ? <p className="m-0 text-sm text-destructive">{referrersNote}</p> : null}
            <NewBranchField {...newBranch} />
          </RenameDialog>
        ) : null}
      </EntryEditorFrame>
    </OnTopContext.Provider>
  );
}

/**
 * The entry screen: `EntryLoader` loads the schema and the file (a missing file is a new, unsaved entry) and remounts
 * the form per generation; the screen keeps the chosen field group across them and highlights the entry on the page.
 */
export function Entry({ collection, slug }: { collection: string; slug: string }) {
  const { status, send } = useBridge();
  const ref = `${collection}/${slug}`;
  useEffect(() => {
    if (status !== 'connected') return;
    send({ type: 'highlight', entry: ref });
    return () => send({ type: 'highlight', entry: null });
  }, [status, send, ref]);
  const [group, setGroup] = useState<string | null>(null);
  const chrome = useScreenChrome();
  return (
    <EntryLoader
      collection={collection}
      slug={slug}
      renderFallback={({ def, error }) => (
        // Loading (or failed before anything loaded): the screen's frame with placeholder rows, so the bar stays put.
        <EntryView
          section={def ? (def.singleton ? 'All content' : collectionNames(def).many) : collection}
          actions={chrome.windowActions}
          title={slug}
          banners={
            <>
              {chrome.banners}
              {error ? (
                <Banner tone="danger" role="alert">
                  {error.message}
                </Banner>
              ) : null}
            </>
          }
          fieldsLabel={`${ref} fields`}
          fields={
            error ? null : (
              <>
                <FieldRow label="Loading" loading />
                <FieldRow label="Loading" loading />
                <FieldRow label="Loading" loading />
              </>
            )
          }
          status={chrome.status}
        />
      )}
    >
      {(entry) => <EntryForm entry={entry} chrome={chrome} group={group} onGroupChange={setGroup} />}
    </EntryLoader>
  );
}
