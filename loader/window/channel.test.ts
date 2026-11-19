import { describe, expect, it } from 'vitest';

import {
  isAdminToPreviewMessage,
  isAdminToWindowMessage,
  isPreviewToAdminMessage,
  isSelectMessage,
  isViewportMessage,
  WINDOW_SOURCE,
} from './channel';

const msg = (body: Record<string, unknown>) => ({ source: WINDOW_SOURCE, ...body });

describe('isAdminToWindowMessage', () => {
  it.each([
    msg({ type: 'hello' }),
    msg({ type: 'expand' }),
    msg({ type: 'theme', theme: 'light' }),
    msg({ type: 'theme', theme: 'dark' }),
    msg({ type: 'collapse', w: 120, h: 40.5 }),
    msg({ type: 'collapse', w: 120, h: 56, shadow: '0 0 0 1px #0001' }),
    msg({ type: 'edge', hover: false }),
    msg({ type: 'edge', hover: true, edge: 'sw' }),
    msg({ type: 'drag', kind: 'move', phase: 'start', dx: 0, dy: 0 }),
    msg({ type: 'drag', kind: 'sw', phase: 'end', dx: -3, dy: 7 }),
  ])('accepts %j', (data) => {
    expect(isAdminToWindowMessage(data)).toBe(true);
  });

  it.each([
    null,
    'hello',
    { type: 'hello' },
    { source: 'editlet', type: 'hello' },
    msg({ type: 'close' }),
    msg({ type: 'theme' }),
    msg({ type: 'theme', theme: 'sand' }),
    msg({ type: 'theme', theme: 'system' }),
    msg({ type: 'collapse', w: 0, h: 40 }),
    msg({ type: 'collapse', w: 10, h: Infinity }),
    msg({ type: 'collapse', w: '10', h: 10 }),
    msg({ type: 'collapse', w: 10, h: 10, shadow: 1 }),
    msg({ type: 'edge', hover: 'yes' }),
    msg({ type: 'edge', hover: true, edge: 'up' }),
    msg({ type: 'drag', kind: 'up', phase: 'start', dx: 0, dy: 0 }),
    msg({ type: 'drag', kind: 'n', phase: 'cancel', dx: 0, dy: 0 }),
    msg({ type: 'drag', kind: 'n', phase: 'move', dx: Number.NaN, dy: 0 }),
    msg({ type: 'drag', kind: 'n', phase: 'move', dx: 0 }),
  ])('rejects %j', (data) => {
    expect(isAdminToWindowMessage(data)).toBe(false);
  });
});

describe('isPreviewToAdminMessage and isAdminToPreviewMessage', () => {
  it('checks the preview state shape', () => {
    expect(isPreviewToAdminMessage(msg({ type: 'preview', state: null }))).toBe(true);
    expect(isPreviewToAdminMessage(msg({ type: 'preview', state: { branch: 'b', patched: 0, pending: 1 } }))).toBe(
      true,
    );
    expect(isPreviewToAdminMessage(msg({ type: 'preview', state: { branch: 'b', patched: 0 } }))).toBe(false);
    expect(isPreviewToAdminMessage(msg({ type: 'preview', state: 'on' }))).toBe(false);
    expect(isPreviewToAdminMessage(msg({ type: 'preview-exit' }))).toBe(false);
    expect(isPreviewToAdminMessage(undefined)).toBe(false);
  });

  it('knows the exit message', () => {
    expect(isAdminToPreviewMessage(msg({ type: 'preview-exit' }))).toBe(true);
    expect(isAdminToPreviewMessage({ source: 'other', type: 'preview-exit' })).toBe(false);
    expect(isAdminToPreviewMessage(msg({ type: 'preview' }))).toBe(false);
  });
});

const select = (over: Record<string, unknown> = {}) =>
  msg({ type: 'select', entry: 'post/a', quote: 'words', prefix: '', suffix: '', ...over });

describe('isSelectMessage', () => {
  it('accepts a selection with or without a field', () => {
    expect(isSelectMessage(select())).toBe(true);
    expect(isSelectMessage(select({ field: 'title' }))).toBe(true);
  });

  it.each([
    [{ entry: '' }],
    [{ entry: 3 }],
    [{ field: 1 }],
    [{ quote: '   ' }],
    [{ quote: undefined }],
    [{ prefix: null }],
    [{ suffix: 0 }],
    [{ type: 'selection' }],
  ])('rejects %j', (over) => {
    expect(isSelectMessage(select(over))).toBe(false);
  });
});

describe('isViewportMessage', () => {
  it('accepts the safe area and the keyboard in px, zero included', () => {
    expect(isViewportMessage(msg({ type: 'viewport', safeBottom: 34, keyboard: 0 }))).toBe(true);
    expect(isViewportMessage(msg({ type: 'viewport', safeBottom: 0, keyboard: 300 }))).toBe(true);
  });

  it.each([
    msg({ type: 'viewport', safeBottom: -1, keyboard: 0 }),
    msg({ type: 'viewport', safeBottom: 0, keyboard: Number.NaN }),
    msg({ type: 'viewport', safeBottom: '34', keyboard: 0 }),
    msg({ type: 'viewport', safeBottom: 0 }),
    { type: 'viewport', safeBottom: 0, keyboard: 0 },
  ])('rejects %j', (data) => {
    expect(isViewportMessage(data)).toBe(false);
  });
});
