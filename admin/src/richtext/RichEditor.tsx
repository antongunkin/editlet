import type { Editor } from '@milkdown/core';
import { EditorState, TextSelection } from '@milkdown/prose/state';
import type { EditorView } from '@milkdown/prose/view';
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import { applyImage, applyLink, linkAt, selectedImage } from './commands';
import { createRichEditor, viewOf } from './editor';
import { createImageSlots } from './imageSlots';

import './richtext.css';
import { loadMarkdown, rawShare, saveMarkdown, type Codec, type Loaded } from './splice';
import { Toolbar } from './Toolbar';
import { ToolbarSlot } from './toolbarSlot';

import type { FieldContext } from '../fields/types';
import { MediaPicker } from '../media/MediaPicker';
import type { Projection } from '../select/match';
import { projectDoc } from '../select/project';
import { Button, Input } from '../ui';
import { Field, fieldDescribedBy } from '../ui/Field';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Sheet } from '../ui/parts/sheet';

/** More than this share of blocks kept as raw text, and the field opens in Source instead. */
const MAX_RAW_SHARE = 0.5;

export type RichEditorProps = {
  value: string;
  onChange(value: string): void;
  onBlur?(): void;
  ctx: FieldContext;
  /** The field's label, as the editable area's accessible name. */
  label: string;
  describedBy?: string;
  invalid?: boolean;
  /** The body cannot be edited here without losing markdown: the field switches to Source with this reason. */
  onFallback(reason: string): void;
  /** Select-to-edit: how to find and select text in the document (`null` until the editor is ready). */
  onSelectTarget?(target: (() => Projection) | null): void;
};

type Live = { editor: Editor; codec: Codec; view: EditorView; loaded: Loaded | null; emitted: string };

function LinkDialog({ view, onClose }: { view: EditorView; onClose(): void }) {
  const existing = linkAt(view.state);
  const [href, setHref] = useState(existing?.href ?? '');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const hrefRef = useRef<HTMLInputElement>(null);
  const needsText = view.state.selection.empty && !existing;
  const apply = () => {
    const tr = applyLink(view.state, { href, text });
    if (!tr) return setError('Use a web address (https://…), a relative path, mailto: or tel:');
    view.dispatch(tr);
    onClose();
    view.focus();
  };
  const formId = `${id}-form`;
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={existing ? 'Edit link' : 'Add link'}
      initialFocus={hrefRef}
      bar={
        <BottomBar>
          <Button variant="primary" size="lg" full type="submit" form={formId}>
            Apply
          </Button>
        </BottomBar>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-5 px-4 pt-1 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Field label="URL" htmlFor={`${id}-href`} error={error} hint={existing ? 'Empty removes the link' : undefined}>
          <Input
            ref={hrefRef}
            id={`${id}-href`}
            value={href}
            placeholder="https://"
            aria-invalid={error ? true : undefined}
            aria-describedby={fieldDescribedBy(`${id}-href`, existing, error)}
            onChange={(e) => {
              setHref(e.target.value);
              setError(null);
            }}
          />
        </Field>
        {needsText ? (
          <Field label="Text" htmlFor={`${id}-text`}>
            <Input id={`${id}-text`} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        ) : null}
      </form>
    </Sheet>
  );
}

function ImageDialog({ view, ctx, onClose }: { view: EditorView; ctx: FieldContext; onClose(): void }) {
  const selected = selectedImage(view.state);
  const [alt, setAlt] = useState(selected ? String(selected.node.attrs.alt) : '');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const id = useId();
  const put = (src: string) => {
    const tr = applyImage(view.state, { src, alt });
    if (!tr) return setError('This image address is not allowed');
    view.dispatch(tr);
    onClose();
    view.focus();
  };
  return (
    <MediaPicker
      open
      onOpenChange={(open) => !open && onClose()}
      title={selected ? 'Edit image' : 'Insert image'}
      images={ctx.images}
      entryFolder={ctx.entryPath.replace(/\.md$/, '')}
      contentDir={ctx.contentDir}
      Preview={ctx.Preview}
      uploading={uploading}
      onPick={(path) => put(ctx.toSrc(path))}
      onUpload={(file) => {
        setUploading(true);
        setError(null);
        ctx
          .stageUpload(file)
          .then(put, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
          .finally(() => setUploading(false));
      }}
    >
      <div className="flex flex-col gap-2 px-4">
        <label htmlFor={`${id}-alt`} className="px-1 text-sm font-medium text-tray-muted-foreground">
          Alt text
        </label>
        <Input
          id={`${id}-alt`}
          value={alt}
          placeholder="Describe the image for screen readers"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => setAlt(e.target.value)}
        />
        {error ? (
          <p id={`${id}-error`} className="m-0 px-1 text-sm font-medium text-tint-danger-foreground" role="alert">
            {error}
          </p>
        ) : null}
        {selected ? (
          <Button variant="primary" onClick={() => put(String(selected.node.attrs.src))}>
            Save alt text
          </Button>
        ) : null}
      </div>
    </MediaPicker>
  );
}

/**
 * WYSIWYG editing of a markdown body (Milkdown, loaded lazily). The value stays a markdown string: unchanged blocks
 * keep their source bytes (`saveMarkdown`), so a save without edits writes the same file and an edit touches only its
 * block. A body it cannot keep exactly calls `onFallback`.
 */
export default function RichEditor({
  value,
  onChange,
  onBlur,
  ctx,
  label,
  describedBy,
  invalid,
  onFallback,
  onSelectTarget,
}: RichEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [slots] = useState(createImageSlots);
  const images = useSyncExternalStore(slots.subscribe, slots.snapshot);
  const live = useRef<Live | null>(null);
  const [state, setState] = useState<EditorState | null>(null);
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null);
  const callbacks = useRef({ onChange, onFallback, onSelectTarget });
  callbacks.current = { onChange, onFallback, onSelectTarget };
  const initial = useRef(value);
  const attributes = useRef<Record<string, string>>({});
  attributes.current = {
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': label,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(invalid ? { 'aria-invalid': 'true' } : {}),
    class: 'editlet-rt-content',
  };

  /** Loads `markdown` as a fresh document (no undo history); falls back when it cannot be kept exactly. */
  const load = (l: Live, markdown: string) => {
    let loaded: Loaded;
    try {
      loaded = loadMarkdown(l.codec, markdown);
    } catch {
      callbacks.current.onFallback('This body could not be read by the rich editor; editing as source.');
      return;
    }
    if (loaded.blocks.length > 1 && rawShare(loaded) > MAX_RAW_SHARE) {
      callbacks.current.onFallback("This body has markdown the rich editor can't keep exactly; editing as source.");
      return;
    }
    l.loaded = loaded;
    l.emitted = markdown;
    l.view.updateState(EditorState.create({ doc: loaded.doc, plugins: l.view.state.plugins }));
    setState(l.view.state);
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let cancelled = false;
    let created: Editor | null = null;
    void createRichEditor({
      root,
      markdown: initial.current,
      attributes: attributes.current,
      images: slots,
      onLinkKey: () => setDialog('link'),
      onUpdate: (view) => {
        const l = live.current;
        if (!l?.loaded || l.view !== view) return;
        setState(view.state);
        const text = saveMarkdown(l.codec, l.loaded, view.state.doc);
        if (text !== l.emitted) {
          l.emitted = text;
          callbacks.current.onChange(text);
        }
      },
    }).then(
      ({ editor, codec }) => {
        if (cancelled) return void editor.destroy();
        created = editor;
        const l: Live = { editor, codec, view: viewOf(editor), loaded: null, emitted: initial.current };
        live.current = l;
        load(l, initial.current);
        callbacks.current.onSelectTarget?.(() => {
          const { text, at } = projectDoc(l.view.state.doc);
          return {
            text,
            select(start, end) {
              const now = l.view.state;
              l.view.dispatch(
                now.tr.setSelection(TextSelection.create(now.doc, at[start]!, at[end - 1]! + 1)).scrollIntoView(),
              );
              l.view.focus();
              // ProseMirror scrolls only as far as its own view; bring the words to the middle of the window too.
              const { node } = l.view.domAtPos(at[start]!);
              (node instanceof Element ? node : node.parentElement)?.scrollIntoView?.({
                block: 'center',
                behavior: 'smooth',
              });
            },
          };
        });
      },
      () => {
        if (!cancelled) callbacks.current.onFallback('The rich editor could not start; editing as source.');
      },
    );
    return () => {
      cancelled = true;
      live.current = null;
      callbacks.current.onSelectTarget?.(null);
      void created?.destroy();
    };
    // Created once; later values arrive through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A value from outside (Discard, Reload, a switch from Source) replaces the document.
  useEffect(() => {
    const l = live.current;
    if (l && value !== l.emitted) load(l, value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // The accessible name and description follow the field (errors come and go).
  useEffect(() => {
    live.current?.view.setProps({ attributes: attributes.current });
  }, [label, describedBy, invalid]);

  const view = live.current?.view;
  const toolbarSlot = useContext(ToolbarSlot);
  const toolbar =
    state && live.current ? (
      <Toolbar
        editor={live.current.editor}
        state={state}
        onLink={() => setDialog('link')}
        onImage={() => setDialog('image')}
      />
    ) : null;
  return (
    <div
      className="rounded-2xl bg-card shadow-raised focus-within:inset-ring-2 focus-within:inset-ring-ring"
      data-focus-ring=""
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onBlur?.();
      }}
    >
      {toolbarSlot && toolbar ? createPortal(toolbar, toolbarSlot) : toolbar}
      <div ref={rootRef} className="min-h-60" />
      {images.map((slot) =>
        createPortal(<ctx.Preview path={ctx.resolveSrc(slot.src)} alt={slot.alt} />, slot.dom, slot.id),
      )}
      {view && dialog === 'link' ? <LinkDialog view={view} onClose={() => setDialog(null)} /> : null}
      {view && dialog === 'image' ? <ImageDialog view={view} ctx={ctx} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
