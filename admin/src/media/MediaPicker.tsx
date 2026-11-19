import { useRef, useState, type ReactNode } from 'react';

import { LazyPreview } from './LazyPreview';
import { MediaGrid, MediaTile } from './MediaGrid';

import type { FieldContext } from '../fields/types';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';
import { Chip } from '../ui/primitives/chip';
import { Icon } from '../ui/primitives/icon';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

export type MediaPickerProps = {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The sheet's title: *Gallery* from an image field, *Insert image* from the rich text. */
  title?: string;
  /** What the sheet is for, under the title (the field's or the entry's name). */
  sub?: string;
  /** Repo paths of the images to choose from. */
  images: string[];
  /** The entry's own image folder (`<contentDir>/<collection>/<slug>`): its images come first. */
  entryFolder: string;
  /** The content folder: a tile's folder is shown without it (`post/hello-world`). */
  contentDir?: string;
  Preview: FieldContext['Preview'];
  /** An image was tapped. The caller closes the sheet when it takes it (it may refuse and show why). */
  onPick(path: string): void;
  /** Upload a new image instead (into the entry's folder). The caller closes the sheet. */
  onUpload?(file: File): void;
  uploading?: boolean;
  /** Above the search (the rich text's alt text field). */
  children?: ReactNode;
};

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** The folder of a file, without the content folder in front: `post/hello-world`. */
const folderOf = (path: string, contentDir?: string) => {
  const folder = path.slice(0, path.lastIndexOf('/'));
  return contentDir && folder.startsWith(`${contentDir}/`) ? folder.slice(contentDir.length + 1) : folder;
};

/**
 * Chooses an image already in the repository (FigCraft *Gallery*): a second modal over the field's, with a search by
 * path, the images as tiles (a tap chooses it), and **Upload a file** in the bar. Used by the image field and
 * the rich text's image button. A nested `Sheet`, so Escape and the × close only this level.
 */
export function MediaPicker({
  open,
  onOpenChange,
  title = 'Gallery',
  sub,
  images,
  entryFolder,
  contentDir,
  Preview,
  onPick,
  onUpload,
  uploading,
  children,
}: MediaPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const own = images.filter((p) => p.startsWith(`${entryFolder}/`));
  const [scope, setScope] = useState<'entry' | 'all'>(own.length > 0 ? 'entry' : 'all');
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (scope === 'entry' ? own : images).filter((p) => p.toLowerCase().includes(q));
  // A fresh search and scope each time it opens.
  const close = (next: boolean) => {
    if (!next) {
      setQuery('');
      setScope(own.length > 0 ? 'entry' : 'all');
    }
    onOpenChange(next);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={title}
      sub={sub ?? `${images.length} ${images.length === 1 ? 'image' : 'images'}`}
      bar={
        onUpload ? (
          <BottomBar>
            <Button
              variant="secondary"
              size="lg"
              full
              icon={<Icon name="upload" size={20} />}
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              Upload a file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              data-testid="media-picker-file"
              aria-label="Image file to upload"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) onUpload(file);
              }}
            />
          </BottomBar>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3 pt-1 pb-4">
        {children}
        <div className="px-4">
          <InputGroup lead={<Icon name="search" size={20} />}>
            <InputGroupInput
              type="search"
              placeholder="Search by name or path…"
              autoCapitalize="none"
              autoCorrect="off"
              aria-label="Search images"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
        </div>
        <fieldset aria-label="Which images" className="m-0 flex min-w-0 flex-wrap gap-x-2 border-0 px-4 py-0">
          <Chip selected={scope === 'entry'} count={own.length} onClick={() => setScope('entry')}>
            This entry
          </Chip>
          <Chip selected={scope === 'all'} count={images.length} onClick={() => setScope('all')}>
            All
          </Chip>
        </fieldset>
        {shown.length === 0 ? (
          <p className="m-0 px-5 text-base text-tray-muted-foreground">
            {images.length === 0
              ? 'No images under the content folder yet.'
              : q !== ''
                ? 'No images match the search.'
                : 'This entry has no images of its own yet.'}
          </p>
        ) : (
          <MediaGrid>
            {shown.map((p) => (
              <MediaTile
                key={p}
                label={`${fileName(p)}, ${folderOf(p, contentDir)}`}
                path={p}
                caption={{ name: fileName(p), folder: folderOf(p, contentDir) }}
                preview={
                  <LazyPreview>
                    <Preview path={p} alt="" className="block size-full object-cover" />
                  </LazyPreview>
                }
                onClick={() => onPick(p)}
              />
            ))}
          </MediaGrid>
        )}
      </div>
    </Sheet>
  );
}
