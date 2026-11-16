import { useRef, useState } from 'react';

import { LazyPreview } from './LazyPreview';

import type { FieldContext } from '../fields/types';
import { Button, FIELD_INPUT_CLASS, Icon, Switcher, SwitcherItem } from '../ui';

export type MediaPickerProps = {
  /** Repo paths of the images to choose from. */
  images: string[];
  /** The entry's own image folder (`<contentDir>/<collection>/<slug>`): "This entry" shows only images in it. */
  entryFolder: string;
  Preview: FieldContext['Preview'];
  onPick(path: string): void;
  /** Upload a new image instead (into the entry's folder). */
  onUpload?(file: File): void;
  uploading?: boolean;
};

/**
 * Chooses an image already in the repository: search by path, "This entry" (the entry's own folder) or All, and
 * Upload. Used by the image field's Gallery dialog (and the rich-text editor's image button).
 */
export function MediaPicker({ images, entryFolder, Preview, onPick, onUpload, uploading }: MediaPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const own = images.filter((p) => p.startsWith(`${entryFolder}/`));
  const [scope, setScope] = useState<'entry' | 'all'>(own.length > 0 ? 'entry' : 'all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (scope === 'entry' ? own : images).filter((p) => p.toLowerCase().includes(q));

  return (
    <div className="editlet-media-picker">
      <div className="editlet-media-picker__toolbar">
        <input
          type="search"
          className={FIELD_INPUT_CLASS}
          placeholder="Search images…"
          aria-label="Search images"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Switcher aria-label="Which images">
          <SwitcherItem active={scope === 'entry'} onClick={() => setScope('entry')}>
            This entry ({own.length})
          </SwitcherItem>
          <SwitcherItem active={scope === 'all'} onClick={() => setScope('all')}>
            All ({images.length})
          </SwitcherItem>
        </Switcher>
        {onUpload ? (
          <>
            <Button
              variant="outline"
              size="sm"
              icon={<Icon.Upload size={14} />}
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              Upload
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="editlet-u-hidden"
              data-testid="media-picker-file"
              aria-label="Image file to upload"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(file);
              }}
            />
          </>
        ) : null}
      </div>
      {shown.length === 0 ? (
        <p className="editlet-ff-image__none">
          {images.length === 0
            ? 'No images under the content folder yet.'
            : q !== ''
              ? 'No images match the search.'
              : 'This entry has no images of its own yet.'}
        </p>
      ) : (
        <div className="editlet-media-grid editlet-media-grid--auto">
          {shown.map((p) => (
            <button key={p} type="button" className="editlet-media-grid__card" title={p} onClick={() => onPick(p)}>
              <LazyPreview>
                <Preview path={p} alt="" />
              </LazyPreview>
              <div className="editlet-media-grid__info">
                <div className="editlet-media-grid__name">{p.slice(p.lastIndexOf('/') + 1)}</div>
                <div className="editlet-media-grid__meta">{p}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
