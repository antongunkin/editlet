import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AltQueue } from './AltQueue';
import { deleteChanges } from './edits';
import { LazyPreview } from './LazyPreview';
import { MediaDetail } from './MediaDetail';
import { MediaGrid, MediaTile } from './MediaGrid';
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
} from './mediaIndex';
import { MediaView } from './MediaView';
import { useMediaCommit } from './useMediaCommit';
import { shortFolder, useDropZone, useUpload } from './useUpload';

import { filesSubject } from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import type { SchemaData } from '../data/queries';
import { AssetPreview } from '../data/useAssetUrl';
import { RouteLink } from '../RouteLink';
import { useSource } from '../source/context';
import { buttonVariants, cn, Icon, IconButton } from '../ui';
import { ActionSheet } from '../ui/parts/action-sheet';
import type { FinalFocus } from '../ui/parts/focus';
import { Header, SearchHeader } from '../ui/parts/header';
import { ActionRow } from '../ui/parts/rows';
import { Banner } from '../ui/primitives/banner';
import { Button } from '../ui/primitives/button';
import { Chip } from '../ui/primitives/chip';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';
import { useScreenChrome } from '../window/chrome';

const FILTERS: { key: MediaFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'used', label: 'Used' },
  { key: 'unused', label: 'Unused' },
  { key: 'missing-alt', label: 'Missing alt' },
];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The folder an image sits in, without the content folder: `post/best-26-inch-tires`, `media`. */
const placeOf = (schema: Schema, image: MediaImage) => shortFolder(schema, image.folder).replace(/\/$/, '');

/** The search field of the header (FigCraft `SearchHeader`): it takes the focus when it opens. */
function SearchField({ value, onChange }: { value: string; onChange(value: string): void }) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <InputGroup lead={<Icon name="search" size={20} />}>
      <InputGroupInput
        ref={input}
        type="search"
        placeholder="Search by name, path or alt…"
        autoCapitalize="none"
        autoCorrect="off"
        aria-label="Search images"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </InputGroup>
  );
}

/** One image of the grid. Files dropped on a tile go into that tile's folder. */
function ImageTile({
  schema,
  image,
  selecting,
  selected,
  active,
  incomplete,
  onClick,
  onFiles,
}: {
  schema: Schema;
  image: MediaImage;
  selecting: boolean;
  selected: boolean;
  active: boolean;
  incomplete: boolean;
  onClick(): void;
  onFiles(files: File[], folder: string): void;
}) {
  const used = isUsed(image);
  const locked = selecting && (used || incomplete);
  const noAlt = hasMissingAlt(image);
  const status = used ? `Used in ${image.uses.length}` : incomplete ? 'Checking…' : 'Unused';
  const drop = useDropZone((files) => onFiles(files, image.folder));
  return (
    <MediaTile
      label={`${image.name}, ${placeOf(schema, image)}, ${status}${noAlt ? ', no alt text' : ''}`}
      path={locked && used ? `Used by ${image.uses[0]!.entryPath}` : image.path}
      caption={selecting ? { name: image.name, folder: placeOf(schema, image) } : undefined}
      preview={
        <LazyPreview>
          <AssetPreview path={image.path} alt="" className="block size-full object-cover" />
        </LazyPreview>
      }
      unused={!used && !incomplete}
      noAlt={noAlt}
      selecting={selecting}
      selected={selected}
      active={active}
      locked={locked}
      dragging={drop.over}
      onClick={onClick}
      drop={drop.handlers}
    />
  );
}

/**
 * `?editlet=media`: every image under the content folder with where each one is used (FigCraft *Media*). Upload (the
 * bar's button or a drop, on a tile or anywhere for `<contentDir>/media/`), select unused images to delete, search; a
 * tap opens one image (`MediaDetail`: its uses and alt text, Replace and Delete). The commits go through
 * `useMediaCommit`.
 */
export function MediaScreen({ schema: data }: { schema: SchemaData }) {
  const schema = data.schema;
  const chrome = useScreenChrome();
  const index = useMediaIndex(schema);
  const source = useSource();
  const client = useQueryClient();
  const commit = useMediaCommit();
  const [notice, setNotice] = useState<string | null>(null);
  const uploader = useUpload(schema, commit, setNotice);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [moreOpen, setMoreOpen] = useState(false);
  // The alt queue: a run per start (its images are taken once, when it opens), kept while it closes.
  const [run, setRun] = useState<{ id: number; images: MediaImage[]; open: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const defaultFolder = mediaFolder(schema);
  const screenDrop = useDropZone((files) => void uploader.upload(files, defaultFolder));

  const images = index?.images ?? [];
  const counts = useMemo(() => filterCounts(index?.images ?? []), [index]);
  const shown = images.filter((i) => matchesFilter(i, filter) && matchesQuery(i, query));
  const detail = open === null ? undefined : images.find((i) => i.path === open);
  const busy = commit.busy || uploader.preparing;
  /** The queue: the images without alt text that match the search, in grid order, whatever chip is on. */
  const queueImages = images.filter((i) => hasMissingAlt(i) && matchesQuery(i, query));
  const altStart = counts['missing-alt'] > 0 && !index?.incomplete && !busy;

  const startQueue = () => {
    const snapshot = queueImages;
    if (snapshot.length === 0) return setNotice('No image without alt text matches the search.');
    setNotice(null);
    setRun((prev) => ({ id: (prev?.id ?? 0) + 1, images: snapshot, open: true }));
  };

  const remove = (paths: string[], finalFocus?: FinalFocus) =>
    commit.request({
      finalFocus,
      message: paths.length === 1 ? `Delete ${paths[0]!.split('/').pop()}` : `Delete ${paths.length} images`,
      subject: filesSubject(schema, 'delete', paths),
      build: async () => [deleteChanges(await loadMediaIndex(client, source, schema), paths)],
      confirm: {
        title: `Delete ${count(paths.length, 'image', 'images')}?`,
        description:
          paths.length === 1
            ? `${paths[0]!.split('/').pop()} is not used by any entry; the site's code may still use it. Git history keeps it.`
            : "No entry uses them; the site's code may still use them. Git history keeps the files.",
        label: paths.length === 1 ? 'Delete image' : `Delete ${paths.length} images`,
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

  const banners = (
    <>
      {chrome.banners}
      {commit.error || notice ? (
        <Banner tone={commit.error ? 'danger' : 'unsaved'} role="alert">
          {[commit.error, notice].filter(Boolean).join(' ')}
        </Banner>
      ) : null}
    </>
  );

  if (detail && index) {
    return (
      <MediaDetail
        key={detail.path}
        schema={schema}
        index={index}
        image={detail}
        commit={commit}
        chrome={chrome}
        banners={banners}
        onClose={() => setOpen(null)}
        onDelete={remove}
        onUpload={(files, folder, finalFocus) => void uploader.upload(files, folder, finalFocus)}
      />
    );
  }

  const back = (
    <RouteLink
      to={{ kind: 'home' }}
      className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
      aria-label="Back"
      title="Back to Home"
    >
      <Icon name="chevron-left" size={20} />
    </RouteLink>
  );

  const header = searching ? (
    <SearchHeader
      back={
        <IconButton
          label="Close search"
          icon={<Icon name="chevron-left" size={20} />}
          onClick={() => {
            setSearching(false);
            setQuery('');
          }}
        />
      }
    >
      <h1 className="sr-only">Media</h1>
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <SearchField value={query} onChange={setQuery} />
        </div>
        {chrome.windowActions}
      </div>
    </SearchHeader>
  ) : (
    <Header
      title="Media"
      back={back}
      actions={
        <>
          {selecting ? null : (
            <>
              <IconButton
                label="Search images"
                icon={<Icon name="search" size={20} />}
                onClick={() => setSearching(true)}
              />
              {images.length > 0 ? (
                <IconButton
                  ref={more}
                  label="More actions"
                  aria-haspopup="dialog"
                  icon={<Icon name="more" size={20} />}
                  onClick={() => setMoreOpen(true)}
                />
              ) : null}
            </>
          )}
          {chrome.windowActions}
        </>
      }
    />
  );

  const body = !index ? (
    <output className="block px-4 text-base text-tray-muted-foreground">Loading…</output>
  ) : images.length === 0 ? (
    <p className="m-0 px-5 text-base text-tray-muted-foreground">
      No images under {schema.contentDir}/ yet. Upload or drop files here: they go to{' '}
      {shortFolder(schema, defaultFolder)}.
    </p>
  ) : shown.length === 0 ? (
    <p className="m-0 px-5 text-base text-tray-muted-foreground">No images match.</p>
  ) : (
    <MediaGrid dense>
      {shown.map((image) => (
        <ImageTile
          key={image.path}
          schema={schema}
          image={image}
          selecting={selecting}
          selected={selected.has(image.path)}
          active={image.path === open}
          incomplete={index.incomplete}
          onClick={() => (selecting ? toggle(image.path) : setOpen(image.path))}
          onFiles={(files, folder) => void uploader.upload(files, folder)}
        />
      ))}
    </MediaGrid>
  );

  const addAlt = filter === 'missing-alt' && counts['missing-alt'] > 0;
  const cta = selecting ? (
    <Button
      variant="danger"
      size="lg"
      full
      className="shrink"
      icon={<Icon name="trash" size={20} />}
      disabled={selected.size === 0 || busy}
      onClick={() => remove([...selected])}
    >
      {selected.size === 0 ? 'Delete' : `Delete ${count(selected.size, 'image', 'images')}`}
    </Button>
  ) : addAlt ? (
    <Button
      variant="primary"
      size="lg"
      full
      icon={<Icon name="pencil" size={20} />}
      aria-label={`Add alt text to ${count(queueImages.length, 'image', 'images')}`}
      disabled={!altStart}
      onClick={startQueue}
    >
      Add alt text
    </Button>
  ) : (
    <Button
      variant="primary"
      size="lg"
      full
      icon={<Icon name="upload" size={20} />}
      loading={busy}
      busyLabel="Uploading…"
      onClick={() => inputRef.current?.click()}
    >
      Upload
    </Button>
  );

  return (
    <MediaView
      header={header}
      banners={banners}
      filters={
        <fieldset aria-label="Filter images" className="m-0 flex min-w-0 flex-wrap gap-x-2 border-0 p-0">
          {FILTERS.map((f) => (
            <Chip key={f.key} selected={filter === f.key} count={counts[f.key]} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </fieldset>
      }
      hint={
        selecting
          ? 'Only unused images can be selected.'
          : addAlt && index?.incomplete
            ? 'Still reading the entries…'
            : undefined
      }
      body={body}
      status={chrome.status}
      cta={cta}
      secondary={
        selecting ? (
          <Button
            size="lg"
            onClick={() => {
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            Done
          </Button>
        ) : undefined
      }
      dragging={screenDrop.over}
      dropHandlers={screenDrop.handlers}
      modals={
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="media-upload-file"
            aria-label="Image files to upload"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (list.length > 0) void uploader.upload(list, defaultFolder);
            }}
          />
          <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} title="Media" finalFocus={more}>
            <ActionRow
              icon="pencil"
              disabled={counts['missing-alt'] === 0 || !altStart}
              note={index?.incomplete ? 'Still reading the entries…' : undefined}
              onClick={() => {
                setMoreOpen(false);
                startQueue();
              }}
            >
              Add missing alt text
            </ActionRow>
            <ActionRow
              icon="check-circle"
              onClick={() => {
                setMoreOpen(false);
                setSelecting(true);
                setSelected(new Set());
              }}
            >
              Select images
            </ActionRow>
          </ActionSheet>
          {commit.dialog}
          {run ? (
            <AltQueue
              key={run.id}
              schema={schema}
              images={run.images}
              open={run.open}
              onOpenChange={(next) => setRun((r) => (r ? { ...r, open: next } : r))}
              onOpenImage={(path) => {
                setRun((r) => (r ? { ...r, open: false } : r));
                setOpen(path);
              }}
            />
          ) : null}
        </>
      }
    />
  );
}
