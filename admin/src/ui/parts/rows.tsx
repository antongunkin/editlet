import { cva } from 'class-variance-authority';
import {
  createContext,
  useContext,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ElementType,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/button';
import { Icon } from '../primitives/icon';
import { IconButton } from '../primitives/icon-button';
import { IconTile } from '../primitives/icon-tile';
import type { IconName } from '../primitives/icons';

/**
 * The row family (FigCraft `Row`, `FieldRow`, `Option`, `Selected`, `Block`, `Step`, `Action`, proposal §14.9): the main
 * touch targets of the admin, 56 or 72 px tall with 16 px at the sides and 12 px between the parts. The whole row is the
 * control (a button). Hover is the sunken fill, pressed the tray colour, keyboard focus a 2 px ring inside; disabled is
 * 40 %. A row that holds its own buttons (`SelectedRow`, `BlockRow`) or only shows a state (`StepRow`) has none of those.
 */
export const rowVariants = cva(
  [
    'relative box-border flex w-full items-center gap-3 border-0 bg-transparent px-4 py-0 text-left font-sans text-foreground outline-none',
    'data-selected:bg-sunken data-disabled:cursor-default data-disabled:opacity-40',
  ],
  {
    variants: {
      size: { 56: 'h-14', 72: 'h-18' },
      // Only a row that is itself the control has the states: `:active` also reaches a row from a button inside it, and a
      // row that is only a layout (a step, a block) is not something to hover.
      pressable: {
        true: 'group cursor-pointer hovered:bg-sunken pressed:bg-background focused:inset-ring-2 focused:inset-ring-ring',
        false: '',
      },
    },
    defaultVariants: { size: 72, pressable: false },
  },
);

type Shell = { as?: ElementType; size?: 56 | 72; selected?: boolean; disabled?: boolean };

/** The row's box: a button for a row that opens something, a div when the row holds its own buttons. */
function RowShell({
  as: Tag = 'div',
  size,
  selected,
  disabled,
  className,
  ...props
}: Shell & { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return (
    <Tag
      data-slot="row"
      data-selected={selected ? '' : undefined}
      data-disabled={disabled ? '' : undefined}
      className={cn(rowVariants({ size, pressable: Tag === 'button' }), className)}
      {...(Tag === 'button' ? { type: 'button', disabled } : {})}
      {...props}
    />
  );
}

/** The title (16 px medium) over an optional line (14 px muted), cut with an ellipsis. */
export function RowText({ title, sub, semibold }: { title: ReactNode; sub?: ReactNode; semibold?: boolean }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className={cn('truncate text-base', semibold ? 'font-semibold' : 'font-medium')}>{title}</span>
      {sub ? (
        <span className="truncate text-sm font-normal text-muted-foreground group-pressed:text-tray-muted-foreground">
          {sub}
        </span>
      ) : null}
    </span>
  );
}

function Skeleton() {
  return (
    <span className="flex flex-1 flex-col gap-2">
      <span className="sr-only">Loading…</span>
      <span aria-hidden="true" className="h-3 w-45 rounded-full bg-muted" />
      <span aria-hidden="true" className="h-2 w-28 rounded-full bg-muted" />
    </span>
  );
}

export const RowChevron = () => <Icon name="chevron-right" size={16} className="shrink-0 text-subtle" />;

export interface RowProps extends Omit<ComponentProps<'button'>, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  /** An icon on a 40 px tile before the text. */
  lead?: IconName;
  /** Something after the text: a badge, a count. */
  trail?: ReactNode;
  /** The chevron that says the row opens something. */
  chevron?: boolean;
  selected?: boolean;
  /** Placeholder bars instead of the text while it loads. */
  loading?: boolean;
  /** 72 px when it has a line or an icon, else 56. */
  size?: 56 | 72;
}

/** A list row (`Row/<56|72>/<state>`): a button that opens the thing it shows. */
export function Row({
  title,
  sub,
  lead,
  trail,
  chevron = true,
  selected,
  loading,
  size,
  disabled,
  ...props
}: RowProps) {
  return (
    <RowShell
      // A placeholder while it loads is not a control: no tab stop, nothing to press.
      as={loading ? 'div' : 'button'}
      size={size ?? (sub || lead ? 72 : 56)}
      selected={selected}
      disabled={disabled}
      aria-current={selected ? 'true' : undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {lead ? <IconTile name={lead} /> : null}
      {loading ? <Skeleton /> : <RowText title={title} sub={sub} />}
      {loading ? null : trail}
      {chevron && !loading ? <RowChevron /> : null}
    </RowShell>
  );
}

export interface FieldRowProps extends Omit<ComponentProps<'button'>, 'value'> {
  label: ReactNode;
  value?: ReactNode;
  required?: boolean;
  /** The field has unsaved changes: an amber dot and the word. */
  changed?: boolean;
  /** The field is invalid: the red tint, the icon and the word. */
  invalid?: boolean;
  /** The word for an invalid field: *Required* by default. */
  problem?: ReactNode;
  /** The id of the problem's words, for a control in the row that points at them (`aria-describedby`). */
  problemId?: string;
  readOnly?: boolean;
  loading?: boolean;
  /** Replaces the chevron (a switch for a boolean). */
  trailing?: ReactNode;
}

/** A field of the entry as a row (`FieldRow/<state>`): its label, its value, its state in words. */
export function FieldRow({
  label,
  value,
  required,
  changed,
  invalid,
  problem = 'Required',
  problemId,
  readOnly,
  loading,
  trailing,
  className,
  ...props
}: FieldRowProps) {
  const empty = value === undefined || value === '';
  return (
    <RowShell
      // A row with its own control, or a placeholder while it loads, is not itself a button.
      as={trailing || loading ? 'div' : 'button'}
      size={72}
      aria-busy={loading || undefined}
      className={cn(invalid && 'bg-tint-danger', className)}
      {...props}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span
          className={cn(
            'flex items-center gap-1.5 text-sm font-medium text-muted-foreground group-pressed:text-tray-muted-foreground',
            invalid && 'text-tint-danger-foreground',
          )}
        >
          <span>
            {label}
            {required ? ' *' : null}
          </span>
          {changed ? (
            <>
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-chart-1" />
              <span className="text-xs text-tint-unsaved-foreground">Changed</span>
            </>
          ) : null}
          {invalid ? (
            <>
              <Icon name="alert" size={16} className="shrink-0 text-destructive" />
              <span id={problemId} className="text-xs text-tint-danger-foreground">
                {problem}
              </span>
            </>
          ) : null}
          {readOnly ? <span className="text-xs font-normal">· read-only</span> : null}
        </span>
        {loading ? (
          <>
            <span className="sr-only">Loading…</span>
            <span aria-hidden="true" className="h-3 w-50 rounded-full bg-muted" />
          </>
        ) : (
          <span
            className={cn(
              'truncate text-base font-normal',
              empty
                ? invalid
                  ? 'text-tint-danger-foreground'
                  : 'text-muted-foreground group-pressed:text-tray-muted-foreground'
                : readOnly
                  ? 'text-muted-foreground group-pressed:text-tray-muted-foreground'
                  : 'text-foreground',
            )}
          >
            {empty ? (required ? 'Required' : 'Empty') : value}
          </span>
        )}
      </span>
      {trailing ?? (readOnly || loading ? null : <RowChevron />)}
    </RowShell>
  );
}

export interface OptionProps extends Omit<ComponentProps<'button'>, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  selected?: boolean;
  /** Several options can be chosen: a box that fills, not a check. */
  multi?: boolean;
}

/** One answer in a list of choices (`Option/<56|72>/<default|selected>`): the chosen one is semibold with a check or a filled box. */
export function Option({ title, sub, selected = false, multi = false, ...props }: OptionProps) {
  return (
    <RowShell as="button" size={sub ? 72 : 56} role={multi ? 'checkbox' : 'radio'} aria-checked={selected} {...props}>
      <RowText title={title} sub={sub} semibold={selected} />
      {multi ? (
        <span
          aria-hidden="true"
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md text-on-ink',
            selected ? 'bg-gradient-ink' : 'bg-card inset-ring-1 inset-ring-input',
          )}
        >
          {selected ? <Icon name="check" size={16} strokeWidth={2.5} /> : null}
        </span>
      ) : (
        <span aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
          {selected ? <Icon name="check" size={20} strokeWidth={2.25} /> : null}
        </span>
      )}
    </RowShell>
  );
}

export interface SelectedRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  /** The chosen entry is gone: the red tint, an alert tile. */
  missing?: boolean;
  /** Takes the entry out of the list. */
  onRemove?: () => void;
  /** The entry's name for the remove button, when `title` is not a string (a link). */
  itemName?: string;
}

/** One chosen entry of a reference or a tag list (`Selected/<default|missing>`): a grip, its name, and a remove button. */
export function SelectedRow({ title, sub, missing, onRemove, itemName, className, ...props }: SelectedRowProps) {
  return (
    <RowShell size={72} className={cn(missing && 'bg-tint-danger', className)} {...props}>
      <IconTile name={missing ? 'alert' : 'grip'} tone={missing ? 'danger' : 'neutral'} />
      <RowText title={title} sub={sub} />
      <IconButton
        icon={<Icon name="x" size={16} />}
        label={`Remove ${itemName ?? (typeof title === 'string' ? title : 'this entry')}`}
        onClick={onRemove}
      />
    </RowShell>
  );
}

const AnnounceBlock = createContext<((text: string) => void) | null>(null);

/**
 * The list of a page's blocks, with the live region that says where a moved block went. The region is on the page from
 * the start (a screen reader announces text *added* to one that was already there) and has no role, only `aria-live`.
 */
export function BlockList({ className, children, ...props }: ComponentProps<'ul'>) {
  const [message, setMessage] = useState('');
  return (
    <AnnounceBlock value={setMessage}>
      <ul data-slot="block-list" className={cn('m-0 flex list-none flex-col p-0', className)} {...props}>
        {children}
      </ul>
      <div aria-live="polite" className="sr-only">
        {message}
      </div>
    </AnnounceBlock>
  );
}

export interface BlockRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  /** The kind of block: its icon on a 32 px tile after the text. */
  kind?: IconName;
  /** Where the block is now (1-based) and how many there are: the position said aloud after a move. */
  position?: number;
  total?: number;
  /** Moves the block one place up (-1) or down (1): the grip's arrow keys, or dragging the grip a row's height. */
  onMove?: (delta: -1 | 1) => void;
  /** Opens the block: the rest of the row is then a button. */
  onOpen?: () => void;
}

/** A row's height (72 px, `h-18`): dragging the grip this far moves the block one place. */
const ROW_PX = 72;

/**
 * A block of a page (`Block/default`): a grip, its name, its kind. The grip is the handle: focus it and press the arrow
 * keys, or drag it with the pointer, to move the block. The grip keeps the focus through the move (the node moves, so
 * focus is put back), and inside a `BlockList` the new place is announced ("Quote, 2 of 5"; "Hero, already first" at an
 * end). With `onOpen` the name and the kind are a button that opens the block.
 */
export function BlockRow({ title, sub, kind, position, total, onMove, onOpen, className, ...props }: BlockRowProps) {
  const announce = useContext(AnnounceBlock);
  const grip = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const name = typeof title === 'string' ? title : 'Block';
  const move = (delta: -1 | 1): boolean => {
    if (position !== undefined && total !== undefined) {
      const next = position + delta;
      if (next < 1 || next > total) {
        announce?.(`${name}, already ${delta < 0 ? 'first' : 'last'}`);
        return false;
      }
      announce?.(`${name}, ${next} of ${total}`);
    }
    onMove?.(delta);
    // Moving the block moves its node in the DOM, which drops the focus: put it back on this grip.
    requestAnimationFrame(() => grip.current?.focus());
    return true;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    move(e.key === 'ArrowUp' ? -1 : 1);
  };
  // Pointer drag: every row's height the pointer travels moves the block one place, so the row follows the finger.
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, at: position ?? 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.trunc((e.clientY - d.y) / ROW_PX);
    if (steps === 0) return;
    const delta = steps < 0 ? -1 : 1;
    d.y += delta * ROW_PX;
    move(delta);
  };
  const end = () => {
    drag.current = null;
  };
  const text = (
    <>
      <RowText title={title} sub={sub} />
      {kind ? <IconTile name={kind} size={32} /> : null}
    </>
  );
  return (
    <RowShell as={announce ? 'li' : 'div'} size={72} className={cn(onOpen && 'pr-0', className)} {...props}>
      <button
        ref={grip}
        type="button"
        data-slot="grip"
        aria-label={`Move ${name}: arrow up or down`}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        className="group/grip inline-flex size-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-full border-0 bg-transparent p-0 text-foreground outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-ring"
      >
        <IconTile name="grip" />
      </button>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="group flex h-full min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent py-0 pr-4 pl-0 text-left font-sans text-foreground outline-none hovered:bg-sunken pressed:bg-background focused:inset-ring-2 focused:inset-ring-ring"
        >
          {text}
          <RowChevron />
        </button>
      ) : (
        text
      )}
    </RowShell>
  );
}

export type StepKind = 'done' | 'busy' | 'fail' | 'todo' | 'current';

export interface StepRowProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  sub?: ReactNode;
  kind: StepKind;
}

/** One step of a process (`Step/<kind>`): the publish flow: its mark is done, busy, failed, to do, or the current one. */
export function StepRow({ title, sub, kind, ...props }: StepRowProps) {
  return (
    <RowShell size={72} {...props}>
      <RowText title={title} sub={sub} />
      <span
        aria-hidden="true"
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          kind === 'done' && 'bg-chart-2 text-on-ink',
          kind === 'fail' && 'bg-destructive text-on-ink',
          kind === 'busy' && 'bg-card text-muted-foreground inset-ring-1 inset-ring-input',
          kind === 'todo' && 'bg-card inset-ring-1 inset-ring-input',
          kind === 'current' && 'bg-card inset-ring-2 inset-ring-foreground',
        )}
      >
        {kind === 'done' ? <Icon name="check" size={16} strokeWidth={2.5} /> : null}
        {kind === 'fail' ? <Icon name="x" size={16} strokeWidth={2.5} /> : null}
        {kind === 'busy' ? (
          <Icon name="loader" size={16} strokeWidth={2.25} className="animate-spin motion-reduce:animate-none" />
        ) : null}
      </span>
      <span className="sr-only">
        {{ done: 'Done', busy: 'In progress', fail: 'Failed', todo: 'To do', current: 'Current step' }[kind]}
      </span>
    </RowShell>
  );
}

export interface ActionRowProps extends ComponentProps<'button'> {
  icon: IconName;
  /** Destructive: red icon and text. */
  danger?: boolean;
  /** A muted note after the label (a count). */
  note?: ReactNode;
}

/** One action of an action sheet (`Action/<default|danger>`): 56 px, an icon and a label. */
export function ActionRow({ icon, danger, note, children, ...props }: ActionRowProps) {
  return (
    <RowShell
      as="button"
      size={56}
      className={cn('text-base font-medium', danger && 'text-tint-danger-foreground')}
      {...props}
    >
      <Icon name={icon} size={20} className={cn('shrink-0', danger && 'text-destructive')} />
      <span className="min-w-0 flex-1 truncate text-base font-medium">{children}</span>
      {note ? <span className="text-sm font-normal text-muted-foreground">{note}</span> : null}
    </RowShell>
  );
}

/**
 * A copyable prompt (`Row/prompt/default`): a title and its text (two lines at most) and the Copy button, which the
 * title describes (three buttons that say only *Copy* are not told apart otherwise).
 */
export function PromptRow({
  title,
  body,
  copied,
  onCopy,
  className,
  ...props
}: Omit<ComponentProps<'div'>, 'title' | 'children'> & {
  title: ReactNode;
  body: ReactNode;
  copied?: boolean;
  onCopy?: () => void;
}) {
  const titleId = useId();
  return (
    <div data-slot="prompt-row" className={cn('flex items-center gap-3 px-4 py-3', className)} {...props}>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span id={titleId} className="truncate text-base font-medium">
          {title}
        </span>
        <span className="line-clamp-2 text-sm text-muted-foreground">{body}</span>
      </span>
      <Button
        variant="secondary"
        onClick={onCopy}
        aria-describedby={titleId}
        icon={copied ? <Icon name="check" size={16} /> : undefined}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
      {/* A live region from the start, so a screen reader announces the copy once. */}
      <output className="sr-only">{copied ? 'Copied to clipboard' : ''}</output>
    </div>
  );
}
