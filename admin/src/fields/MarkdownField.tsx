import { lazy, Suspense, useEffect, useRef, useState } from 'react';

import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import type { Projection } from '../select/match';
import { projectMarkdown, selectInControl } from '../select/project';
import { Field, Switcher, SwitcherItem, Textarea } from '../ui';

/** The Milkdown editor is a separate chunk: it loads the first time a body is shown in Rich mode. */
const RichEditor = lazy(() => import('../richtext/RichEditor'));

export type MarkdownMode = 'rich' | 'source';

const MODE_KEY = 'editlet:markdown-mode';

function readMode(): MarkdownMode {
  try {
    return globalThis.localStorage?.getItem(MODE_KEY) === 'source' ? 'source' : 'rich';
  } catch {
    return 'rich';
  }
}

function storeMode(mode: MarkdownMode) {
  try {
    globalThis.localStorage?.setItem(MODE_KEY, mode);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
}

/**
 * Markdown body: **Rich** (WYSIWYG, `RichEditor`: unchanged blocks keep their source bytes) or **Source** (a plain
 * monospace textarea). The choice is remembered in `localStorage`. A body the rich editor cannot keep exactly opens
 * in Source with a note; the Source textarea also stands in while the rich editor loads.
 */
export function MarkdownField({ name, field, value, onChange, onBlur, error, ctx }: WidgetProps<string>) {
  const [mode, setMode] = useState<MarkdownMode>(() => ctx.markdownMode ?? readMode());
  const [fallback, setFallback] = useState<string | null>(null);
  const rich = mode === 'rich' && fallback === null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const richTarget = useRef<(() => Projection) | null>(null);

  // Select-to-edit: the body projects the text the page shows; Source maps it to source offsets, Rich to the editor.
  useEffect(() => {
    ctx.selectTarget?.(name, async () => {
      if (rich) return richTarget.current?.() ?? null;
      const ta = textareaRef.current;
      if (!ta) return null;
      const { text, at } = await projectMarkdown(ta.value);
      return { text, select: (start, end) => selectInControl(ta, at[start]!, at[end - 1]! + 1) };
    });
    return () => ctx.selectTarget?.(name, null);
  }, [ctx, name, rich]);
  const choose = (next: MarkdownMode) => {
    setMode(next);
    setFallback(null);
    storeMode(next);
  };

  const textarea = (
    <Textarea
      ref={textareaRef}
      id={name}
      className="min-h-80 resize-y font-mono text-sm leading-6"
      name={name}
      rows={16}
      value={value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      // The label names it too; the attribute keeps the name for tools that do not follow `<label for>`, and in Rich
      // mode (the label then points at nothing) for the textarea shown while the editor loads.
      aria-label={field.label}
      aria-invalid={invalid(error)}
      aria-describedby={describedBy(name, field, error)}
      aria-required={field.required || undefined}
    />
  );

  return (
    <Field {...fieldProps(field, error, name)} htmlFor={rich ? undefined : name}>
      <Switcher aria-label="Editor mode">
        <SwitcherItem active={rich} onClick={() => choose('rich')}>
          Rich
        </SwitcherItem>
        <SwitcherItem active={!rich} onClick={() => choose('source')}>
          Source
        </SwitcherItem>
      </Switcher>
      {fallback ? <output className="m-0 block px-1 text-sm text-tray-muted-foreground">{fallback}</output> : null}
      {rich ? (
        <Suspense fallback={textarea}>
          <RichEditor
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            ctx={ctx}
            label={field.label}
            describedBy={describedBy(name, field, error)}
            invalid={invalid(error)}
            onFallback={setFallback}
            onSelectTarget={(target) => {
              richTarget.current = target;
            }}
          />
        </Suspense>
      ) : (
        textarea
      )}
    </Field>
  );
}
