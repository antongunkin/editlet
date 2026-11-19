import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, createElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { EntryDetails, EntryUpdated, useEntryHistory } from './EntryMeta';
import { EntryView } from './EntryView';
import { FieldRows, type FieldItem } from './FieldRows';
import { RenameDialog } from './RenameDialog';
import { ReferrerList, UsedBy } from './UsedBy';

import { findImageRefs } from '../../../core/assets';
import type { EntryFile } from '../../../core/entryFile';
import { entrySubject, renameSubject } from '../../../core/gitStyle';
import type { Issue } from '../../../core/issues';
import { entryFilePath, isHiddenContentPath, isImagePath, parseEntryPath, resolveAssetPath } from '../../../core/paths';
import { referenceFields } from '../../../core/references';
import { planRemove, type RenamePlan } from '../../../core/rename';
import { fieldGroups, markdownFieldKey, type Collection, type Field, type Schema } from '../../../core/schema';
import { initialData, validateEntry } from '../../../core/validate';
import { GitHubError } from '../../../github';
import { ImagePlaceholder, PreviewImage } from '../data/PreviewImage';
import {
  invalidateFiles,
  IssuesError,
  useCommit,
  useEntryFile,
  useEntryOptions,
  useFiles,
  useReferrers,
  useSchema,
  type EntryFileData,
  type PlanFile,
} from '../data/queries';
import { AssetPreview, canOpenInWindow, mimeType } from '../data/useAssetUrl';
import { CompareSheet } from '../diff/CompareSheet';
import { reviewEntries, ReviewDialog, useWide } from '../diff/ReviewDialog';
import { issuesByField, relativeSrc, requiredFieldKeys, uniqueAssetPath } from '../entry/changes';
import { conflictFields, defaultPicks, mergeConflict, type ConflictPick } from '../entry/conflict';
import { entryDiff, formKeyOf, type FieldDiffRow } from '../entry/diff';
import { copyData, copySlug } from '../entry/duplicate';
import { groupOf, groupTabs } from '../entry/groups';
import { pendingCopies, pendingNewEntries } from '../entry/pending';
import { removeChanges, removeIssues, renameChanges } from '../entry/plans';
import { itemTitle } from '../entry/summary';
import {
  BODY_KEY,
  DRAFT_KEY,
  entryToForm,
  formToEntry,
  isEntryChanged,
  serializeEntry,
  type FormValues,
} from '../entry/values';
import type { FieldContext } from '../fields';
import { routeFromBranch } from '../github/branchName';
import { errorText } from '../github/errors';
import { NewBranchField, useNewBranch } from '../github/NewBranchField';
import { ApprovalNote, useCodeowners, useCommitMessage, useSaveTo } from '../github/style';
import { BRANCHES_KEY, useWorkspace } from '../github/workspace';
import { EntryHistory, hasHistory } from '../history/EntryHistory';
import { imageBytes, imageFileError } from '../media/edits';
import { usePreview, useSiteRefresh } from '../preview/PreviewProvider';
import { fieldPreviews } from '../preview/snapshot';
import { parentRoute } from '../route';
import { RouteLink } from '../RouteLink';
import { SelectNoticeBanner } from '../select/SelectNoticeBanner';
import { useApplySelect, type SelectTarget } from '../select/useApplySelect';
import { useSource } from '../source/context';
import type { SourceChange } from '../source/local';
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

/** The GitHub source's conflict issues: shown as `GITHUB_CONFLICT_TEXT`, with Reload. */
const GITHUB_CONFLICT_MESSAGES = new Set([
  'Changed on GitHub since it was read; reload and review',
  'Branch keeps changing; try again',
]);
const GITHUB_CONFLICT_TEXT =
  'This entry changed on GitHub since you opened it. Reload to read it, then review your change again.';
/** A save refused because the file is newer than the form's: the newer file is read and the CTA compares. */
const COMPARE_MESSAGES = new Set([
  'File changed since it was read',
  'Changed on GitHub since it was read; reload and review',
]);
const RELOAD_MESSAGES = new Set([
  'File changed since it was read',
  'File already exists',
  'File not found',
  ...GITHUB_CONFLICT_MESSAGES,
]);
const BODY_FIELD: Field = { type: 'markdown', label: 'Body' };

/**
 * The new branch was created on GitHub meanwhile: the dialog stays open, and the refreshed listing marks the typed name
 * as taken (or suggests the next free one).
 */
const isBranchTaken = (error: unknown) => error instanceof GitHubError && error.code === 'branch_exists';

type Staged = Map<string, Uint8Array>;

const StagedContext = createContext<Staged>(new Map());

function StagedImage({
  path,
  bytes,
  alt,
  openable,
  className,
}: {
  path: string;
  bytes: Uint8Array;
  alt: string;
  openable?: boolean;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const next = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(path) }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [path, bytes]);
  if (url)
    return <PreviewImage url={url} alt={alt} className={className} openable={openable && canOpenInWindow(path)} />;
  return <ImagePlaceholder alt={alt} className={className} />;
}

/** Preview for a repo path: staged bytes (object URL) when staged, else the listed file. */
function EntryPreview({
  path,
  alt,
  openable,
  className,
}: {
  path: string | null;
  alt: string;
  openable?: boolean;
  className?: string;
}) {
  const staged = useContext(StagedContext);
  const bytes = path === null ? undefined : staged.get(path);
  if (path !== null && bytes)
    return <StagedImage path={path} bytes={bytes} alt={alt} openable={openable} className={className} />;
  return createElement(AssetPreview, { path, alt, openable, className });
}

/** Repo paths that the entry's image fields and body images point at (`findImageRefs`). */
function referencedAssets(
  schema: Schema,
  collection: Collection,
  entryPath: string,
  data: Record<string, unknown>,
  body: string,
) {
  return new Set(findImageRefs(schema, collection, entryPath, data, body).flatMap((u) => (u.path ? [u.path] : [])));
}

/** Collections that the reference fields of `collection` (nested ones too) may point at. */
function referenceTargets(collection: Collection): string[] {
  return [...new Set(referenceFields(collection).flatMap(([, field]) => field.collections))];
}

type EntryFormProps = {
  schema: Schema;
  collection: string;
  slug: string;
  path: string;
  /** The saved file, or `null` for a new entry. */
  loaded: EntryFileData | null;
  /** Values the form starts from (the saved file, or the new entry's initial data). */
  initial: EntryFile;
  onDirtyChange(dirty: boolean): void;
  /** Called right before a commit: the next disk change is ours and replaces the form. */
  onCommitStart(): void;
  onCommitEnd(ok: boolean): void;
  onReload(): void;
  /** The screen's chrome from the window (the header actions, the status line, the shell's banners). */
  chrome: ScreenChrome;
  /** Notices of the screen around the form: changed on disk, a file error. */
  notices?: ReactNode;
  /** The chosen field group (`null`: the first); kept by the screen, so a save or Reload keeps the tab. */
  group: string | null;
  onGroupChange(key: string): void;
  /**
   * The file is newer than the one the form was opened on (another save), and the form has edits: the CTA compares
   * them field by field (Conflict · compare). `null` when it is not.
   */
  newer: EntryFileData | null;
  /** Apply the comparison: the form starts again on `file` from these values and staged uploads. */
  onRebase(file: EntryFileData, values: FormValues, staged: Map<string, Uint8Array>): void;
  /** Values and staged uploads to start from (after a rebase); else the file's own. */
  start?: { values: FormValues; staged: Map<string, Uint8Array> };
};

function EntryForm({
  schema,
  collection,
  slug,
  path,
  loaded,
  initial,
  onDirtyChange,
  onCommitStart,
  onCommitEnd,
  onReload,
  chrome,
  notices,
  group,
  onGroupChange,
  newer,
  onRebase,
  start,
}: EntryFormProps) {
  const def = schema.collections[collection];
  const ref = `${collection}/${slug}`;
  const isNew = loaded === null;
  const files = useFiles();
  const commit = useCommit();
  const client = useQueryClient();
  const newBranch = useNewBranch(collection, slug, def.singleton === true);
  const workspace = useWorkspace();
  const commitMessage = useCommitMessage();
  const codeowners = useCodeowners();
  const saveTo = useSaveTo();
  const wide = useWide();
  const { navigate } = useRoute();
  const { setGuard } = useBridge();
  const refreshSite = useSiteRefresh();
  const { setFormPreview } = usePreview();
  const source = useSource();

  const [initialValues] = useState<FormValues>(() => entryToForm(def, initial));
  const form = useForm({ defaultValues: start?.values ?? initialValues });
  const values = useStore(form.store, (s) => s.values);

  // After a successful save the submitted entry is the baseline, so the form is clean before the saved file loads.
  const [saved, setSaved] = useState<ReturnType<typeof formToEntry> | null>(null);
  const baseline = useMemo(() => saved ?? formToEntry(def, initialValues), [saved, def, initialValues]);
  const current = useMemo(() => formToEntry(def, values), [def, values]);
  const dirty = isEntryChanged(current, baseline);
  const savable = isNew || dirty;

  const [staged, setStaged] = useState<Staged>(() => start?.staged ?? new Map());
  const stagedRef = useRef(staged);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // *Your changes* › Note: the next commit's body (GitHub mode); cleared after a save.
  const [note, setNote] = useState('');
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
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leavingRef = useRef(false);
  useEffect(() => {
    setGuard(() => leavingRef.current || !dirtyRef.current || window.confirm('Discard unsaved changes?'));
    return () => setGuard(null);
  }, [setGuard]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Page preview: what the form changes against the saved (or loaded) entry, unsaved typing included. A new entry
  // compares against nothing until its first save.
  const previewBefore = isNew && saved === null ? null : baseline;
  useEffect(() => {
    let cancelled = false;
    const readImage = async (assetPath: string): Promise<Blob | null> => {
      let bytes = stagedRef.current.get(assetPath);
      if (!bytes) {
        try {
          bytes = await source.readFile(assetPath);
        } catch {
          return null;
        }
      }
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(assetPath) });
    };
    void fieldPreviews(schema, collection, path, previewBefore, current, readImage).then(
      (fields) => {
        if (!cancelled) setFormPreview(ref, fields);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [schema, collection, path, previewBefore, current, source, ref, setFormPreview]);
  // Closing the entry (or Reload, which mounts a fresh form) drops its form preview.
  useEffect(() => () => setFormPreview(ref, null), [ref, setFormPreview]);

  const listed = useMemo(() => new Set((files.data ?? []).map((f) => f.path)), [files.data]);

  const entryOptions = useEntryOptions(useMemo(() => referenceTargets(def), [def]));
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
  const listedSha = (p: string) => files.data?.find((f) => f.path === p)?.sha ?? null;

  const [selectTargets] = useState(() => new Map<string, SelectTarget>());
  const ctx = useMemo<FieldContext>(() => {
    const prefix = `${schema.contentDir}/`;
    const images = [
      ...new Set([
        ...[...listed].filter((p) => p.startsWith(prefix) && isImagePath(p) && !isHiddenContentPath(schema, p)),
        ...staged.keys(),
      ]),
    ].toSorted();
    return {
      entries: (cs) => entryOptions.filter((o) => cs.includes(o.ref.slice(0, o.ref.indexOf('/')))),
      entriesPending: files.data === undefined,
      images,
      contentDir: schema.contentDir,
      entryPath: path,
      async stageUpload(file) {
        const invalid = imageFileError(file);
        if (invalid) throw new Error(invalid);
        const bytes = await imageBytes(file);
        const existing = new Set([...listed, ...stagedRef.current.keys()]);
        const assetPath = uniqueAssetPath(existing, `${schema.contentDir}/${collection}/${slug}`, file.name);
        const next = new Map(stagedRef.current).set(assetPath, bytes);
        stagedRef.current = next;
        setStaged(next);
        return relativeSrc(path, assetPath);
      },
      resolveSrc: (src) => resolveAssetPath(schema, path, src),
      isStaged: (p) => stagedRef.current.has(p),
      toSrc: (p) => relativeSrc(path, p),
      Preview: EntryPreview,
      EntryLink: RouteLink,
      selectTarget: (key, target) => {
        if (target) selectTargets.set(key, target);
        else selectTargets.delete(key);
      },
    };
  }, [schema, listed, staged, entryOptions, files.data, path, collection, slug, selectTargets]);
  const mdKey = markdownFieldKey(def);
  // After a rebase the form may hold a body the newer file has not (kept from yours): its row shows too.
  const showBody = Object.hasOwn(start?.values ?? initialValues, BODY_KEY);
  const bodyKey = mdKey ?? (showBody ? BODY_KEY : undefined);
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
  );

  const { fields: fieldErrors, general: generalIssues } = issuesByField(issues);
  const general = [
    ...new Set(
      generalIssues
        .filter((m) => !(newer && COMPARE_MESSAGES.has(m)))
        .map((m) => (GITHUB_CONFLICT_MESSAGES.has(m) ? GITHUB_CONFLICT_TEXT : m)),
    ),
  ];

  const clearIssues = (key: string) =>
    setIssues((prev) => {
      const next = prev.filter((i) => i.path !== key && !i.path.startsWith(`${key}.`));
      return next.length === prev.length ? prev : next;
    });

  const validate = (): Issue[] => {
    const entry = formToEntry(def, form.state.values);
    const refs = new Set<string>([ref]);
    for (const p of listed) {
      const parsed = parseEntryPath(schema, p);
      if (parsed) refs.add(`${parsed.collection}/${parsed.slug}`);
    }
    return [
      ...entry.issues,
      ...validateEntry(
        schema,
        { collection, slug, data: entry.data, body: entry.body },
        { entryExists: (r) => refs.has(r), fileExists: (p) => listed.has(p) || stagedRef.current.has(p) },
      ),
    ];
  };

  /** Back to the saved file: the form, staged uploads and issues. The page preview follows the form. */
  const onDiscard = () => {
    form.reset(initialValues);
    // The ref too: the next upload builds on it, and must not bring the dropped files back.
    stagedRef.current = new Map();
    setStaged(new Map());
    setIssues([]);
  };

  /** *Revert this change*: one field back to the saved value (an existing entry only; a new one has none). */
  const onRevert = (_entry: string, row: FieldDiffRow) => {
    const key = formKeyOf(def, row.key);
    if (key === null) return;
    form.setFieldValue(key, entryToForm(def, baseline)[key]);
    clearIssues(row.key);
  };
  // Nothing left to save (every field reverted): *Your changes* closes, the entry is clean.
  if (reviewOpen && !savable && !commit.isPending) setReviewOpen(false);
  /** History's *Restore this version*: the version's values become the form's, an unsaved edit saved as usual. */
  const onRestore = (restored: FormValues) => {
    form.reset(restored, { keepDefaultValues: true });
    setIssues([]);
    // An older commit can hold the saved file again (a revert): then nothing is left to save.
    const changed = isEntryChanged(formToEntry(def, restored), baseline);
    toastManager.add({
      title: changed ? 'Version restored · save to keep it' : 'Version restored: it is the saved file',
    });
  };

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

  const onSave = () => {
    setConflict(false);
    const found = validate();
    setIssues(found);
    if (found.length === 0) setReviewOpen(true);
  };

  const usedStaged = [...staged.keys()].filter((p) =>
    referencedAssets(schema, def, path, current.data, current.body).has(p),
  );

  const showCommitError = (error: unknown) => {
    // GitHub mode: auth, rate limit and network failures in the editor's words (`errorText`).
    const message = workspace
      ? errorText(error, { repo: `${workspace.config.owner}/${workspace.config.repo}` })
      : error instanceof Error
        ? error.message
        : String(error);
    const list: Issue[] = error instanceof IssuesError ? error.issues : [{ path: '', message }];
    // Refused for a newer file: read it; once the screen has it, Compare changes replaces this banner (`general`).
    if (loaded && list.some((i) => COMPARE_MESSAGES.has(i.message))) void invalidateFiles(client);
    setIssues(list);
    setConflict(list.some((i) => RELOAD_MESSAGES.has(i.message)));
  };

  // Conflict · compare: the fields the newer file changed that differ from the form, and the editor's picks.
  const [compareOpen, setCompareOpen] = useState(false);
  const theirs = useMemo(() => (newer ? newer.file : null), [newer]);
  const conflicts = useMemo(
    () => (theirs ? conflictFields(def, baseline, theirs, current) : []),
    [theirs, def, baseline, current],
  );
  const [picks, setPicks] = useState<Record<string, ConflictPick>>({});
  const openCompare = () => {
    setPicks(defaultPicks(conflicts));
    setCompareOpen(true);
  };
  const applyCompare = () => {
    if (!newer) return;
    const values = mergeConflict(def, baseline, newer.file, current, form.state.values, picks);
    setCompareOpen(false);
    onRebase(newer, values, stagedRef.current);
  };

  const blocked = newBranch.needed && newBranch.branch === undefined;

  const confirmSave = async () => {
    if (blocked) return;
    const submitted = formToEntry(def, form.state.values);
    const { data, body } = submitted;
    const changes: SourceChange[] = [
      { path, content: serializeEntry(def, data, body, loaded?.keyOrder ?? []), sha: loaded?.sha ?? null },
      ...usedStaged.map((p) => ({ path: p, content: staged.get(p)!, sha: null })),
    ];
    onCommitStart();
    try {
      await commit.mutateAsync({
        changes,
        message: commitMessage(entrySubject(isNew ? 'create' : 'update', collection, slug), '', note),
        newBranch: newBranch.branch,
      });
    } catch (error) {
      onCommitEnd(false);
      if (isBranchTaken(error)) return void client.invalidateQueries({ queryKey: BRANCHES_KEY });
      setReviewOpen(false);
      showCommitError(error);
      return;
    }
    // Clean now (the guard and `beforeunload` read the ref before the next render), not when the saved file loads.
    dirtyRef.current = false;
    setSaved(submitted);
    // The branch layer now carries the saved change (local mode: the dev server serves it).
    setFormPreview(ref, null);
    onCommitEnd(true);
    setReviewOpen(false);
    setIssues([]);
    setNote('');
    // The first confirmation of the redesign (FigCraft *Saved*): a toast, polite, gone after a few seconds.
    toastManager.add({ title: workspace ? 'Saved · 1 commit' : 'Saved to disk' });
    void refreshSite();
  };

  const confirmDelete = async () => {
    if (!loaded || blocked) return;
    onCommitStart();
    const withRefs = removePlan !== null && removeRefs;
    try {
      await commit.mutateAsync({
        changes: withRefs ? removeChanges(schema, removePlan, listedSha) : [{ path, content: null, sha: loaded.sha }],
        message: commitMessage(entrySubject('delete', collection, slug)),
        newBranch: newBranch.branch,
      });
    } catch (error) {
      onCommitEnd(false);
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
    onCommitStart();
    try {
      const changes = await renameChanges(schema, plan, (p) => source.readFile(p), listedSha);
      await commit.mutateAsync({
        changes,
        message: commitMessage(renameSubject(collection, slug, to)),
        newBranch: newBranch.branch,
      });
    } catch (error) {
      onCommitEnd(false);
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
  const changes = useMemo(
    () => (dirty ? entryDiff(def, loaded ? baseline : null, current).length : 0),
    [dirty, def, loaded, baseline, current],
  );
  // The status line's *Unsaved changes* link: with a newer file a save would be refused, so it compares too.
  useReportEntryStatus({ draft, dirty, isNew, changes }, newer && dirty ? openCompare : onSave);

  const history = useEntryHistory(path, isNew ? null : shaOf(loaded));
  const changedKeys = useMemo(
    () => new Set(dirty && loaded ? entryDiff(def, baseline, current).map((r) => r.key) : []),
    [dirty, loaded, def, baseline, current],
  );
  const item = (key: string, field: Field, valueKey: string): FieldItem => ({
    key,
    name: key,
    field,
    value: values[valueKey],
    onChange: (v) => {
      form.setFieldValue(valueKey, v);
      clearIssues(key);
    },
    error: fieldErrors[key],
    changed: changedKeys.has(key),
  });
  // Frontmatter fields first, then the body: the rows follow the file's own order.
  const items: FieldItem[] = [
    ...Object.entries(def.fields).flatMap(([key, field]) => (field.type === 'markdown' ? [] : [item(key, field, key)])),
    ...(mdKey !== undefined ? [item(mdKey, def.fields[mdKey]!, BODY_KEY)] : []),
    ...(mdKey === undefined && showBody ? [item(BODY_KEY, BODY_FIELD, BODY_KEY)] : []),
  ];
  const titles = useMemo(() => new Map(entryOptions.map((o) => [o.ref, o.title])), [entryOptions]);
  const titleOf = (r: string) => titles.get(r) ?? (files.data === undefined ? r : `Not found: ${r}`);
  const titleValue = def.titleField ? values[def.titleField] : itemTitle(def.fields, values);
  const entryTitle = typeof titleValue === 'string' && titleValue.trim() !== '' ? titleValue.trim() : slug;
  const invalidItems = items.filter((i) => (i.error?.length ?? 0) > 0);
  // A new, blank entry: the required fields still empty. The CTA walks to them one by one (FigCraft *New post*), before
  // a save attempt marks them as errors.
  // A required field inside an object or a block counts for its row (`seo.title` → `seo`). Only when the values change.
  /* oxlint-disable react-hooks/exhaustive-deps -- `validate` reads the form's values, which `values` mirrors */
  const requiredKeys = useMemo(
    () => (isNew ? requiredFieldKeys(validate()) : null),
    // `validate` reads the form's values, which `values` mirrors.
    [isNew, values],
  );
  /* oxlint-enable react-hooks/exhaustive-deps */
  const emptyRequired = requiredKeys ? items.filter((i) => requiredKeys.has(i.key)) : [];
  const shownItems = tabbed ? items.filter((i) => groupOf(groups, i.key) === activeGroup) : items;

  const parent = parentRoute(def.singleton ? { kind: 'collection', collection } : { kind: 'entry', collection, slug });
  const back = parent ? (
    <RouteLink
      to={parent}
      className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
      aria-label="Back"
      title={`Back to ${def.singleton ? 'All content' : def.label}`}
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
      {isNew ? 'Save' : `Save ${changes} ${changes === 1 ? 'change' : 'changes'}`}
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
    <StatusBadge draft={draft} showPublished />
  );

  const banners = (
    <>
      {chrome.banners}
      {notices}
      <SelectNoticeBanner {...selectNotice} />
      {invalidItems.length > 0 ? (
        <Banner tone="danger">
          {invalidItems.length === 1
            ? `${invalidItems[0]!.field.label} needs a fix before you can save.`
            : `${invalidItems.length} fields need a fix before you can save.`}
        </Banner>
      ) : null}
      {general.length > 0 ? (
        <Banner
          tone="danger"
          role="alert"
          action={
            conflict ? (
              <Button size="md" onClick={onReload}>
                Reload
              </Button>
            ) : undefined
          }
        >
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {general.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </Banner>
      ) : null}
    </>
  );

  return (
    <StagedContext.Provider value={staged}>
      <EntryView
        section={def.singleton ? 'All content' : def.label}
        back={back}
        actions={
          <>
            {isNew ? null : (
              <IconButton
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
        after={<UsedBy schema={schema} items={usedBy} />}
        status={chrome.status}
        cta={cta}
      >
        {isNew ? null : (
          <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} title={entryTitle}>
            {def.singleton ? null : (
              <ActionRow
                icon="copy"
                disabled={dirty || files.data === undefined}
                note={dirty ? 'Save first' : undefined}
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
                note={dirty ? 'Save first' : undefined}
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
        <Sheet open={detailsOpen} onOpenChange={setDetailsOpen} title="Details" sub={entryTitle}>
          <EntryDetails history={history} />
        </Sheet>
        {isNew ? null : (
          <EntryHistory
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            path={path}
            sha={shaOf(loaded)}
            entryTitle={entryTitle}
            def={def}
            current={current}
            dirty={dirty}
            historyUrl={history.historyUrl}
            onRestore={onRestore}
          />
        )}
      </EntryView>
      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        entries={
          reviewOpen ? reviewEntries(ref, entryTitle, def.label, entryDiff(def, loaded ? baseline : null, current)) : []
        }
        newFiles={usedStaged}
        saveTo={saveTo}
        newBranch={newBranch.needed ? <NewBranchField {...newBranch} /> : undefined}
        note={workspace ? <ApprovalNote paths={[path, ...usedStaged]} rules={codeowners} /> : undefined}
        confirmLabel={isNew ? 'Save' : `Save ${changes} ${changes === 1 ? 'change' : 'changes'}`}
        busy={commit.isPending}
        confirmDisabled={blocked}
        inline={wide}
        onConfirm={() => void confirmSave()}
        onRevert={isNew ? undefined : onRevert}
        commitNote={workspace ? { value: note, onChange: setNote } : undefined}
      />
      <CompareSheet
        open={compareOpen && newer !== null}
        onOpenChange={setCompareOpen}
        fields={conflicts}
        picks={picks}
        onPick={(key, pick) => setPicks((prev) => ({ ...prev, [key]: pick }))}
        where={workspace ? 'github' : 'disk'}
        onApply={applyCompare}
      />
      <Confirm
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="The form goes back to the saved file. New uploads that are not saved are dropped."
        confirmLabel="Discard"
        onConfirm={onDiscard}
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
        confirmDisabled={blocked || (usedBy.length > 0 && (!removeRefs || removeProblems.length > 0))}
        onConfirm={() => void confirmDelete()}
      >
        {usedBy.length > 0 ? (
          <>
            <ReferrerList schema={schema} items={usedBy} />
            {removeProblems.length > 0 ? (
              <div className="mt-2 inline-flex items-center gap-1.5 text-sm text-destructive" role="alert">
                <Icon name="x" size={16} />
                <span>
                  Removing the references would leave these entries invalid; fix them first: {removeProblems.join('; ')}
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
          blocked={blocked}
          onConfirm={(plan) => void confirmRename(plan)}
        >
          <NewBranchField {...newBranch} />
        </RenameDialog>
      ) : null}
    </StagedContext.Provider>
  );
}

type Base = { data: EntryFileData | null; generation: number };

const shaOf = (d: EntryFileData | null | undefined) => d?.sha ?? null;

/**
 * The entry screen: loads the schema and the file (a missing file is a new, unsaved entry), then renders the form
 * keyed by path + sha. A disk change (of the file or the schema) replaces a clean form; a dirty one keeps its file and
 * schema and gets a "changed on disk" banner + Reload.
 */
export function Entry({ collection, slug }: { collection: string; slug: string }) {
  const schemaQ = useSchema();
  const liveSchema = schemaQ.data?.schema;
  // The schema the form was built with; a dirty form keeps it until Reload.
  const [schema, setSchema] = useState<Schema | undefined>(liveSchema);
  const path = schema ? entryFilePath(schema, collection, slug) : null;
  const fileQ = useEntryFile(path);
  const client = useQueryClient();
  const { status, send } = useBridge();
  const ref = `${collection}/${slug}`;

  // New-entry values from the New entry dialog: read once, dropped when the screen closes.
  const [pending] = useState(() => pendingNewEntries.get(ref));
  const [copy] = useState(() => pendingCopies.get(ref));
  useEffect(
    () => () => {
      pendingNewEntries.delete(ref);
      pendingCopies.delete(ref);
    },
    [ref],
  );

  useEffect(() => {
    if (status !== 'connected') return;
    send({ type: 'highlight', entry: ref });
    return () => send({ type: 'highlight', entry: null });
  }, [status, send, ref]);

  const [base, setBase] = useState<Base | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [expectChange, setExpectChange] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  // After Conflict · compare: the form that mounts on the newer file starts from the picks (keyed by that form).
  const [carry, setCarry] = useState<{ key: string; values: FormValues; staged: Map<string, Uint8Array> } | null>(null);
  const workspace = useWorkspace();
  const latest = fileQ.data;

  if (liveSchema && (schema === undefined || (liveSchema !== schema && !dirty))) {
    setSchema(liveSchema);
    if (base !== undefined) setBase({ data: base.data, generation: base.generation + 1 });
  }
  const schemaStale = liveSchema !== undefined && schema !== undefined && liveSchema !== schema;

  // Adopt the loaded file: first load, a disk change while clean, or our own commit landing.
  if (latest !== undefined) {
    if (base === undefined) setBase({ data: latest, generation: 0 });
    else if (shaOf(latest) !== shaOf(base.data) && (!dirty || expectChange)) {
      setBase({ data: latest, generation: base.generation + 1 });
      setDirty(false);
      setExpectChange(false);
    }
  }
  const stale = base !== undefined && latest !== undefined && shaOf(latest) !== shaOf(base.data);

  const def = schema?.collections[collection];
  const initial = useMemo<EntryFile | undefined>(() => {
    if (!def || base === undefined) return undefined;
    if (base.data) return base.data.file;
    if (copy) return copy;
    return { data: { ...initialData(def), ...pending }, body: '' };
  }, [def, base, pending, copy]);

  const reload = () => {
    if (liveSchema) setSchema(liveSchema);
    setBase({ data: latest ?? base?.data ?? null, generation: (base?.generation ?? 0) + 1 });
    setDirty(false);
    void invalidateFiles(client);
  };

  const chrome = useScreenChrome();
  const ready = schema && def && path && base && initial;
  if (!ready) {
    const failed = schemaQ.error ?? fileQ.error;
    // Loading (or failed before anything loaded): the screen's frame with placeholder rows, so the bar stays put.
    return (
      <EntryView
        section={def?.label ?? collection}
        actions={chrome.windowActions}
        title={slug}
        banners={
          <>
            {chrome.banners}
            {failed ? (
              <Banner tone="danger" role="alert">
                {failed.message}
              </Banner>
            ) : null}
          </>
        }
        fieldsLabel={`${ref} fields`}
        fields={
          failed ? null : (
            <>
              <FieldRow label="Loading" loading />
              <FieldRow label="Loading" loading />
              <FieldRow label="Loading" loading />
            </>
          )
        }
        status={chrome.status}
      />
    );
  }
  // A newer version of a saved file while the form has edits: compare field by field (a deleted file, or a new entry
  // whose path was taken meanwhile, keeps Reload: there is nothing to compare).
  const newer = stale && !expectChange && dirty && base.data && latest ? latest : null;
  const formKey = (data: EntryFileData | null, generation: number) => `${path}:${shaOf(data) ?? 'new'}:${generation}`;
  const notices = (
    <>
      {fileQ.error ? (
        <Banner tone="danger" role="alert">
          {fileQ.error.message}
        </Banner>
      ) : null}
      {newer ? (
        // FigCraft *Entry · conflict* (GitHub) and *Entry · changed on disk* (dev, which keeps Reload).
        <Banner
          tone="unsaved"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prop of the Banner part (a div), which takes its live role from the caller
          role="status"
          action={
            workspace ? undefined : (
              <Button size="md" onClick={reload}>
                Reload
              </Button>
            )
          }
        >
          {workspace
            ? 'Someone saved this entry on GitHub after you opened it. Your edits are kept.'
            : 'This file changed on disk. Your edits are kept.'}
        </Banner>
      ) : (stale && !expectChange) || schemaStale ? (
        <Banner
          tone="unsaved"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prop of the Banner part (a div), which takes its live role from the caller
          role="status"
          action={
            <Button size="md" onClick={reload}>
              Reload
            </Button>
          }
        >
          {stale && !expectChange ? 'This file changed on disk' : 'The schema changed on disk'}
        </Banner>
      ) : null}
    </>
  );
  return (
    <EntryForm
      key={formKey(base.data, base.generation)}
      schema={schema}
      collection={collection}
      slug={slug}
      path={path}
      loaded={base.data}
      initial={initial}
      onDirtyChange={setDirty}
      onCommitStart={() => setExpectChange(true)}
      onCommitEnd={(ok) => {
        if (!ok) setExpectChange(false);
      }}
      onReload={reload}
      chrome={chrome}
      notices={notices}
      group={group}
      onGroupChange={setGroup}
      newer={newer}
      start={carry?.key === formKey(base.data, base.generation) ? carry : undefined}
      onRebase={(file, values, staged) => {
        const generation = base.generation + 1;
        setCarry({ key: formKey(file, generation), values, staged });
        setBase({ data: file, generation });
      }}
    />
  );
}
