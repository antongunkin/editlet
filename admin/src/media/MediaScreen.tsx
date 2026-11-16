import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';

import {
  batchBySize,
  deleteChanges,
  entryEdits,
  imageBytes,
  imageFileError,
  LARGE_IMAGE_BYTES,
  replaceChanges,
  uploadChanges,
} from './edits';
import { LazyPreview } from './LazyPreview';

import './media.css';
import {
  filterCounts,
  hasMissingAlt,
  isUsed,
  loadMediaIndex,
  matchesFilter,
  matchesQuery,
  mediaFolder,
  useMediaIndex,
  type MediaFilter,
  type MediaImage,
  type MediaIndex,
} from './mediaIndex';
import { useMediaCommit, type MediaCommit } from './useMediaCommit';

import { entriesSubject, filesSubject } from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import { useFiles, type SchemaData } from '../data/queries';
import { AssetPreview, mimeType, useAssetBlob, useObjectUrl } from '../data/useAssetUrl';
import { RouteLink } from '../RouteLink';
import { PageTop } from '../screens/PageTop';
import { useSource } from '../source/context';
import { Button, cn, FIELD_INPUT_CLASS, Icon, Switcher, SwitcherItem } from '../ui';

const FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'used', label: 'Used' },
  { key: 'unused', label: 'Unused' },
  { key: 'missing-alt', label: 'Missing alt' },
];

/** A drag that carries files (not text or a link). */
const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The folder shown without the content folder in front: `post/hello-world/`. */
const shortFolder = (schema: Schema, folder: string) =>
  `${folder.startsWith(`${schema.contentDir}/`) ? folder.slice(schema.contentDir.length + 1) : folder}/`;

/** Reads the dropped or chosen files, checks them and commits them to `folder` (several commits when large). */
function useUpload(schema: Schema, commit: MediaCommit, setNotice: (text: string | null) => void) {
  const files = useFiles();
  const [preparing, setPreparing] = useState(false);
  return {
    preparing,
    async upload(list: File[], folder: string) {
      setNotice(null);
      commit.clearError();
      const skipped = list.map(imageFileError).filter((e): e is string => e !== null);
      const ok = list.filter((f) => imageFileError(f) === null);
      setPreparing(true);
      let prepared: { name: string; bytes: Uint8Array }[];
      try {
        prepared = await Promise.all(ok.map(async (f) => ({ name: f.name, bytes: await imageBytes(f) })));
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
        return;
      } finally {
        setPreparing(false);
      }
      const large = ok.filter((f) => f.size > LARGE_IMAGE_BYTES).map((f) => `${f.name} (${formatBytes(f.size)})`);
      const notes = [
        skipped.length > 0 ? `Skipped ${skipped.join('; ')}.` : null,
        large.length > 0 ? `Large files stay in the repository's history for good: ${large.join(', ')}.` : null,
      ].filter(Boolean);
      setNotice(notes.length > 0 ? notes.join(' ') : null);
      if (prepared.length === 0) return;
      const changes = uploadChanges(
        (files.data ?? []).map((f) => f.path),
        folder,
        prepared,
      );
      commit.request({
        message:
          changes.length === 1 ? `Upload ${changes[0]!.path.split('/').pop()}` : `Upload ${changes.length} images`,
        subject: filesSubject(
          schema,
          'upload',
          changes.map((c) => c.path),
        ),
        build: () => batchBySize(changes),
      });
    },
  };
}

/** Drag-and-drop handlers that call `onFiles` with the dropped files; `over` tells whether files are above it. */
function useDropZone(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  return {
    over,
    handlers: {
      onDragEnter(e: DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current += 1;
        setOver(true);
      },
      onDragOver(e: DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      },
      onDragLeave(e: DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      },
      onDrop(e: DragEvent<HTMLElement>) {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      },
    },
  };
}

function MediaCard({
  image,
  selecting,
  selected,
  active,
  incomplete,
  onClick,
}: {
  image: MediaImage;
  selecting: boolean;
  selected: boolean;
  active: boolean;
  incomplete: boolean;
  onClick(): void;
}) {
  const used = isUsed(image);
  const locked = selecting && (used || incomplete);
  const status = used ? `Used in ${image.uses.length}` : incomplete ? 'Checking…' : 'Unused';
  return (
    <button
      type="button"
      className={cn('editlet-media-grid__card', (selected || active) && 'editlet-media-grid__card--selected')}
      title={locked && used ? `Used by ${image.uses[0]!.entryPath}` : image.path}
      aria-pressed={selecting ? selected : undefined}
      aria-current={!selecting && active ? 'true' : undefined}
      disabled={locked}
      onClick={onClick}
    >
      <LazyPreview>
        <AssetPreview path={image.path} alt="" className="editlet-media-grid__img" />
      </LazyPreview>
      {selecting && !locked ? (
        <span className="editlet-media__check" aria-hidden="true">
          {selected ? <Icon.Check size={14} /> : null}
        </span>
      ) : null}
      <div className="editlet-media-grid__info">
        <div className="editlet-media-grid__name">{image.name}</div>
        <div className="editlet-media-grid__meta">
          {status}
          {hasMissingAlt(image) ? ' · No alt' : ''}
        </div>
      </div>
    </button>
  );
}

function FolderGroup({
  schema,
  folder,
  count,
  onFiles,
  children,
}: {
  schema: Schema;
  folder: string;
  count: number;
  onFiles(files: File[], folder: string): void;
  children: ReactNode;
}) {
  const drop = useDropZone((files) => onFiles(files, folder));
  // The folder names the group, so two `cover.jpg` cards are told apart by the folder they sit in.
  return (
    <details
      className="editlet-media__group"
      open
      aria-label={shortFolder(schema, folder)}
      data-dragging={drop.over ? 'true' : undefined}
      {...drop.handlers}
    >
      <summary className="editlet-media__folder">
        <span className="editlet-u-mono">{shortFolder(schema, folder)}</span>
        <span className="editlet-u-text-muted">{count}</span>
      </summary>
      <div className="editlet-media-grid editlet-media-grid--auto">{children}</div>
    </details>
  );
}

/** One image: preview, path, size, type, where it is used (with each use's alt), Replace and Delete. */
function MediaDetail({
  schema,
  index,
  image,
  commit,
  onClose,
  onDelete,
}: {
  schema: Schema;
  index: MediaIndex;
  image: MediaImage;
  commit: MediaCommit;
  onClose(): void;
  onDelete(paths: string[]): void;
}) {
  const blob = useAssetBlob(image.path);
  const url = useObjectUrl(blob);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [alts, setAlts] = useState<Record<number, string>>({});
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const altOf = (i: number) => alts[i] ?? image.uses[i]!.alt;
  const changed = image.uses.map((u, i) => ({ use: u, alt: altOf(i) })).filter(({ use, alt }) => alt !== use.alt);
  const used = isUsed(image);

  const saveAlts = () =>
    commit.request({
      message: `Update alt text of ${image.name}`,
      subject: entriesSubject('update', [
        ...new Map(changed.map(({ use }) => [use.entryPath, { collection: use.collection, slug: use.slug }])).values(),
      ]),
      build: () => [entryEdits(schema, index, changed)],
      onDone: () => setAlts({}),
    });

  const replace = async (file: File) => {
    setReplaceError(null);
    const invalid = imageFileError(file);
    if (invalid) return setReplaceError(invalid);
    try {
      const bytes = await imageBytes(file);
      const { changes } = replaceChanges(schema, index, image, { name: file.name, bytes });
      commit.request({
        message: `Replace ${image.name}`,
        subject: filesSubject(schema, 'update', [image.path]),
        build: () => [changes],
      });
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : String(e));
    }
  };

  const facts = [
    blob ? formatBytes(blob.size) : null,
    size ? `${size.w}×${size.h}` : null,
    mimeType(image.path),
  ].filter(Boolean);

  return (
    <aside className="editlet-media__detail" aria-label={image.name}>
      <div className="editlet-media__detail-head">
        <Button variant="ghost" size="sm" icon={<Icon.ArrowLeft size={14} />} onClick={onClose}>
          All media
        </Button>
        <div className="editlet-u-row editlet-u-gap-2">
          <Button
            variant="outline"
            size="sm"
            icon={<Icon.Upload size={14} />}
            disabled={commit.busy}
            onClick={() => inputRef.current?.click()}
          >
            Replace
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Icon.Trash size={14} />}
            disabled={used || index.incomplete || commit.busy}
            title={used ? 'Used by an entry: remove it there first' : undefined}
            onClick={() => onDelete([image.path])}
          >
            Delete
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="editlet-u-hidden"
          data-testid="media-replace-file"
          aria-label="Replacement image file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void replace(file);
          }}
        />
      </div>
      <h2 className="editlet-media__title">{image.name}</h2>
      <div className="editlet-media__preview">
        {url ? (
          <img
            src={url}
            alt={image.uses[0]?.alt ?? ''}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        ) : (
          <Icon.Image size={28} />
        )}
      </div>
      <code className="editlet-u-mono editlet-u-word-break-all editlet-u-text-sm">{image.path}</code>
      <p className="editlet-u-text-sm editlet-u-text-muted">{facts.join(' · ')}</p>
      {replaceError ? (
        <p className="editlet-u-text-sm editlet-u-text-danger" role="alert">
          {replaceError}
        </p>
      ) : null}
      <h3 className="editlet-media__heading">
        {used ? `Used in ${image.uses.length} ${image.uses.length === 1 ? 'place' : 'places'}` : 'Not used'}
      </h3>
      {!used ? (
        <p className="editlet-u-text-sm editlet-u-text-muted">
          {index.incomplete ? 'Still reading the entries…' : "Not used by any entry. The site's code may still use it."}
        </p>
      ) : (
        <ul className="editlet-media__uses">
          {image.uses.map((use, i) => {
            const collection = schema.collections[use.collection];
            const fieldLabel = use.label ?? collection?.fields[use.field]?.label ?? 'Body';
            const id = `editlet-media-alt-${i}`;
            return (
              <li key={i} className="editlet-media__use">
                <label htmlFor={id} className="editlet-u-text-sm">
                  <RouteLink
                    to={
                      collection?.singleton
                        ? { kind: 'collection', collection: use.collection }
                        : { kind: 'entry', collection: use.collection, slug: use.slug }
                    }
                    className="editlet-link"
                  >
                    {collection?.label ?? use.collection} · {use.title}
                  </RouteLink>{' '}
                  · {fieldLabel}
                </label>
                <input
                  id={id}
                  className={FIELD_INPUT_CLASS}
                  value={altOf(i)}
                  placeholder="No alt text"
                  aria-label={`Alt text in ${use.title}, ${fieldLabel}`}
                  onChange={(e) => setAlts((prev) => ({ ...prev, [i]: e.target.value }))}
                />
              </li>
            );
          })}
        </ul>
      )}
      {used ? (
        <div className="editlet-u-row editlet-u-gap-2 editlet-media__alt-actions">
          {image.uses.length > 1 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAlts(Object.fromEntries(image.uses.map((_, i) => [i, altOf(0)])))}
            >
              Apply first alt to all
            </Button>
          ) : null}
          <Button variant="primary" size="sm" disabled={changed.length === 0 || commit.busy} onClick={saveAlts}>
            {changed.length > 0 ? `Save alt changes (${changed.length})` : 'Save alt changes'}
          </Button>
        </div>
      ) : null}
    </aside>
  );
}

/**
 * `?editlet=media`: every image under the content folder, grouped by folder, with where each one is used. Upload (button or
 * drop, on a folder or anywhere for `<contentDir>/media/`), replace, edit alt across uses, delete unused images.
 */
export function MediaScreen({ schema: data }: { schema: SchemaData }) {
  const schema = data.schema;
  const index = useMediaIndex(schema);
  const source = useSource();
  const client = useQueryClient();
  const commit = useMediaCommit();
  const [notice, setNotice] = useState<string | null>(null);
  const uploader = useUpload(schema, commit, setNotice);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const defaultFolder = mediaFolder(schema);
  const screenDrop = useDropZone((files) => void uploader.upload(files, defaultFolder));

  const images = index?.images ?? [];
  const counts = useMemo(() => filterCounts(index?.images ?? []), [index]);
  const shown = images.filter((i) => matchesFilter(i, filter) && matchesQuery(i, query));
  const folders = [...new Set(shown.map((i) => i.folder))];
  const detail = open === null ? undefined : images.find((i) => i.path === open);

  const remove = (paths: string[]) =>
    commit.request({
      message: paths.length === 1 ? `Delete ${paths[0]!.split('/').pop()}` : `Delete ${paths.length} images`,
      subject: filesSubject(schema, 'delete', paths),
      build: async () => [deleteChanges(await loadMediaIndex(client, source, schema), paths)],
      confirm: {
        title: paths.length === 1 ? `Delete ${paths[0]!.split('/').pop()}?` : `Delete ${paths.length} images?`,
        description: "Not used by any entry. The site's code may still use them. Git history keeps the old files.",
        label: 'Delete',
        destructive: true,
      },
      onDone: () => {
        setSelected(new Set());
        setSelecting(false);
        setOpen(null);
      },
    });

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const busy = commit.busy || uploader.preparing;

  return (
    <section
      className={cn('editlet-screen editlet-media', detail && 'editlet-media--detail')}
      data-dragging={screenDrop.over ? 'true' : undefined}
      {...screenDrop.handlers}
    >
      <PageTop title="Media">
        <Button
          variant="primary"
          size="sm"
          icon={<Icon.Upload size={14} />}
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      </PageTop>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="editlet-u-hidden"
        data-testid="media-upload-file"
        aria-label="Image files to upload"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (list.length > 0) void uploader.upload(list, detail?.folder ?? defaultFolder);
        }}
      />
      {commit.error || notice ? (
        <div className="editlet-card editlet-card--banner" role="alert">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{[commit.error, notice].filter(Boolean).join(' ')}</span>
        </div>
      ) : null}
      <div className="editlet-media__layout">
        <div className="editlet-media__list">
          <div className="editlet-media__toolbar">
            <input
              type="search"
              className={FIELD_INPUT_CLASS}
              placeholder="Search by name, path or alt…"
              aria-label="Search images"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Switcher aria-label="Filter images">
              {FILTERS.map((f) => (
                <SwitcherItem key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
                  {f.label} {counts[f.key]}
                </SwitcherItem>
              ))}
            </Switcher>
          </div>
          {!index ? (
            <p className="editlet-u-text-muted" role="status">
              Loading…
            </p>
          ) : images.length === 0 ? (
            <p className="editlet-ff-image__none">
              No images under {schema.contentDir}/ yet. Upload or drop files here: they go to{' '}
              {shortFolder(schema, defaultFolder)}.
            </p>
          ) : shown.length === 0 ? (
            <p className="editlet-ff-image__none">No images match.</p>
          ) : (
            folders.map((folder) => {
              const inFolder = shown.filter((i) => i.folder === folder);
              return (
                <FolderGroup
                  key={folder}
                  schema={schema}
                  folder={folder}
                  count={inFolder.length}
                  onFiles={(files, f) => void uploader.upload(files, f)}
                >
                  {inFolder.map((image) => (
                    <MediaCard
                      key={image.path}
                      image={image}
                      selecting={selecting}
                      selected={selected.has(image.path)}
                      active={image.path === open}
                      incomplete={index.incomplete}
                      onClick={() => (selecting ? toggle(image.path) : setOpen(image.path))}
                    />
                  ))}
                </FolderGroup>
              );
            })
          )}
          {images.length > 0 ? (
            <div className="editlet-media__selectbar">
              <Button
                variant="outline"
                size="sm"
                aria-pressed={selecting}
                onClick={() => {
                  setSelecting((s) => !s);
                  setSelected(new Set());
                }}
              >
                {selecting ? 'Done' : 'Select'}
              </Button>
              {selecting ? (
                <>
                  <span className="editlet-u-text-sm editlet-u-text-muted editlet-u-flex-1">
                    {selected.size} selected · only unused images can be selected
                  </span>
                  <Button
                    variant="destructive"
                    size="sm"
                    icon={<Icon.Trash size={14} />}
                    disabled={selected.size === 0 || busy}
                    onClick={() => remove([...selected])}
                  >
                    Delete
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        {detail && index ? (
          <MediaDetail
            key={detail.path}
            schema={schema}
            index={index}
            image={detail}
            commit={commit}
            onClose={() => setOpen(null)}
            onDelete={remove}
          />
        ) : null}
      </div>
      {commit.dialog}
    </section>
  );
}
