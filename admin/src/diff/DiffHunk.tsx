import { diffLines } from 'diff';
import { useMemo } from 'react';

import { cn } from '../ui/cn';

type DiffHunkProps = {
  before: string;
  after: string;
  /** Show line numbers in the gutter. Useful for markdown and text files; off by default for short fields. */
  showLineNumbers?: boolean;
  className?: string;
};

type RenderedLine = {
  kind: 'add' | 'del' | 'ctx';
  text: string;
  beforeNum: number | null;
  afterNum: number | null;
};

const LINE: Record<RenderedLine['kind'], string> = {
  add: 'bg-tint-success text-tint-success-foreground',
  del: 'bg-tint-danger text-tint-danger-foreground',
  ctx: 'bg-card text-foreground',
};

const SIGN: Record<RenderedLine['kind'], string> = { add: '+', del: '−', ctx: ' ' };

/**
 * A unified line diff of two strings (FigCraft `diff_box` for text that has several lines): monospace lines on a 16 px
 * card, an added line on the success tint, a removed one on the danger tint (each tint's own text colour, 4.5 : 1),
 * the sign first so the colour never stands alone.
 */
export function DiffHunk({ before, after, showLineNumbers = false, className }: DiffHunkProps) {
  const lines = useMemo(() => buildLines(before, after), [before, after]);

  if (lines.length === 0) {
    return (
      <div className={cn('rounded-2xl bg-card p-4 text-sm text-muted-foreground shadow-card', className)}>
        No content
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-2xl bg-card font-mono text-sm shadow-card', className)}>
      {lines.map((ln, i) => (
        <div
          key={i}
          className={cn('flex min-w-max gap-2 px-3 py-0.5', LINE[ln.kind])}
          data-editlet="diff-line"
          data-kind={ln.kind}
        >
          {showLineNumbers ? (
            <>
              <span className="w-6 shrink-0 text-right tabular-nums">{ln.beforeNum ?? ''}</span>
              <span className="w-6 shrink-0 text-right tabular-nums">{ln.afterNum ?? ''}</span>
            </>
          ) : null}
          <span className="w-3 shrink-0" aria-hidden={ln.kind === 'ctx' ? 'true' : undefined}>
            {SIGN[ln.kind]}
          </span>
          <span className="whitespace-pre">{ln.text === '' ? ' ' : ln.text}</span>
        </div>
      ))}
    </div>
  );
}

function buildLines(before: string, after: string): RenderedLine[] {
  if (before === after) {
    return before.split('\n').map((t, i) => ({ kind: 'ctx' as const, text: t, beforeNum: i + 1, afterNum: i + 1 }));
  }

  const parts = diffLines(before, after, { newlineIsToken: false });
  const out: RenderedLine[] = [];
  let beforeLine = 1;
  let afterLine = 1;

  for (const part of parts) {
    // Split the chunk into lines, dropping the trailing empty element produced by a terminal "\n".
    const rawLines = part.value.split('\n');
    if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') rawLines.pop();

    for (const text of rawLines) {
      if (part.added) out.push({ kind: 'add', text, beforeNum: null, afterNum: afterLine++ });
      else if (part.removed) out.push({ kind: 'del', text, beforeNum: beforeLine++, afterNum: null });
      else out.push({ kind: 'ctx', text, beforeNum: beforeLine++, afterNum: afterLine++ });
    }
  }

  return out;
}
