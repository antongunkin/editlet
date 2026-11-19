import type { ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { BigTitle, Header } from '../ui/parts/header';
import { Badge } from '../ui/primitives/badge';

// The schema does not load (FigCraft *Schema error*): the header, *The schema has errors* with a *Can't load* badge and
// the file to fix, the errors in a red card (one line each, in the file's own words), and the bottom bar with the one
// CTA, *Copy fix prompt*. Props only; BrokenSchema.tsx is the container.

export interface BrokenSchemaViewProps {
  /** The window's Move and Minimize. */
  actions?: ReactNode;
  /** The shell's notices under the header. */
  banners?: ReactNode;
  /** The file to fix, for the line under the title. */
  file: string;
  /** One line per issue (`<file>: <path>: <message>`). */
  issues: string[];
  status?: ReactNode;
  /** The bar's one CTA. */
  cta?: ReactNode;
  /** Tells a screen reader that the prompt was copied. */
  notice?: string;
}

export function BrokenSchemaView({ actions, banners, file, issues, status, cta, notice }: BrokenSchemaViewProps) {
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title="Content model" actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <BigTitle
          as="h1"
          title="The schema has errors"
          meta={
            <>
              <Badge tone="danger">Can't load</Badge>
              <span>Fix these problems in {file}.</span>
            </>
          }
        />
        {banners ? <div className="flex flex-col gap-2 px-4 pb-3 empty:hidden">{banners}</div> : null}
        <div className="px-4 pb-8">
          <div role="alert" className="rounded-2xl bg-tint-danger p-4 text-tint-danger-foreground">
            <ul className="m-0 flex list-none flex-col gap-3 p-0 font-mono text-sm break-words">
              {issues.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <BottomBar status={status} className="shrink-0">
        {cta}
      </BottomBar>
      <output className="sr-only">{notice}</output>
    </section>
  );
}
