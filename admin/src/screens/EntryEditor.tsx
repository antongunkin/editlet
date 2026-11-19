import { useForm, useStore } from '@tanstack/react-form';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { LoadedEntry } from './EntryLoader';
import { shortName } from './EntryMeta';
import type { FieldItem } from './FieldRows';

import { serializeEntryFile } from '../../../core/entryFile';
import type { Issue } from '../../../core/issues';
import { isHiddenContentPath, isImagePath, parseEntryPath, resolveAssetPath } from '../../../core/paths';
import { referenceFields } from '../../../core/references';
import { markdownFieldKey, type Collection, type Field } from '../../../core/schema';
import { validateEntry } from '../../../core/validate';
import { GitHubError } from '../../../github';
import { onChanges, TAB_ID, useChangesStore } from '../changes/store';
import { useBuffer, useChangesTray, useOpenChanges } from '../changes/trayContext';
import { ImagePlaceholder, PreviewImage } from '../data/PreviewImage';
import { invalidateFiles, IssuesError, useCommit, useEntryOptions, useFiles } from '../data/queries';
import { AssetPreview, canOpenInWindow, mimeType } from '../data/useAssetUrl';
import { CompareSheet } from '../diff/CompareSheet';
import {
  COMPARE_MESSAGES,
  issuesByField,
  referencedAssets,
  relativeSrc,
  requiredFieldKeys,
  uniqueAssetPath,
} from '../entry/changes';
import { conflictFields, defaultPicks, mergeConflict, type ConflictPick } from '../entry/conflict';
import { entryDiff, formKeyOf, type FieldDiffRow } from '../entry/diff';
import { itemTitle } from '../entry/summary';
import {
  BODY_KEY,
  entryToForm,
  formToEntry,
  isEntryChanged,
  serializeEntry,
  type DataBody,
  type FormValues,
} from '../entry/values';
import type { FieldContext } from '../fields';
import { errorText } from '../github/errors';
import { useNewBranch } from '../github/NewBranchField';
import { relativeTime } from '../github/relativeTime';
import { useCommitMessage } from '../github/style';
import { useWorkspace } from '../github/workspace';
import { imageBytes, imageFileError } from '../media/edits';
import { usePreview } from '../preview/PreviewProvider';
import { fieldPreviews } from '../preview/snapshot';
import { RouteLink } from '../RouteLink';
import type { SelectTarget } from '../select/useApplySelect';
import { sourceKey, useSource } from '../source/context';
import { Banner, Button } from '../ui';
import { toastManager } from '../ui/primitives/toast';
import { useBridge } from '../useRoute';

/** The GitHub source's conflict issues: shown as `GITHUB_CONFLICT_TEXT`, with Reload. */
const GITHUB_CONFLICT_MESSAGES = new Set([
  'Changed on GitHub since it was read; reload and review',
  'Branch keeps changing; try again',
]);
const GITHUB_CONFLICT_TEXT =
  'This entry changed on GitHub since you opened it. Reload to read it, then review your change again.';
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
export const isBranchTaken = (error: unknown) => error instanceof GitHubError && error.code === 'branch_exists';

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

/** Collections that the reference fields of `collection` (nested ones too) may point at. */
function referenceTargets(collection: Collection): string[] {
  return [...new Set(referenceFields(collection).flatMap(([, field]) => field.collections))];
}

export type EntryEditorOptions = {
  entry: LoadedEntry;
  /** The entry sheet the field widgets open for *Edit <title>* (the entry screen's; none in an entry sheet). */
  entrySheet?: FieldContext['EntrySheet'];
  /** Hand the form to *Your changes* as the open entry (default `true`; an entry on top is not). */
  registerHandle?: boolean;
  /** Prefixed to every field item's `name` (its row's id, `${name}-problem`): a second form in the window. */
  prefix?: string;
  /** Where the field widgets register their select-to-edit targets; without it they register none. */
  selectTargets?: Map<string, SelectTarget>;
  /** The entry the new-branch name comes from (`<prefix><collection>-<slug>`); default this entry. */
  branchFrom?: { collection: string; slug: string; singleton: boolean };
};

/**
 * One entry's form without the screen around it (`EntryScreen`, and later an entry on top of a picker): the form and
 * its baseline, dirty, validation and the required fields, staged uploads, the field context and the field items, the
 * page preview of this ref, the review and the save (*Your changes*, the commit, the new branch, the conflict
 * *Compare*). Use it inside the child of `EntryLoader` (the form is rebuilt per generation) and render
 * `<EntryEditorFrame editor>` around the form's view and its `dialogs`.
 */
export function useEntryEditor({
  entry,
  prefix = '',
  selectTargets,
  branchFrom,
  entrySheet,
  registerHandle = true,
}: EntryEditorOptions) {
  const { schema, def, collection, slug, path, loaded, initial, newer, start } = entry;
  const ref = `${collection}/${slug}`;
  const isNew = loaded === null;
  const files = useFiles();
  const commit = useCommit();
  const client = useQueryClient();
  const from = branchFrom ?? { collection, slug, singleton: def.singleton === true };
  const newBranch = useNewBranch(from.collection, from.slug, from.singleton);
  const workspace = useWorkspace();
  const commitMessage = useCommitMessage();
  const openChanges = useOpenChanges();
  const { register, open: trayOpen } = useChangesTray();
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
  // Read by the leave guard and `beforeunload`, which run before the next render.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const { onDirtyChange } = entry;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const [staged, setStaged] = useState<Staged>(() => start?.staged ?? new Map());
  const stagedRef = useRef(staged);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [conflict, setConflict] = useState(false);

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

  const ctx = useMemo<FieldContext>(() => {
    const assets = `${schema.contentDir}/`;
    const images = [
      ...new Set([
        ...[...listed].filter((p) => p.startsWith(assets) && isImagePath(p) && !isHiddenContentPath(schema, p)),
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
      EntrySheet: entrySheet,
      selfRef: ref,
      // Targets are found by the plain field key (`useApplySelect`), whatever the items' name prefix.
      selectTarget: selectTargets
        ? (name, target) => {
            const key = name.startsWith(prefix) ? name.slice(prefix.length) : name;
            if (target) selectTargets.set(key, target);
            else selectTargets.delete(key);
          }
        : undefined,
    };
  }, [
    schema,
    listed,
    staged,
    entryOptions,
    files.data,
    path,
    collection,
    slug,
    selectTargets,
    prefix,
    entrySheet,
    ref,
  ]);
  const mdKey = markdownFieldKey(def);
  // After a rebase the form may hold a body the newer file has not (kept from yours): its row shows too.
  const showBody = Object.hasOwn(start?.values ?? initialValues, BODY_KEY);
  const bodyKey = mdKey ?? (showBody ? BODY_KEY : undefined);

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
    const submitted = formToEntry(def, form.state.values);
    const refs = new Set<string>([ref]);
    for (const p of listed) {
      const parsed = parseEntryPath(schema, p);
      if (parsed) refs.add(`${parsed.collection}/${parsed.slug}`);
    }
    return [
      ...submitted.issues,
      ...validateEntry(
        schema,
        { collection, slug, data: submitted.data, body: submitted.body },
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

  const onSave = () => {
    setConflict(false);
    const found = validate();
    setIssues(found);
    // The tray lists the rows of the buffer: this form's goes in first, and the list is read again before it opens.
    if (found.length === 0)
      void flush()
        .then(() => client.refetchQueries({ queryKey: ['changes'] }))
        .then(openChanges);
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
  // Who saved the newer file and when, for the compare card's side (*On GitHub · Mo, 10m ago*): the file's latest commit,
  // when it is the one the screen holds (a newer commit since, a refused read or a source without history: no label).
  const newerVersion = useQuery({
    queryKey: ['newer-version', sourceKey(source), path, newer?.sha] as const,
    enabled: newer !== null && typeof source.listVersions === 'function',
    retry: false,
    queryFn: () => source.listVersions!(path, 1),
  });
  const latestVersion = newerVersion.data?.[0];
  const newerBy =
    newer && latestVersion && latestVersion.sha === newer.sha
      ? [shortName(latestVersion.actor), relativeTime(latestVersion.date)].filter(Boolean).join(', ') || undefined
      : undefined;
  const [picks, setPicks] = useState<Record<string, ConflictPick>>({});
  const openCompare = () => {
    setPicks(defaultPicks(conflicts));
    setCompareOpen(true);
  };
  const applyCompare = () => {
    if (!newer) return;
    const merged = mergeConflict(def, baseline, newer.file, current, form.state.values, picks);
    setCompareOpen(false);
    entry.onRebase(newer, merged, stagedRef.current);
  };

  const blocked = newBranch.needed && newBranch.branch === undefined;

  // --- The buffer of unsaved changes (changes across entries): the form writes its row, the screen reads it back.
  const store = useChangesStore();
  const buffer = useBuffer();
  const { addBeforeClose } = useBridge();
  const [writeFailed, setWriteFailed] = useState(false);
  // The entry was edited in another tab: this form stops writing until Reload (the last writer would silently win).
  const [otherTab, setOtherTab] = useState(false);
  const otherTabRef = useRef(false);
  // An existing entry has a row while it has edits; a new entry or copy from its first moment (so that the typed name
  // survives leaving and a reload), removed again on leaving while untouched.
  const keep = !entry.rowLocked && (dirty || (isNew && saved === null));
  const rowText = useMemo(
    () => serializeEntry(def, current.data, current.body, loaded?.keyOrder ?? []),
    [def, current, loaded],
  );
  const baseText = useMemo(() => (loaded ? serializeEntryFile(loaded.file, loaded.keyOrder) : null), [loaded]);
  const images = usedStaged.map((p) => ({ path: p, content: staged.get(p)!, sha: null }));
  const imagePart = usedStaged.toSorted().join(',');
  const signature = `${loaded?.sha ?? ''}|${rowText}|${imagePart}`;
  // `keepOnLeave`: a new entry that is still untouched leaves no row behind (the abandoned *New* clicks).
  const keepOnLeave = !entry.rowLocked && dirty;
  const latestWrite = useRef({
    keep,
    keepOnLeave,
    signature,
    path,
    rowText,
    baseText,
    images,
    sha: loaded?.sha ?? null,
  });
  latestWrite.current = { keep, keepOnLeave, signature, path, rowText, baseText, images, sha: loaded?.sha ?? null };
  // The signature of the row in the buffer: the one this form opened on, else nothing.
  const written = useRef<string | null>(
    entry.seedRow ? `${entry.seedRow.sha ?? ''}|${entry.seedRow.content as string}|${imagePart}` : null,
  );
  useEffect(() => {
    entry.discarding.current = false;
  }, [entry.discarding]);
  /** The signature to write (`null`: remove the row), or `undefined` when the buffer already holds the form. */
  const toWrite = useCallback(
    (leaving = false): { next: string | null } | undefined => {
      if (!store || entry.rowLocked || otherTabRef.current || entry.discarding.current) return undefined;
      const w = latestWrite.current;
      const next = (leaving ? w.keepOnLeave : w.keep) ? w.signature : null;
      return next === written.current ? undefined : { next };
    },
    [store, entry.rowLocked, entry.discarding],
  );
  const flush = useCallback(
    async (leaving = false) => {
      const w = latestWrite.current;
      const pending = toWrite(leaving);
      if (!pending || !store) return;
      const { next } = pending;
      try {
        if (next !== null) {
          await store.writeEntry({ path: w.path, content: w.rowText, sha: w.sha, base: w.baseText, v: 1 }, w.images);
        } else {
          await store.removeEntry(w.path);
          await store.pruneImages(schema);
        }
        written.current = next;
        setWriteFailed(false);
      } catch {
        setWriteFailed(true);
      }
    },
    [store, toWrite, schema],
  );
  // 300 ms after the last change; and at once when the entry closes, the page hides or the admin closes.
  useEffect(() => {
    if (!store) return;
    // While *Your changes* is open it reads the buffer: a revert there is written at once.
    const timer = setTimeout(() => void flush(), trayOpen ? 0 : 300);
    return () => clearTimeout(timer);
  }, [store, signature, keep, otherTab, flush, trayOpen]);
  useEffect(
    () => () => {
      void flush(true);
    },
    [flush],
  );
  useEffect(() => {
    const hide = () => void flush();
    const onVisibility = () => document.visibilityState === 'hidden' && hide();
    window.addEventListener('pagehide', hide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', hide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);
  // `null` when nothing is waiting: the admin then closes at once.
  useEffect(() => addBeforeClose(() => (toWrite() ? flush() : null)), [addBeforeClose, toWrite, flush]);
  const scope = store?.scope;
  useEffect(
    () =>
      onChanges((message) => {
        if (message.tab === TAB_ID || message.scope !== scope || !message.paths.includes(path)) return;
        otherTabRef.current = true;
        setOtherTab(true);
      }),
    [scope, path],
  );
  /**
   * Leaving this form loses nothing: its edits are in the buffer (a persistent store, no failed write, no other tab
   * having taken the row over). The leave guard and `beforeunload` then do not ask.
   */
  const keptRef = useRef(false);
  keptRef.current = (store?.persistent ?? false) && !writeFailed && !otherTab;

  // The tray saves (*Your changes*): it asks this form for its live entry, and tells it how the save went.
  const handleApi = {
    flush: async () => {
      await flush();
      return formToEntry(def, form.state.values);
    },
    saved: (submitted: DataBody) => {
      // Clean now (the guard and `beforeunload` read the ref before the next render), not when the saved file loads.
      dirtyRef.current = false;
      written.current = null;
      setSaved({ ...submitted, issues: [] });
      // The branch layer now carries the saved change (local mode: the dev server serves it).
      setFormPreview(ref, null);
      setIssues([]);
    },
    showError: (error: unknown) => showCommitError(error),
    revert: (row: FieldDiffRow) => onRevert('', row),
    discard: onDiscard,
  };
  const handleRef = useRef(handleApi);
  handleRef.current = handleApi;
  const { onCommitStart, onCommitEnd } = entry;
  useEffect(
    () =>
      !registerHandle
        ? undefined
        : register({
            path,
            flush: () => handleRef.current.flush(),
            commitStart: onCommitStart,
            commitEnd: onCommitEnd,
            saved: (submitted) => handleRef.current.saved(submitted),
            showError: (error) => handleRef.current.showError(error),
            revert: (row) => handleRef.current.revert(row),
            discard: () => handleRef.current.discard(),
          }),
    [register, registerHandle, path, onCommitStart, onCommitEnd],
  );

  const changes = useMemo(
    () => (dirty ? entryDiff(def, loaded ? baseline : null, current).length : 0),
    [dirty, def, loaded, baseline, current],
  );
  const changedKeys = useMemo(
    () => new Set(dirty && loaded ? entryDiff(def, baseline, current).map((r) => r.key) : []),
    [dirty, loaded, def, baseline, current],
  );
  const item = (key: string, field: Field, valueKey: string): FieldItem => ({
    key,
    name: prefix + key,
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

  /** The form's own banners: a field that blocks saving, and the save's general issues (with Reload on a conflict). */
  const issueBanners = (
    <>
      {otherTab ? (
        <Banner
          tone="unsaved"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a prop of the Banner part (a div), which takes its live role from the caller
          role="status"
          action={
            <Button size="md" onClick={entry.reseed}>
              Reload
            </Button>
          }
        >
          Edited in another tab. Reload to see those edits; yours here are not kept.
        </Banner>
      ) : null}
      {writeFailed ? (
        <Banner tone="danger" role="alert">
          Your changes could not be kept on this device. Save them before you leave.
        </Banner>
      ) : null}
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
              <Button size="md" onClick={entry.reload}>
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

  // *Your changes* saves every buffered entry in one commit: the CTA counts the other entries' fields too.
  const othersRows = buffer.entries.filter((e) => e.path !== path).reduce((n, e) => n + e.rows.length, 0);
  const total = changes + othersRows;
  const saveLabel = isNew && othersRows === 0 ? 'Save' : `Save ${total} ${total === 1 ? 'change' : 'changes'}`;
  /** *Conflict · compare* (*Your changes* is the tray's: `changes/ChangesTray.tsx`). */
  const dialogs = (
    <>
      <CompareSheet
        open={compareOpen && newer !== null}
        onOpenChange={setCompareOpen}
        fields={conflicts}
        picks={picks}
        onPick={(key, pick) => setPicks((prev) => ({ ...prev, [key]: pick }))}
        where={workspace ? 'github' : 'disk'}
        by={newerBy}
        onApply={applyCompare}
      />
    </>
  );

  return {
    ref,
    isNew,
    form,
    values,
    initialValues,
    baseline,
    current,
    saved,
    dirty,
    dirtyRef,
    keptRef,
    savable,
    staged,
    listed,
    ctx,
    items,
    bodyKey,
    titleOf,
    entryTitle,
    changes,
    saveLabel,
    invalidItems,
    emptyRequired,
    issueBanners,
    commit,
    newBranch,
    blocked,
    workspace,
    showCommitError,
    commitMessage,
    onSave,
    openCompare,
    onDiscard,
    onRestore,
    dialogs,
  };
}

export type EntryEditor = ReturnType<typeof useEntryEditor>;

/** Around a form's view and its `dialogs`: the staged uploads, for the image previews. */
export function EntryEditorFrame({ editor, children }: { editor: EntryEditor; children: ReactNode }) {
  return <StagedContext.Provider value={editor.staged}>{children}</StagedContext.Provider>;
}
