import { useRef, useState, type DragEvent } from 'react';

import { batchBySize, imageBytes, imageFileError, LARGE_IMAGE_BYTES, uploadChanges } from './edits';
import type { MediaCommit } from './useMediaCommit';

import { filesSubject } from '../../../core/gitStyle';
import type { Schema } from '../../../core/schema';
import { useFiles } from '../data/queries';

/** A drag that carries files (not text or a link). */
const hasFiles = (e: DragEvent<HTMLElement>) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** The folder shown without the content folder in front: `post/hello-world/`. */
export const shortFolder = (schema: Schema, folder: string) =>
  `${folder.startsWith(`${schema.contentDir}/`) ? folder.slice(schema.contentDir.length + 1) : folder}/`;

/** Reads the dropped or chosen files, checks them and commits them to `folder` (several commits when large). */
export function useUpload(schema: Schema, commit: MediaCommit, setNotice: (text: string | null) => void) {
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
export function useDropZone(onFiles: (files: File[]) => void) {
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
