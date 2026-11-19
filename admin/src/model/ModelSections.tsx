import type { ReactNode } from 'react';

import type { ChatPrompt, FieldMark, FieldRow } from './model';
import type { ProblemFile } from './problems';

import type { Issue } from '../../../core/issues';
import { RouteLink } from '../RouteLink';
import { issueText } from '../screens/BrokenSchema';
import { Card } from '../ui/parts/card';
import { PromptRow, Row } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Badge } from '../ui/primitives/badge';

// The parts of the content model screen (FigCraft *Content model*, *· collection*, *· Ask Claude Code*, *· problems*):
// a collection's row, the problems card, one field of a collection, and the two sheets. Data in, nodes out; the
// container (ContentModel.tsx) has the schema, the entries and the clipboard.

export const MARK_TONE = { new: 'success', changed: 'unsaved' } as const;
export const MARK_TEXT = { new: 'New', changed: 'Changed' } as const;

const BADGE_TEXT = { title: 'Title', slugSource: 'Slug source', body: 'Body' } as const;

/** `post · 9 entries · 14 fields`: the line under a collection's name. */
export function collectionLine(key: string, singleton: boolean, count: number | undefined, fields: number): string {
  const parts = [key];
  if (singleton) {
    if (count === 0) parts.push('index.md missing');
  } else if (count !== undefined) {
    parts.push(count === 1 ? '1 entry' : `${count} entries`);
  }
  parts.push(fields === 1 ? '1 field' : `${fields} fields`);
  return parts.join(' · ');
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="m-0 px-4 pb-2 text-sm font-medium text-tray-muted-foreground">{children}</h2>;
}

/** One collection of the list: its name, the line under it, *Singleton* and the mark of a change. Opens its sheet. */
export function CollectionRow({
  label,
  line,
  singleton,
  mark,
  onOpen,
}: {
  label: string;
  line: string;
  singleton: boolean;
  mark?: FieldMark;
  onOpen: () => void;
}) {
  return (
    <Row
      title={label}
      sub={line}
      onClick={onOpen}
      trail={
        singleton || mark ? (
          <span className="flex gap-1">
            {singleton ? <Badge>Singleton</Badge> : null}
            {mark ? <Badge tone={MARK_TONE[mark]}>{MARK_TEXT[mark]}</Badge> : null}
          </span>
        ) : undefined
      }
    />
  );
}

const issueLine = (issue: Issue) => (issue.path ? `${issue.path} — ${issue.message}` : issue.message);

/**
 * What is wrong (FigCraft *Content model · problems*): the schema file that has errors (the last valid version is
 * shown), and each entry file that fails the schema, with a link to it and its issues.
 */
export function ProblemsCard({ schemaIssues, problems }: { schemaIssues: Issue[] | null; problems: ProblemFile[] }) {
  return (
    <section
      aria-label="Problems"
      className="flex flex-col gap-4 rounded-2xl bg-tint-danger p-4 text-sm text-tint-danger-foreground"
    >
      {schemaIssues ? (
        <div className="flex flex-col gap-2">
          <strong className="font-medium">The schema file has errors. Showing the last valid version.</strong>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 break-words">
            {schemaIssues.map((issue, i) => (
              <li key={i}>{issueText(issue)}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {problems.map((p) => (
        <div key={p.file} className="flex flex-col gap-2">
          {p.entry ? (
            <RouteLink
              to={{ kind: 'entry', collection: p.entry.collection, slug: p.entry.slug }}
              className="inline-flex min-h-11 items-center self-start rounded-md font-mono text-sm font-medium break-all underline outline-none focused:outline-2 focused:outline-offset-2 focused:outline-ring"
            >
              {p.file}
            </RouteLink>
          ) : (
            <span className="font-mono text-sm font-medium break-all">{p.file}</span>
          )}
          <ul className="m-0 flex list-none flex-col gap-1 p-0 break-words">
            {p.issues.map((issue, i) => (
              <li key={i}>{issueLine(issue)}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

/** What the line under a field says: its key, its type and where it points, then what it needs. */
export function fieldLine(row: FieldRow): string {
  const type = row.targets.length > 0 ? `${row.type} → ${row.targets.join(', ')}` : row.type;
  return [row.key, type, row.many ? 'many' : null, row.required ? 'Required' : null, ...row.details]
    .filter((part): part is string => part !== null)
    .join(' · ');
}

/** One field of a collection (FigCraft `def_row`): read-only, so a plain row with no chevron. */
export function FieldDefRow({ row, mark }: { row: FieldRow; mark?: FieldMark }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-base font-medium break-words">{row.label}</span>
        <span className="text-sm break-words text-muted-foreground">{fieldLine(row)}</span>
        {row.hint ? <span className="text-sm break-words text-muted-foreground">{row.hint}</span> : null}
      </span>
      {row.badges.length > 0 || mark ? (
        <span className="flex flex-wrap justify-end gap-1">
          {row.badges.map((b) => (
            <Badge key={b}>{BADGE_TEXT[b]}</Badge>
          ))}
          {mark ? <Badge tone={MARK_TONE[mark]}>{MARK_TEXT[mark]}</Badge> : null}
        </span>
      ) : null}
    </li>
  );
}

export interface ReferencedBy {
  from: string;
  label: string;
  field: string;
  many: boolean;
}

/**
 * One collection in a sheet (FigCraft *Content model · collection*): its fields, who points at it, a way to change it
 * with the coding agent, and the CTA that opens its entries (`cta`, in the bar). `children`: the sheet it opens.
 */
export function CollectionSheet({
  open,
  onOpenChange,
  title,
  sub,
  rows,
  marks,
  references,
  referencedBy,
  onOpenOther,
  askLabel,
  onAsk,
  bar,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sub: string;
  rows: FieldRow[];
  marks?: Map<string, FieldMark>;
  /** The collections this one points at, one row per reference field and target. */
  references?: ReferencedBy[];
  referencedBy: ReferencedBy[];
  /** Another collection (a row of *References* or *Referenced by*): the sheet shows it instead. */
  onOpenOther: (key: string) => void;
  askLabel: string;
  onAsk: () => void;
  bar?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} sub={sub} bar={bar}>
      <div className="flex flex-col gap-4 px-4 pb-8">
        <Card as="ul" aria-label={`${title} fields`}>
          {rows.map((row) => (
            <FieldDefRow key={row.key} row={row} mark={marks?.get(row.key)} />
          ))}
          <li>
            <Row lead="zap" title={askLabel} sub="Add, rename or remove a field" onClick={onAsk} />
          </li>
        </Card>
        {references && references.length > 0 ? (
          <div>
            <SectionTitle>References</SectionTitle>
            <Card as="ul" aria-label={`Collections that ${title} points at`}>
              {references.map((e) => (
                <li key={`${e.field}>${e.from}`}>
                  <Row
                    title={e.label}
                    sub={`${e.field} → · ${e.many ? 'many' : 'one'}`}
                    size={56}
                    onClick={() => onOpenOther(e.from)}
                  />
                </li>
              ))}
            </Card>
          </div>
        ) : null}
        {referencedBy.length > 0 ? (
          <div>
            <SectionTitle>Referenced by</SectionTitle>
            <Card as="ul" aria-label={`Collections that point at ${title}`}>
              {referencedBy.map((e) => (
                <li key={`${e.from}.${e.field}`}>
                  <Row
                    title={e.label}
                    sub={`.${e.field} · ${e.many ? 'many' : 'one'}`}
                    size={56}
                    onClick={() => onOpenOther(e.from)}
                  />
                </li>
              ))}
            </Card>
          </div>
        ) : null}
      </div>
      {children}
    </Sheet>
  );
}

/** Copyable prompts (FigCraft *Content model · Ask Claude Code*): a title, the prompt (two lines) and Copy. */
export function AskSheet({
  open,
  onOpenChange,
  sub = 'Copy a prompt and paste it in Claude Code',
  prompts,
  copied,
  onCopy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sub?: string;
  prompts: ChatPrompt[];
  /** The id of the prompt that was just copied. */
  copied: string | null;
  onCopy: (prompt: ChatPrompt) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Ask Claude Code" sub={sub}>
      <div className="px-4 pb-8">
        <Card as="ul" aria-label="Prompts">
          {prompts.map((p) => (
            <li key={p.id}>
              <PromptRow title={p.title} body={p.text} copied={copied === p.id} onCopy={() => onCopy(p)} />
            </li>
          ))}
        </Card>
      </div>
    </Sheet>
  );
}
