import type { ConflictField, ConflictPick } from '../entry/conflict';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';
import { RadioGroup } from '../ui/primitives/checkbox';
import { Choice } from '../ui/primitives/choice';

// Conflict · compare (FigCraft; final.py `choice`): the fields another save changed since the form was opened, each a
// choice between that version and yours; the CTA applies the picks to the form on top of the newer file. Props only:
// the entry screen passes the three versions' fields (`conflictFields`), /design the design's two.

export interface CompareSheetProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  fields: ConflictField[];
  picks: Record<string, ConflictPick>;
  onPick(key: string, pick: ConflictPick): void;
  /** Where the other save is: *On GitHub* (GitHub mode) or *On disk* (dev mode). */
  where: 'github' | 'disk';
  onApply(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What a card shows of a long value: from its first line that differs from the other side (`…` when cut above). */
export function excerpt(text: string, other: string): string {
  const lines = text.split('\n');
  const others = other.split('\n');
  const at = lines.findIndex((line, i) => line !== others[i]);
  const from = at <= 0 ? 0 : at;
  return `${from > 0 ? '…\n' : ''}${lines.slice(from).join('\n')}`;
}

/** A radio's name: the side and the start of its value (a body is read in full on screen, not in the name). */
const nameOf = (side: string, text: string) =>
  `${side}: ${text === '' ? 'empty' : text.length > 80 ? `${text.slice(0, 80).trimEnd()}…` : text}`;

function Version({ value, side, text, other }: { value: ConflictPick; side: string; text: string; other: string }) {
  const shown = text === '' ? '' : excerpt(text, other);
  return (
    <Choice value={value} aria-label={nameOf(side, shown.replace(/^…\n/, '… '))} className="w-full">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">{side}</span>
        <span
          className={
            text === '' ? 'text-base text-muted-foreground' : 'line-clamp-3 text-base break-words whitespace-pre-line'
          }
        >
          {text === '' ? 'Empty' : shown}
        </span>
      </span>
      {/* The radio's mark (final.py `choice`): an ink dot when chosen. */}
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-card inset-ring-1 inset-ring-input group-data-checked:bg-gradient-ink group-data-checked:inset-ring-0"
      >
        <span className="hidden size-2 rounded-full bg-on-ink group-data-checked:block" />
      </span>
    </Choice>
  );
}

export function CompareSheet({ open, onOpenChange, fields, picks, onPick, where, onApply }: CompareSheetProps) {
  const other = where === 'github' ? 'On GitHub' : 'On disk';
  const place = where === 'github' ? 'on GitHub' : 'on disk';
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Compare changes"
      sub={fields.length === 0 ? 'No field needs a choice' : `${plural(fields.length, 'field')} changed ${place}`}
      bar={
        <BottomBar>
          <Button variant="primary" size="lg" full onClick={onApply}>
            {fields.length === 0 ? 'Apply' : `Apply ${plural(fields.length, 'choice')}`}
          </Button>
        </BottomBar>
      }
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-8">
        {fields.length === 0 ? (
          <p className="m-0 text-base text-muted-foreground">
            The other save changed fields you did not edit. Your edits stay on top of it.
          </p>
        ) : (
          fields.map((f) => (
            <RadioGroup
              key={f.key}
              aria-label={f.label}
              value={picks[f.key] ?? (f.yoursChanged ? 'yours' : 'theirs')}
              onValueChange={(v) => onPick(f.key, v as ConflictPick)}
              className="gap-2"
            >
              <span aria-hidden="true" className="text-sm font-semibold">
                {f.label}
              </span>
              <Version value="theirs" side={other} text={f.theirs} other={f.yours} />
              <Version value="yours" side="Yours" text={f.yours} other={f.theirs} />
            </RadioGroup>
          ))
        )}
      </div>
    </Sheet>
  );
}
