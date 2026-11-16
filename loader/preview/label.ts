import type { PreviewState } from '../window/channel';

/** The preview line: the floating pill (editor closed) and the window's status bar (editor open) show the same text. */
export const previewLabel = ({ branch, patched, pending }: PreviewState): string =>
  `Preview: ${branch} · ${patched} changes · ${pending} update after Save/deploy · `;
