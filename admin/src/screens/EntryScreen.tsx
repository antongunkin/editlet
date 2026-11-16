import { useForm, useStore } from '@tanstack/react-form';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { EntryMeta } from './EntryMeta';
import { RenameDialog } from './RenameDialog';
import { ReferrerList, UsedBy } from './UsedBy';

import { findImageRefs } from '../../../core/assets';
import type { EntryFile } from '../../../core/entryFile';
import { entrySubject, renameSubject } from '../../../core/gitStyle';
import type { Issue } from '../../../core/issues';
import { entryFilePath, isHiddenContentPath, isImagePath, parseEntryPath, resolveAssetPath } from '../../../core/paths';
import { referenceFields } from '../../../core/references';
import { planRemove, type RenamePlan } from '../../../core/rename';
import { markdownFieldKey, type Collection, type Field, type Schema } from '../../../core/schema';
import { initialData, validateEntry } from '../../../core/validate';
import { GitHubError } from '../../../github';
import { PreviewImage } from '../data/PreviewImage';
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
import { ReviewDialog } from '../diff/ReviewDialog';
import { issuesByField, relativeSrc, uniqueAssetPath } from '../entry/changes';
import { entryDiff } from '../entry/diff';
import { pendingNewEntries } from '../entry/pending';
import { removeChanges, removeIssues, renameChanges } from '../entry/plans';
import {
  BODY_KEY,
  DRAFT_KEY,
  entryToForm,
  formToEntry,
  isEntryChanged,
  serializeEntry,
  type FormValues,
} from '../entry/values';
import { FieldWidget, type FieldContext } from '../fields';
import { errorText } from '../github/errors';
import { NewBranchField, useNewBranch } from '../github/NewBranchField';
import { ApprovalNote, useCodeowners, useCommitMessage } from '../github/style';
import { BRANCHES_KEY, useWorkspace } from '../github/workspace';
import { imageBytes, imageFileError } from '../media/edits';
import { usePreview, useSiteRefresh } from '../preview/PreviewProvider';
import { fieldPreviews } from '../preview/snapshot';
import { RouteLink } from '../RouteLink';
import { SelectNoticeBanner } from '../select/SelectNoticeBanner';
import { useApplySelect, type SelectTarget } from '../select/useApplySelect';
import { useSource } from '../source/context';
import type { SourceChange } from '../source/local';
import { AlertDialog, Button, Icon } from '../ui';
import { useBridge, useRoute } from '../useRoute';
import { useReportEntryStatus } from '../window/entryStatus';

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
const isBranchTaken = (error: unknown) => error instanceof GitHubError && error.code === 'branch_exists';

type Staged = Map<string, Uint8Array>;

const StagedContext = createContext<Staged>(new Map());

function StagedImage({
  path,
  bytes,
  alt,
  openable,
}: {
  path: string;
  bytes: Uint8Array;
  alt: string;
  openable?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return;
    const next = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(path) }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [path, bytes]);
  if (url) return <PreviewImage url={url} alt={alt} openable={openable && canOpenInWindow(path)} />;
  return (
    <div className="editlet-ff-image__empty" role="img" aria-label={alt || 'No image'}>
      <Icon.Image size={16} />
    </div>
  );
}

/** Preview for a repo path: staged bytes (object URL) when staged, else the listed file. */
function EntryPreview({ path, alt, openable }: { path: string | null; alt: string; openable?: boolean }) {
  const staged = useContext(StagedContext);
  const bytes = path === null ? undefined : staged.get(path);
  if (path !== null && bytes) return <StagedImage path={path} bytes={bytes} alt={alt} openable={openable} />;
  return createElement(AssetPreview, { path, alt, openable });
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
  const { navigate } = useRoute();
  const { setGuard } = useBridge();
  const refreshSite = useSiteRefresh();
  const { setFormPreview } = usePreview();
  const source = useSource();

  const [initialValues] = useState<FormValues>(() => entryToForm(def, initial));
  const form = useForm({ defaultValues: initialValues });
  const values = useStore(form.store, (s) => s.values);

  // After a successful save the submitted entry is the baseline, so the form is clean before the saved file loads.
  const [saved, setSaved] = useState<ReturnType<typeof formToEntry> | null>(null);
  const baseline = useMemo(() => saved ?? formToEntry(def, initialValues), [saved, def, initialValues]);
  const current = useMemo(() => formToEntry(def, values), [def, values]);
  const dirty = isEntryChanged(current, baseline);
  const savable = isNew || dirty;

  const [staged, setStaged] = useState<Staged>(() => new Map());
  const stagedRef = useRef(staged);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [removeRefs, setRemoveRefs] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const moreId = useId();
  const moreMenu = useRef<HTMLDivElement>(null);

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
      toSrc: (p) => relativeSrc(path, p),
      Preview: EntryPreview,
      EntryLink: RouteLink,
      selectTarget: (key, target) => {
        if (target) selectTargets.set(key, target);
        else selectTargets.delete(key);
      },
    };
  }, [schema, listed, staged, entryOptions, files.data, path, collection, slug, selectTargets]);
  const selectNotice = useApplySelect(ref, def, () => form.state.values, selectTargets);

  const { fields: fieldErrors, general: generalIssues } = issuesByField(issues);
  const general = [...new Set(generalIssues.map((m) => (GITHUB_CONFLICT_MESSAGES.has(m) ? GITHUB_CONFLICT_TEXT : m)))];

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
    setStaged(new Map());
    setIssues([]);
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
    setIssues(list);
    setConflict(list.some((i) => RELOAD_MESSAGES.has(i.message)));
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
        message: commitMessage(entrySubject(isNew ? 'create' : 'update', collection, slug)),
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

  const mdKey = markdownFieldKey(def);
  const showBody = Object.hasOwn(initialValues, BODY_KEY);
  const draft = values[DRAFT_KEY] === true;
  const changes = useMemo(
    () => (dirty ? entryDiff(def, loaded ? baseline : null, current).length : 0),
    [dirty, def, loaded, baseline, current],
  );
  useReportEntryStatus({ draft, dirty, isNew, changes }, onSave);

  const renderField = (key: string, field: Field, valueKey: string) => (
    <form.Field key={key} name={valueKey}>
      {(f) => (
        <FieldWidget
          name={key}
          field={field}
          value={f.state.value}
          onChange={(v) => {
            f.handleChange(v);
            clearIssues(key);
          }}
          onBlur={f.handleBlur}
          error={fieldErrors[key]}
          ctx={ctx}
        />
      )}
    </form.Field>
  );

  // Save and, for a saved entry, a chevron that opens Discard changes and Delete: two default (ink) buttons joined
  // into one split button.
  const actionButtons = (
    <div className="editlet-split">
      <Button
        variant="default"
        icon={<Icon.Check size={16} />}
        disabled={!savable || commit.isPending}
        onClick={onSave}
      >
        Save
      </Button>
      {!isNew ? (
        <>
          <span className="editlet-split__divider" aria-hidden="true" />
          <Button variant="default" iconOnly popoverTarget={moreId} aria-label="More actions" title="More actions">
            <Icon.ChevronDown size={16} />
          </Button>
        </>
      ) : null}
    </div>
  );
  const moreActions = (
    <>
      {!isNew ? (
        <div className="editlet-menu editlet-menu--actions" id={moreId} popover="auto" ref={moreMenu}>
          <button
            type="button"
            className="editlet-menu__item"
            disabled={!dirty}
            onClick={() => {
              moreMenu.current?.hidePopover?.();
              setDiscardOpen(true);
            }}
          >
            <Icon.Undo size={16} />
            Discard changes
          </button>
          {def.singleton ? null : (
            <button
              type="button"
              className="editlet-menu__item"
              disabled={dirty}
              title={dirty ? 'Save or discard the changes first' : undefined}
              onClick={() => {
                moreMenu.current?.hidePopover?.();
                setRenameOpen(true);
              }}
            >
              <Icon.Pencil size={16} />
              Rename…
            </button>
          )}
          <button
            type="button"
            className="editlet-menu__item editlet-menu__item--destructive"
            onClick={() => {
              moreMenu.current?.hidePopover?.();
              setRemoveRefs(false);
              setDeleteOpen(true);
            }}
          >
            <Icon.Trash size={16} />
            Delete
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <StagedContext.Provider value={staged}>
      <div className="editlet-page-row editlet-edit-post">
        <div className="editlet-page-content">
          <SelectNoticeBanner {...selectNotice} />
          {general.length > 0 ? (
            <div className="editlet-card editlet-card--banner editlet-entry__issues" role="alert">
              <Icon.Alert />
              <ul className="editlet-u-flex-1 editlet-u-stack editlet-u-gap-1">
                {general.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
              {conflict ? (
                <Button variant="outline" size="sm" onClick={onReload}>
                  Reload
                </Button>
              ) : null}
            </div>
          ) : null}
          <form
            className="editlet-edit-post__form-card"
            aria-label={`${ref} fields`}
            onSubmit={(e) => {
              e.preventDefault();
              if (savable) onSave();
            }}
          >
            <EntryMeta path={path} version={isNew ? null : shaOf(loaded)} />
            {/* Frontmatter fields first, then the body: the form follows the file's own order. */}
            {Object.entries(def.fields).map(([key, field]) =>
              field.type === 'markdown' ? null : renderField(key, field, key),
            )}
            {mdKey !== undefined ? renderField(mdKey, def.fields[mdKey]!, BODY_KEY) : null}
            {mdKey === undefined && showBody ? renderField(BODY_KEY, BODY_FIELD, BODY_KEY) : null}
          </form>
          <UsedBy schema={schema} items={usedBy} />
          {/* The form's split button, stuck to the bottom right of the window's scrolling body. */}
          <div className="editlet-edit-post__actions">
            {actionButtons}
            {moreActions}
          </div>
        </div>
      </div>
      <ReviewDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        rows={reviewOpen ? entryDiff(def, loaded ? baseline : null, current) : []}
        newFiles={usedStaged}
        confirmLabel={newBranch.needed ? 'Save to branch' : 'Save'}
        busy={commit.isPending}
        confirmDisabled={blocked}
        onConfirm={() => void confirmSave()}
      >
        <NewBranchField {...newBranch} />
        {workspace ? <ApprovalNote paths={[path, ...usedStaged]} rules={codeowners} /> : null}
      </ReviewDialog>
      <AlertDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard unsaved changes?"
        description="The form goes back to the saved file. New uploads that are not saved are dropped."
        confirmLabel="Discard"
        onConfirm={onDiscard}
      />
      <AlertDialog
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
              <div className="editlet-field__error" role="alert">
                <Icon.X size={11} />
                <span>
                  Removing the references would leave these entries invalid; fix them first: {removeProblems.join('; ')}
                </span>
              </div>
            ) : (
              <label className="editlet-u-row editlet-u-gap-2 editlet-u-text-sm">
                <input type="checkbox" checked={removeRefs} onChange={(e) => setRemoveRefs(e.target.checked)} />
                Also remove the references from {usedBy.length} {usedBy.length === 1 ? 'entry' : 'entries'}
              </label>
            )}
          </>
        ) : null}
        <NewBranchField {...newBranch} />
      </AlertDialog>
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
  useEffect(() => () => void pendingNewEntries.delete(ref), [ref]);

  useEffect(() => {
    if (status !== 'connected') return;
    send({ type: 'highlight', entry: ref });
    return () => send({ type: 'highlight', entry: null });
  }, [status, send, ref]);

  const [base, setBase] = useState<Base | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const [expectChange, setExpectChange] = useState(false);
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
    return { data: { ...initialData(def), ...pending }, body: '' };
  }, [def, base, pending]);

  const reload = () => {
    if (liveSchema) setSchema(liveSchema);
    setBase({ data: latest ?? base?.data ?? null, generation: (base?.generation ?? 0) + 1 });
    setDirty(false);
    void invalidateFiles(client);
  };

  const ready = schema && def && path && base && initial;
  let content: ReactNode;
  if (!ready && (schemaQ.error || fileQ.error)) {
    content = (
      <p className="editlet-u-text-danger" role="alert">
        {(schemaQ.error ?? fileQ.error)?.message}
      </p>
    );
  } else if (!ready) {
    content = (
      <p className="editlet-u-text-muted" role="status">
        Loading…
      </p>
    );
  } else {
    content = (
      <>
        {fileQ.error ? (
          <div className="editlet-card editlet-card--banner" role="alert">
            <Icon.Alert />
            <span className="editlet-u-flex-1">{fileQ.error.message}</span>
          </div>
        ) : null}
        {(stale && !expectChange) || schemaStale ? (
          <div className="editlet-card editlet-card--banner" role="status">
            <Icon.Alert />
            <span className="editlet-u-flex-1">
              {stale && !expectChange ? 'This file changed on disk' : 'The schema changed on disk'}
            </span>
            <Button variant="outline" size="sm" onClick={reload}>
              Reload
            </Button>
          </div>
        ) : null}
        <EntryForm
          key={`${path}:${shaOf(base.data) ?? 'new'}:${base.generation}`}
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
        />
      </>
    );
  }

  return <section className="editlet-screen">{content}</section>;
}
