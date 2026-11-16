import { useQuery } from '@tanstack/react-query';
import { createElement, useEffect, useState } from 'react';

import { PreviewImage } from './PreviewImage';
import { useFiles } from './queries';

import { useSource } from '../source/context';
import { cn } from '../ui/cn';
import { Icon } from '../ui/Icon';

const MIME: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  avif: 'image/avif',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

export function mimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** At most `n` calls of `run` at once; the rest wait in order. */
function limiter(n: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(run: () => Promise<T>): Promise<T> => {
    if (active >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await run();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** Image reads share one queue: a grid of previews makes at most 4 requests at a time (GitHub reads one blob each). */
const readLimit = limiter(4);

/** The file's bytes as a `Blob` (cached by path and sha), or `undefined` while loading or when the path is not listed. */
export function useAssetBlob(path: string | null): Blob | undefined {
  const source = useSource();
  const files = useFiles();
  const ref = path === null ? undefined : files.data?.find((f) => f.path === path);
  const { data: blob } = useQuery({
    queryKey: ['asset', ref?.path ?? null, ref?.sha ?? null],
    enabled: ref !== undefined,
    staleTime: Infinity,
    queryFn: async () => {
      const bytes = await readLimit(() => source.readFile(ref!.path));
      return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType(ref!.path) });
    },
  });
  return ref ? blob : undefined;
}

/** An object URL for `blob`, revoked on change and unmount; `null` without one or without `URL.createObjectURL`. */
export function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/**
 * An object URL for a listed file (read through the source, so it works for any source kind), or `null` while
 * loading, when the path is not listed, or without `URL.createObjectURL`. The URL is revoked on change and unmount.
 */
export function useAssetUrl(path: string | null): string | null {
  return useObjectUrl(useAssetBlob(path));
}

/**
 * Whether the magnifier may open the file in a new window. Not for SVG: opened as a document from a `blob:` URL it
 * has the admin's origin, and a script inside it would run there (inside `<img>` it never runs).
 */
export const canOpenInWindow = (path: string | null) => path !== null && mimeType(path) !== 'image/svg+xml';

export type AssetPreviewProps = { path: string | null; alt: string; className?: string; openable?: boolean };

/** `<img>` for a listed asset, else an image-icon placeholder. */
export function AssetPreview({ path, alt, className, openable }: AssetPreviewProps) {
  const url = useAssetUrl(path);
  if (url) return createElement(PreviewImage, { url, alt, className, openable: openable && canOpenInWindow(path) });
  return createElement(
    'div',
    { className: cn('editlet-ff-image__empty', className), role: 'img', 'aria-label': alt || 'No image' },
    createElement(Icon.Image, { size: 16 }),
  );
}
