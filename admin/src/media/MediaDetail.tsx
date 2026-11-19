import { useRef, useState, type ReactNode } from 'react';

import { entryEdits, imageBytes, imageFileError, replaceChanges } from './edits';
import { isUsed, type MediaImage, type MediaIndex } from './mediaIndex';
import { MediaUses } from './MediaUses';
import { MediaImageView } from './MediaView';
import type { MediaCommit } from './useMediaCommit';
import { formatBytes } from './useUpload';

import { entriesSubject, filesSubject } from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import { BIG_PREVIEW, ImagePlaceholder, PreviewImage } from '../data/PreviewImage';
import { canOpenInWindow, mimeType, useAssetBlob, useObjectUrl } from '../data/useAssetUrl';
import { RouteLink } from '../RouteLink';
import { Icon, IconButton } from '../ui';
import { ActionSheet } from '../ui/parts/action-sheet';
import type { FinalFocus } from '../ui/parts/focus';
import { Header } from '../ui/parts/header';
import { ActionRow } from '../ui/parts/rows';
import { Button } from '../ui/primitives/button';
import type { ScreenChrome } from '../window/chrome';

/**
 * One image (FigCraft *Media · image*): its picture, where it is used (each use a link to the entry, with its alt text
 * under it) and **Save alt text** in the bar. Replace, Delete and *Use the first alt text everywhere* are in ⋯.
 */
export function MediaDetail({
  schema,
  index,
  image,
  commit,
  chrome,
  banners,
  onClose,
  onDelete,
  onUpload,
}: {
  schema: Schema;
  index: MediaIndex;
  image: MediaImage;
  commit: MediaCommit;
  chrome: ScreenChrome;
  banners: ReactNode;
  onClose(): void;
  /** `finalFocus`: the ⋯ the delete was started from, where its confirm returns the focus. */
  onDelete(paths: string[], finalFocus?: FinalFocus): void;
  /** Upload files into a folder (the open image's). */
  onUpload(files: File[], folder: string, finalFocus?: FinalFocus): void;
}) {
  const blob = useAssetBlob(image.path);
  const url = useObjectUrl(blob);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [alts, setAlts] = useState<Record<number, string>>({});
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const more = useRef<HTMLButtonElement>(null);
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
        finalFocus: more,
      });
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : String(e));
    }
  };

  const facts = [blob ? formatBytes(blob.size) : null, size ? `${size.w} × ${size.h}` : null, mimeType(image.path)]
    .filter(Boolean)
    .join(' · ');

  const cannotDelete = used || index.incomplete;

  return (
    <MediaImageView
      header={
        <Header
          as="span"
          title="All media"
          back={<IconButton label="All media" icon={<Icon name="chevron-left" size={20} />} onClick={onClose} />}
          actions={
            <>
              <IconButton
                ref={more}
                label="More actions"
                aria-haspopup="dialog"
                icon={<Icon name="more" size={20} />}
                onClick={() => setMoreOpen(true)}
              />
              {chrome.windowActions}
            </>
          }
        />
      }
      banners={
        <>
          {banners}
          {replaceError ? (
            <p className="m-0 text-sm font-medium text-tint-danger-foreground" role="alert">
              {replaceError}
            </p>
          ) : null}
        </>
      }
      title={image.name}
      facts={facts}
      preview={
        url ? (
          <PreviewImage
            url={url}
            alt={image.uses[0]?.alt ?? ''}
            className={BIG_PREVIEW}
            openable={canOpenInWindow(image.path)}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        ) : (
          <ImagePlaceholder alt={image.name} className={BIG_PREVIEW} />
        )
      }
      path={image.path}
      uses={
        <MediaUses
          heading={used ? `Used in ${image.uses.length} ${image.uses.length === 1 ? 'place' : 'places'}` : 'Not used'}
          empty={
            index.incomplete ? 'Still reading the entries…' : "Not used by any entry. The site's code may still use it."
          }
          linkAs={RouteLink}
          items={image.uses.map((use, i) => {
            const collection = schema.collections[use.collection];
            const fieldLabel = use.label ?? collection?.fields[use.field]?.label ?? 'Body';
            return {
              key: i,
              title: use.title,
              sub: `${collection?.label ?? use.collection} · ${fieldLabel}`,
              link: {
                to: collection?.singleton
                  ? { kind: 'collection', collection: use.collection }
                  : { kind: 'entry', collection: use.collection, slug: use.slug },
              },
              alt: altOf(i),
              altLabel: `Alt text in ${use.title}, ${fieldLabel}`,
              onAlt: (alt) => setAlts((prev) => ({ ...prev, [i]: alt })),
            };
          })}
        />
      }
      status={chrome.status}
      cta={
        used ? (
          <Button variant="primary" size="lg" full disabled={changed.length === 0 || commit.busy} onClick={saveAlts}>
            {changed.length > 1 ? `Save ${changed.length} alt texts` : 'Save alt text'}
          </Button>
        ) : undefined
      }
      modals={
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            hidden
            data-testid="media-replace-file"
            aria-label="Replacement image file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void replace(file);
            }}
          />
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            data-testid="media-upload-file"
            aria-label="Image files to upload"
            onChange={(e) => {
              const list = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (list.length > 0) onUpload(list, image.folder, more);
            }}
          />
          <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} title={image.name} finalFocus={more}>
            <ActionRow
              icon="upload"
              disabled={commit.busy}
              onClick={() => {
                setMoreOpen(false);
                inputRef.current?.click();
              }}
            >
              Replace…
            </ActionRow>
            <ActionRow
              icon="folder"
              disabled={commit.busy}
              onClick={() => {
                setMoreOpen(false);
                uploadRef.current?.click();
              }}
            >
              Upload to this folder…
            </ActionRow>
            {image.uses.length > 1 ? (
              <ActionRow
                icon="copy"
                onClick={() => {
                  setMoreOpen(false);
                  setAlts(Object.fromEntries(image.uses.map((_, i) => [i, altOf(0)])));
                }}
              >
                Use the first alt text everywhere
              </ActionRow>
            ) : null}
            <ActionRow
              icon="trash"
              danger
              disabled={cannotDelete || commit.busy}
              note={used ? 'Used by an entry' : undefined}
              onClick={() => {
                setMoreOpen(false);
                onDelete([image.path], more);
              }}
            >
              Delete…
            </ActionRow>
          </ActionSheet>
          {commit.dialog}
        </>
      }
    />
  );
}
