import { useRef, useState, type DragEvent } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { ImageValue, WidgetProps } from './types';

import { MediaPicker } from '../media/MediaPicker';
import {
  AlertDialog,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FIELD_INPUT_CLASS,
  Icon,
} from '../ui';

const EMPTY: ImageValue = { src: '', alt: '' };

/** The file name of a stored `src` (its last path segment), shown cut with an ellipsis; the title has the whole path. */
const fileName = (src: string) => src.split('/').pop() || src;

/** A drag that carries files (not text or a link). */
const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Image `{ src, alt }`: a preview of at most 200 px (a magnifier opens it in a new window), then Upload (staged into
 * the entry's commit; an image file can also be dropped on the preview), Gallery (`MediaPicker`: pick an image
 * already in the repository, or upload one), a red Remove icon (asks first) and the file name, then the alt text.
 */
export function ImageField({ name, field, value, onChange, onBlur, error, ctx }: WidgetProps<ImageValue>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const latest = useRef(value);
  latest.current = value;
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [dragging, setDragging] = useState(false);
  // dragenter/dragleave also fire for the children of the zone, so count them to know when the pointer really left.
  const depth = useRef(0);
  const Preview = ctx.Preview;
  const path = value.src === '' ? null : ctx.resolveSrc(value.src);
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
      <div className="editlet-ff-image__body" data-dragging={dragging ? 'true' : undefined} {...dropZone}>
        {value.src !== '' ? (
          <div className="editlet-ff-image__preview">
            <Preview path={path} alt={value.alt} openable />
          </div>
        ) : (
          <div className="editlet-ff-image__empty">
            <Icon.Image size={28} />
            <span>Drop an image here</span>
          </div>
        )}
        <div className="editlet-ff-image__actions">
          <Button
            variant="outline"
            size="sm"
            icon={<Icon.Upload size={14} />}
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            Upload
          </Button>
          <Button variant="outline" size="sm" icon={<Icon.Image size={14} />} onClick={() => setChoosing(true)}>
            Gallery
          </Button>
          {value.src !== '' || value.alt !== '' ? (
            <Button
              variant="outline"
              size="sm"
              iconOnly
              className="editlet-ff-image__remove"
              aria-label="Remove image"
              title="Remove image"
              onClick={() => setRemoving(true)}
            >
              <Icon.Trash size={16} />
            </Button>
          ) : null}
          {value.src !== '' ? (
            <code className="editlet-ff-image__meta" title={value.src}>
              {fileName(value.src)}
            </code>
          ) : null}
        </div>
      </div>
      <div className="editlet-ff-image__alt">
        <label htmlFor={altId} className="editlet-ff-image__alt-label">
          Alt text
        </label>
        <input
          id={altId}
          className={FIELD_INPUT_CLASS}
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
        <div className="editlet-field__error" role="alert">
          <Icon.X size={11} />
          {uploadError}
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="editlet-u-hidden"
        data-testid={`${name}-file`}
        aria-label={`${field.label}: file to upload`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void upload(file);
        }}
      />
      <AlertDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove image?"
        description="The image and its alt text are cleared from this entry. Image files in the repository are not deleted."
        confirmLabel="Remove"
        onConfirm={() => onChange(EMPTY)}
      />
      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="editlet-ff-image__dialog">
          <DialogHeader>
            <DialogTitle>Gallery</DialogTitle>
          </DialogHeader>
          <MediaPicker
            images={ctx.images}
            entryFolder={ctx.entryPath.replace(/\.md$/, '')}
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
        </DialogContent>
      </Dialog>
    </Field>
  );
}
