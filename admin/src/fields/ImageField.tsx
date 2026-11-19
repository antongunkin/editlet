import { useRef, useState, type DragEvent } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { ImageValue, WidgetProps } from './types';

import { BIG_PREVIEW } from '../data/PreviewImage';
import { MediaPicker } from '../media/MediaPicker';
import { Button, cn, Confirm, Field, Icon, IconButton, Input } from '../ui';
import { StatusChip } from '../ui/parts/status-chips';

const EMPTY: ImageValue = { src: '', alt: '' };

/** The file name of a stored `src`: its last path segment. */
const fileName = (src: string) => src.split('/').pop() || src;

/** A drag that carries files (not text or a link). */
const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Image `{ src, alt }` in its modal (FigCraft *Edit · Cover image*): the preview, 160 px high (a magnifier opens it in a
 * new window), a chip while the file waits for the save, then Replace (staged into the entry's commit; an image file
 * can also be dropped on the preview), Gallery (`MediaPicker`, a second modal: pick an image already in the
 * repository, or upload one), a red Remove icon (asks first) and the alt text.
 */
export function ImageField({
  name,
  field,
  value,
  onChange,
  onBlur,
  error,
  ctx,
  defaultGalleryOpen = false,
}: WidgetProps<ImageValue> & {
  /** For the *Gallery* frame of /design only: the editor opens the Gallery with the button, never through this. */
  defaultGalleryOpen?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [choosing, setChoosing] = useState(defaultGalleryOpen);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire for the children of the zone, so count them to know when the pointer really left.
  const depth = useRef(0);
  const Preview = ctx.Preview;
  const path = value.src === '' ? null : ctx.resolveSrc(value.src);
  const staged = path !== null && ctx.isStaged?.(path) === true;
  const altId = `${name}-alt`;

  const upload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const src = await ctx.stageUpload(file);
      onChange({ src, alt: latest.current.alt });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  // Dropping an image file anywhere on the preview and the buttons uploads it, like the Upload button.
  const dropZone = {
    onDragEnter(e: DragEvent<HTMLElement>) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver(e: DragEvent<HTMLElement>) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave(e: DragEvent<HTMLElement>) {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop(e: DragEvent<HTMLElement>) {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && !uploading) void upload(file);
    },
  };

  return (
    <Field {...fieldProps(field, error, name)}>
      <div
        className={cn('flex flex-col gap-3 rounded-2xl', dragging && 'inset-ring-2 inset-ring-ring')}
        data-editlet="image-drop"
        data-dragging={dragging ? 'true' : undefined}
        {...dropZone}
      >
        {value.src !== '' ? (
          <div className="relative overflow-hidden rounded-2xl">
            <Preview path={path} alt={value.alt} openable className={BIG_PREVIEW} />
          </div>
        ) : (
          <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-2xl bg-sunken text-sm text-tray-muted-foreground">
            <Icon name="image" size={24} />
            <span>Drop an image here</span>
          </div>
        )}
        {staged ? (
          <StatusChip
            tone="unsaved"
            className="self-start"
            icon={<Icon name="upload" size={16} className="shrink-0 text-chart-1" />}
          >
            {fileName(value.src)} · uploads when you save
          </StatusChip>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            icon={<Icon name="upload" size={20} />}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {value.src === '' ? 'Upload' : 'Replace'}
          </Button>
          <Button icon={<Icon name="image" size={20} />} onClick={() => setChoosing(true)}>
            Gallery
          </Button>
          {value.src !== '' || value.alt !== '' ? (
            <IconButton
              className="text-destructive"
              label="Remove image"
              onClick={() => setRemoving(true)}
              icon={<Icon name="trash" size={20} />}
            />
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={altId} className="px-1 text-sm font-medium text-tray-muted-foreground">
          Alt text
        </label>
        <Input
          id={altId}
          type="text"
          value={value.alt}
          placeholder="Describe the image for screen readers"
          aria-label={`${field.label} alt text`}
          onChange={(e) => onChange({ src: value.src, alt: e.target.value })}
          onBlur={onBlur}
          aria-invalid={invalid(error)}
          aria-describedby={describedBy(name, field, error)}
        />
      </div>
      {uploadError ? (
        <p className="m-0 flex items-center gap-1.5 px-1 text-sm font-medium text-tint-danger-foreground" role="alert">
          <Icon name="alert" size={16} className="shrink-0 text-destructive" />
          {uploadError}
        </p>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid={`${name}-file`}
        aria-label={`${field.label}: file to upload`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <Confirm
        open={removing}
        onOpenChange={setRemoving}
        title="Remove image?"
        description="The image and its alt text are cleared from this entry. Image files in the repository are not deleted."
        confirmLabel="Remove"
        onConfirm={() => onChange(EMPTY)}
      />
      <MediaPicker
        open={choosing}
        onOpenChange={setChoosing}
        images={ctx.images}
        entryFolder={ctx.entryPath.replace(/\.md$/, '')}
        contentDir={ctx.contentDir}
        Preview={Preview}
        uploading={uploading}
        onPick={(p) => {
          onChange({ src: ctx.toSrc(p), alt: value.alt });
          setChoosing(false);
        }}
        onUpload={(file) => {
          setChoosing(false);
          void upload(file);
        }}
      />
    </Field>
  );
}
