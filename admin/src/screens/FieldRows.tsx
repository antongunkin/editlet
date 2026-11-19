import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

import { EntrySearch, matches } from './EntrySearch';

import { BLOCK_KEY, type BlockDef, type Field } from '../../../core/schema';
import { fieldSummary, itemTitle } from '../entry/summary';
import { ITEM_KEY, newItem } from '../entry/values';
import { FieldWidget, type FieldContext } from '../fields';
import { formatStored, parseStored, storeDay, storeMoment } from '../fields/dates';
import { asString, asStringList, splitErrors } from '../fields/shared';
import { ToolbarSlot } from '../richtext/toolbarSlot';
import { FieldInSheet } from '../ui/Field';
import { BottomBar } from '../ui/parts/bottom-bar';
import { Calendar, TimeWheel } from '../ui/parts/calendar';
import { Card } from '../ui/parts/card';
import { ActionRow, BlockList, BlockRow, FieldRow, Option, Row, SelectedRow } from '../ui/parts/rows';
import { Sheet } from '../ui/parts/sheet';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { Switch } from '../ui/primitives/switch';

// The entry's fields as rows, each opening its own modal (FigCraft *Entry*, *Edit · <field>*; spec decision 17): one
// field per modal. A tap on a row opens a `Sheet` with that field's editor; what is typed changes the form at once (the
// page preview follows), and Done or a swipe closes it. An object, a list of objects and the blocks open their own
// fields as rows again, one level down (docs/admin/entry-form.md).

/** One field as a row: where its value lives and how it changes. */
export interface FieldItem {
  /** The form key (or the key inside its object): the row's React key and the modal's key. */
  key: string;
  /** The dotted path (`sections.2.title`): the control's id, its hint and error ids, and select-to-edit. */
  name: string;
  field: Field;
  value: unknown;
  onChange(value: unknown): void;
  error?: string[];
  /** The value differs from the saved file: the row says *Changed*. */
  changed?: boolean;
}

export interface FieldRowsProps {
  items: FieldItem[];
  ctx: FieldContext;
  /** The modals' second line: the entry's title (or the object a nested field belongs to). */
  sub: string;
  /** Which row's modal is open; with `onOpen` the caller controls it (the entry screen: select-to-edit, Fix). */
  open?: string | null;
  onOpen?: (key: string | null) => void;
  /** Names a referenced entry for a row (its title). */
  title?: (ref: string) => string;
  /**
   * The modals under the open row's, outermost first: only /design sets it, to draw a nested modal open (`['2']` the
   * third item of a list, `['add']` the *Add* sheet and the entries ticked in it, `['months']` a calendar's view,
   * `['labels']` a row of an object).
   */
  nested?: string[];
  /** Uncontrolled only: the row that opens a moment after the rows mount (the object's row under `nested`). */
  initialOpen?: string;
}

/**
 * Runs `run` once, a moment after mount. A modal that opens in the same commit as the one under it would hide that
 * one, so /design opens a nested modal later (`nested`).
 */
function useLater(run: (() => void) | undefined) {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    if (!latest.current) return;
    const timer = setTimeout(() => latest.current?.(), 80);
    return () => clearTimeout(timer);
  }, []);
}

/** The rows of `items` and, for the open one, its modal. */
export function FieldRows({ items, ctx, sub, open: openProp, onOpen, title, nested, initialOpen }: FieldRowsProps) {
  const [own, setOwn] = useState<string | null>(null);
  useLater(initialOpen === undefined ? undefined : () => setOwn(initialOpen));
  const open = openProp === undefined ? own : openProp;
  const setOpen = onOpen ?? setOwn;
  return (
    <>
      {items.map((item) => (
        <FieldItemRow
          key={item.key}
          item={item}
          ctx={ctx}
          sub={sub}
          title={title}
          open={open === item.key}
          nested={open === item.key ? nested : undefined}
          onOpenChange={(next) => setOpen(next ? item.key : null)}
        />
      ))}
    </>
  );
}

/** *Required* when the field is empty and required, else what is wrong in a word. */
const problemOf = (error: string[] | undefined) =>
  error?.some((m) => m === 'Required' || /required/i.test(m)) ? 'Required' : 'Check this';

function FieldItemRow({
  item,
  ctx,
  sub,
  title,
  open,
  nested,
  onOpenChange,
}: {
  item: FieldItem;
  ctx: FieldContext;
  sub: string;
  title?: (ref: string) => string;
  open: boolean;
  nested?: string[];
  onOpenChange(open: boolean): void;
}) {
  const { field, value, error, changed } = item;
  const invalid = (error?.length ?? 0) > 0;
  const summary = fieldSummary(field, value, title);
  if (field.type === 'boolean') {
    // A Yes/No toggles in its row (FigCraft *Entry · Settings tab*): no modal.
    return (
      <FieldRow
        label={field.label}
        value={summary}
        required={field.required}
        changed={changed}
        invalid={invalid}
        problem={
          <>
            {problemOf(error)}
            {invalid ? <span className="sr-only">: {error!.join('; ')}</span> : null}
          </>
        }
        problemId={`${item.name}-problem`}
        data-field={item.name}
        trailing={
          <Switch
            id={item.name}
            checked={value === true}
            onCheckedChange={(on) => item.onChange(on)}
            aria-label={field.label}
            aria-describedby={invalid ? `${item.name}-problem` : undefined}
          />
        }
      />
    );
  }
  return (
    <>
      <FieldRow
        label={field.label}
        value={summary}
        required={field.required}
        changed={changed}
        invalid={invalid}
        problem={problemOf(error)}
        data-field={item.name}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(true)}
      />
      <FieldSheet
        item={item}
        ctx={ctx}
        sub={sub}
        title={title}
        open={open}
        nested={nested}
        onOpenChange={onOpenChange}
      />
    </>
  );
}

/** The modal's bar with its one CTA: Done closes it (what was typed is already in the form). */
function DoneBar({ onDone, form }: { onDone?: () => void; form?: string }) {
  return (
    <BottomBar>
      <Button variant="primary" size="lg" full type={form ? 'submit' : 'button'} form={form} onClick={onDone}>
        Done
      </Button>
    </BottomBar>
  );
}

/** The errors of a modal's field, as a list under its controls (the widgets in a modal show their own). */
function Problems({ name, error }: { name: string; error?: string[] }) {
  if (!error || error.length === 0) return null;
  return (
    <p
      id={`${name}-error`}
      className="m-0 flex items-center gap-1.5 px-1 text-sm font-medium text-tint-danger-foreground"
      role="alert"
    >
      <Icon name="alert" size={16} className="shrink-0 text-destructive" />
      {error.join('; ')}
    </p>
  );
}

type SheetProps = {
  item: FieldItem;
  ctx: FieldContext;
  sub: string;
  title?: (ref: string) => string;
  open: boolean;
  /** The modals under this one (`FieldRowsProps.nested`). */
  nested?: string[];
  onOpenChange(open: boolean): void;
};

/** One field's modal: the editor for its type. */
function FieldSheet(props: SheetProps) {
  const { item, ctx, sub, open, onOpenChange } = props;
  const { field } = item;
  const close = () => onOpenChange(false);
  const formId = useId();
  switch (field.type) {
    case 'select':
      if (!field.multiple) return <SelectSheet {...props} />;
      break;
    case 'reference':
      return field.multiple ? <TagsSheet {...props} /> : <ReferenceSheet {...props} />;
    case 'datetime':
      return <DateSheet {...props} />;
    case 'markdown':
      return <BodySheet {...props} />;
    case 'object':
      return field.list ? <ItemsSheet {...props} /> : <ObjectSheet {...props} />;
    case 'blocks':
      return <ItemsSheet {...props} />;
  }
  // A text, a number, a colour, JSON, a URL, a list of strings, an image, a multiple select: its widget, the label in
  // the title. Enter in a one-line field is Done.
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={field.label} sub={sub} bar={<DoneBar form={formId} />}>
      <form
        id={formId}
        // Done always closes: the entry's own validation marks a value out of range, not the browser's (a number
        // over its `max` would otherwise block the submit with a native bubble).
        noValidate
        className="flex flex-col gap-2 px-4 pt-2 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <FieldInSheet.Provider value>
          <FieldWidget
            name={item.name}
            field={field}
            value={item.value}
            onChange={item.onChange}
            error={item.error}
            ctx={ctx}
          />
        </FieldInSheet.Provider>
      </form>
    </Sheet>
  );
}

const RADIO_KEYS: Record<string, (i: number, n: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * A list of options in a modal is one tab stop (the chosen option, else the first): the arrow keys, Home and End move
 * the focus, Space or Enter chooses. Choosing closes the modal, so the focus moving does not choose (unlike a plain radio
 * group, where it would close the modal on the first arrow press).
 */
export function moveAmongRadios(e: KeyboardEvent<HTMLElement>) {
  const step = RADIO_KEYS[e.key];
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  if (radios.length === 0) return;
  e.preventDefault();
  radios[step(Math.max(0, radios.indexOf(document.activeElement as HTMLElement)), radios.length)]?.focus();
}

/** The option's tab stop: the chosen one, else the first. */
export const radioTab = (selected: boolean, first: boolean, any: boolean) => (selected || (!any && first) ? 0 : -1);

/** A single choice (FigCraft *Edit · Category*): a tap chooses and closes. No CTA. */
function SelectSheet({ item, sub, open, onOpenChange }: SheetProps) {
  const { field } = item;
  if (field.type !== 'select') return null;
  const value = asString(item.value);
  const options = [...field.options];
  if (value !== '' && !options.some((o) => o.value === value)) options.unshift({ value, label: value });
  const choose = (next: string) => {
    item.onChange(next);
    onOpenChange(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={field.label} sub={sub}>
      <div className="flex flex-col gap-2 px-4 pt-1 pb-8">
        <Card role="radiogroup" aria-label={field.label} id={item.name} onKeyDown={moveAmongRadios}>
          {options.map((o, i) => (
            <Option
              key={o.value}
              title={o.label}
              selected={o.value === value}
              tabIndex={radioTab(o.value === value, i === 0, value !== '' || !field.required)}
              onClick={() => choose(o.value)}
            />
          ))}
          {field.required ? null : (
            <Option title="None" selected={value === ''} tabIndex={value === '' ? 0 : -1} onClick={() => choose('')} />
          )}
        </Card>
        <Problems name={item.name} error={item.error} />
      </div>
    </Sheet>
  );
}

const entryLabel = (field: Field) => (field.type === 'reference' ? field.label.toLowerCase() : 'entries');

/**
 * A reference to one entry (FigCraft *Edit · Author*): search, then a tap chooses and closes. The chosen entry can be
 * opened; a reference to an entry that is not there says so, and can be cleared.
 */
function ReferenceSheet({ item, ctx, sub, open, onOpenChange }: SheetProps) {
  const { field } = item;
  const [query, setQuery] = useState('');
  const [onTop, setOnTop] = useState(false);
  if (field.type !== 'reference') return null;
  const value = asString(item.value);
  const entries = ctx.entries(field.collections);
  const chosen = entries.find((e) => e.ref === value);
  const missing = value !== '' && chosen === undefined && !ctx.entriesPending;
  const shown = entries.filter(matches(query));
  const choose = (next: string) => {
    item.onChange(next);
    onOpenChange(false);
  };
  const { EntryLink, EntrySheet } = ctx;
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={field.label} sub={sub}>
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        <EntrySearch label={`Search ${entryLabel(field)}`} value={query} onChange={setQuery} />
        {missing ? (
          <Card>
            {/* No second line: muted text is under 4.5 : 1 on the danger tint, and the title says it all. */}
            <SelectedRow title={`Not found: ${value}`} missing onRemove={() => choose('')} />
          </Card>
        ) : null}
        <Card role="radiogroup" aria-label={field.label} id={item.name} onKeyDown={moveAmongRadios}>
          {shown.map((e, i) => (
            <Option
              key={e.ref}
              title={e.title}
              sub={e.ref}
              selected={e.ref === value}
              tabIndex={radioTab(
                e.ref === value,
                i === 0,
                shown.some((x) => x.ref === value),
              )}
              onClick={() => choose(e.ref)}
            />
          ))}
          {shown.length === 0 ? <p className="m-0 p-4 text-base text-muted-foreground">No entries match</p> : null}
        </Card>
        {chosen && EntrySheet && ctx.selfRef !== chosen.ref ? (
          // The chosen entry edited on top of this picker (one entry on top; the entry's own fields only).
          <Button variant="secondary" full aria-haspopup="dialog" onClick={() => setOnTop(true)}>
            <Icon name="pencil" size={20} />
            Edit {chosen.title}
          </Button>
        ) : chosen && EntryLink ? (
          <EntryLink
            to={chosen.ref}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-full text-base font-medium text-foreground underline-offset-2 hovered:underline"
          >
            Open {chosen.title}
            <Icon name="chevron-right" size={16} />
          </EntryLink>
        ) : null}
        {value !== '' && !field.required ? (
          <Button variant="ghost" full onClick={() => choose('')}>
            Clear {field.label}
          </Button>
        ) : null}
        <Problems name={item.name} error={item.error} />
        {EntrySheet && chosen ? <EntrySheet entryRef={chosen.ref} open={onTop} onOpenChange={setOnTop} /> : null}
      </div>
    </Sheet>
  );
}

/**
 * A reference to several entries (FigCraft *Edit · Tags*, *Tags · add*): the chosen ones as rows with a remove button,
 * then *Add*, which opens a second modal: search and pick several, the CTA counts them.
 */
function TagsSheet({ item, ctx, sub, open, nested, onOpenChange }: SheetProps) {
  const { field } = item;
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  // The chosen entry edited on top of this list (a chosen title is a button, not a link).
  const [onTop, setOnTop] = useState<string | null>(null);
  useLater(
    nested?.[0] === 'add'
      ? () => {
          setPicked(nested.slice(1));
          setAdding(true);
        }
      : undefined,
  );
  if (field.type !== 'reference') return null;
  const value = asStringList(item.value);
  const entries = ctx.entries(field.collections);
  const titles = new Map(entries.map((e) => [e.ref, e.title]));
  const full = field.max !== undefined && value.length >= field.max;
  const available = entries.filter((e) => !value.includes(e.ref)).filter(matches(query));
  const { EntryLink, EntrySheet } = ctx;
  const add = () => {
    item.onChange([...value, ...picked]);
    setPicked([]);
    setQuery('');
    setAdding(false);
  };
  const noun = field.label.toLowerCase();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={field.label}
      sub={sub}
      bar={<DoneBar onDone={() => onOpenChange(false)} />}
    >
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        <Card as="ul" aria-label={`${field.label} selected`} id={item.name}>
          {value.map((ref, i) => {
            const name = titles.get(ref);
            const missing = name === undefined && !ctx.entriesPending;
            return (
              // oxlint-disable-next-line no-array-index-key -- a hand-written list may repeat a reference (validation reports it)
              <li key={i}>
                <SelectedRow
                  title={
                    name !== undefined && EntrySheet && ctx.selfRef !== ref ? (
                      <button
                        type="button"
                        aria-haspopup="dialog"
                        className="cursor-pointer border-0 bg-transparent p-0 text-left font-sans text-base text-foreground hovered:underline"
                        onClick={() => setOnTop(ref)}
                      >
                        {name}
                      </button>
                    ) : name !== undefined && EntryLink ? (
                      <EntryLink to={ref} className="text-foreground no-underline hovered:underline">
                        {name}
                      </EntryLink>
                    ) : missing ? (
                      `Not found: ${ref}`
                    ) : (
                      (name ?? ref)
                    )
                  }
                  sub={missing ? undefined : ref}
                  missing={missing}
                  itemName={name ?? ref}
                  onRemove={() => item.onChange(value.filter((_, j) => j !== i))}
                />
              </li>
            );
          })}
          <li>
            <Row
              lead="plus"
              title={full ? 'Maximum reached' : `Add ${noun}`}
              chevron={false}
              disabled={full}
              onClick={() => setAdding(true)}
            />
          </li>
        </Card>
        <Problems name={item.name} error={item.error} />
        {EntrySheet && onTop !== null ? (
          <EntrySheet entryRef={onTop} open onOpenChange={(next) => (next ? undefined : setOnTop(null))} />
        ) : null}
      </div>
      <Sheet
        open={adding}
        onOpenChange={setAdding}
        title={`Add ${noun}`}
        sub={field.label}
        bar={
          <BottomBar>
            <Button variant="primary" size="lg" full disabled={picked.length === 0} onClick={add}>
              {picked.length === 0
                ? `Add ${noun}`
                : `Add ${picked.length} ${picked.length === 1 ? 'entry' : 'entries'}`}
            </Button>
          </BottomBar>
        }
      >
        <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
          <EntrySearch label={`Search ${noun}`} value={query} onChange={setQuery} />
          <Card as="fieldset" aria-label={`${field.label} to add`}>
            {available.map((e) => (
              <Option
                key={e.ref}
                multi
                title={e.title}
                sub={e.ref}
                selected={picked.includes(e.ref)}
                disabled={
                  !picked.includes(e.ref) && field.max !== undefined && value.length + picked.length >= field.max
                }
                onClick={() => setPicked((p) => (p.includes(e.ref) ? p.filter((x) => x !== e.ref) : [...p, e.ref]))}
              />
            ))}
            {available.length === 0 ? (
              <p className="m-0 p-4 text-base text-muted-foreground">No entries to add</p>
            ) : null}
          </Card>
        </div>
      </Sheet>
    </Sheet>
  );
}

/**
 * A date (FigCraft *Edit · Published*): the Calendar; a date and time adds the time wheels. The stored day is read and
 * written from its local parts (docs/admin/ui.md, the date field's contract). *Clear time* on a date and time sets it
 * to midnight (a date and time is stored with a time); *Clear* empties a field that is not required.
 */
function DateSheet({ item, sub, open, nested, onOpenChange }: SheetProps) {
  const { field } = item;
  if (field.type !== 'datetime') return null;
  const dateOnly = field.dateOnly === true;
  const value = asString(item.value);
  const date = parseStored(value, dateOnly);
  const time = { hours: date?.getHours() ?? 9, minutes: date?.getMinutes() ?? 0 };
  const choose = (day: Date) => item.onChange(dateOnly ? storeDay(day) : storeMoment(day, time.hours, time.minutes));
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={field.label}
      sub={sub}
      bar={<DoneBar onDone={() => onOpenChange(false)} />}
    >
      <div className="flex flex-col gap-4 px-4 pt-1 pb-6">
        <p className="sr-only" aria-live="polite">
          {value ? `${field.label}: ${formatStored(value, dateOnly)}` : `${field.label}: no date`}
        </p>
        <Calendar
          id={item.name}
          aria-label={field.label}
          value={date}
          onChange={choose}
          defaultView={nested?.[0] === 'months' || nested?.[0] === 'years' ? nested[0] : undefined}
        />
        {dateOnly ? null : (
          <TimeWheel
            hours={time.hours}
            minutes={time.minutes}
            onChange={({ hours, minutes }) => item.onChange(storeMoment(date ?? new Date(), hours, minutes))}
            onClear={date ? () => item.onChange(storeMoment(date, 0, 0)) : undefined}
          />
        )}
        {value !== '' && !field.required ? (
          <Button variant="ghost" full onClick={() => item.onChange('')}>
            Clear {field.label}
          </Button>
        ) : null}
        <Problems name={item.name} error={item.error} />
      </div>
    </Sheet>
  );
}

/**
 * The body (FigCraft *Edit · Body*): rich text gets the whole admin, with the close ×, the text, Done, and the
 * formatting bar at the bottom, above the keyboard (the bar rides on `--keyboard`, like the BottomBar).
 */
function BodySheet({ item, ctx, sub, open, onOpenChange }: SheetProps) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <Sheet
      full
      open={open}
      onOpenChange={onOpenChange}
      title={item.field.label}
      sub={sub}
      bar={
        <>
          <BottomBar className="mb-0 shadow-none">
            <Button variant="primary" size="lg" full onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </BottomBar>
          <div ref={setSlot} data-slot="toolbar-slot" className="bg-background pb-safe mb-keyboard" />
        </>
      }
    >
      <div className="px-4 pt-2 pb-4">
        <ToolbarSlot.Provider value={slot}>
          <FieldInSheet.Provider value>
            <FieldWidget
              name={item.name}
              field={item.field}
              value={item.value}
              onChange={item.onChange}
              error={item.error}
              ctx={ctx}
            />
          </FieldInSheet.Provider>
        </ToolbarSlot.Provider>
      </div>
    </Sheet>
  );
}

type Item = Record<string, unknown>;
const asItem = (v: unknown): Item => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Item) : {});

/** The fields of one object value as `FieldItem`s, named `<name>.<key>`. */
function nestedItems(
  name: string,
  fields: Record<string, Field>,
  value: Item,
  onChange: (v: Item) => void,
  error?: string[],
) {
  const errors = splitErrors(error);
  return Object.entries(fields).map(([key, field]): FieldItem => ({
    key,
    name: `${name}.${key}`,
    field,
    value: value[key],
    onChange: (v) => onChange({ ...value, [key]: v }),
    error: errors[key],
  }));
}

/** Nested widgets get no select-to-edit target: only the body takes part in it. */
const nestedCtx = (ctx: FieldContext): FieldContext => ({ ...ctx, selectTarget: undefined, EntrySheet: undefined });

/** An object (FigCraft *Edit · Scale*): its fields as rows; each opens one level down (*Edit · Labels*). */
function ObjectSheet({ item, ctx, sub, title, open, nested, onOpenChange }: SheetProps) {
  const { field } = item;
  if (field.type !== 'object') return null;
  const value = asItem(item.value);
  const errors = splitErrors(item.error);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={field.label}
      sub={sub}
      bar={<DoneBar onDone={() => onOpenChange(false)} />}
    >
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        <Card as="fieldset" aria-label={field.label} id={item.name}>
          <FieldRows
            items={nestedItems(item.name, field.fields, value, item.onChange, item.error)}
            ctx={nestedCtx(ctx)}
            sub={field.label}
            title={title}
            initialOpen={nested?.[0]}
            nested={nested?.slice(1)}
          />
        </Card>
        <Problems name={item.name} error={errors['']} />
      </div>
    </Sheet>
  );
}

/**
 * A list of objects or the blocks (FigCraft *Edit · Blocks*): the items as rows, dragged or moved with the arrow keys
 * by their grip, a tap opens one (*Block · Quote*: its fields as rows, and Remove); the CTA adds one (blocks: pick the
 * kind first, *Add block*).
 */
function ItemsSheet({ item, ctx, sub, title, open, nested, onOpenChange }: SheetProps) {
  const { field } = item;
  const [opened, setOpened] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  useLater(
    nested?.[0] === undefined
      ? undefined
      : () => (nested[0] === 'add' ? setPicking(true) : setOpened(Number(nested[0]))),
  );
  if (field.type !== 'object' && field.type !== 'blocks') return null;
  const value = Array.isArray(item.value) ? item.value : [];
  const errors = splitErrors(item.error);
  const blocks = field.type === 'blocks';
  const kindOf = (raw: unknown): BlockDef | undefined => {
    if (field.type === 'object') return { label: 'Item', fields: field.fields };
    const kind = asItem(raw)[BLOCK_KEY];
    return typeof kind === 'string' && Object.hasOwn(field.blocks, kind) ? field.blocks[kind] : undefined;
  };
  const full = field.max !== undefined && value.length >= field.max;
  const noun = blocks ? 'block' : 'item';
  const move = (from: number, delta: -1 | 1) => {
    const to = from + delta;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    item.onChange(next);
  };
  const append = (kind?: string) => {
    item.onChange([...value, newItem(field, kind)]);
    setPicking(false);
  };
  const shown = opened !== null && opened < value.length ? opened : null;
  const openKind = shown === null ? undefined : kindOf(value[shown]);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={field.label}
      sub={sub}
      bar={
        <BottomBar>
          <Button
            variant="primary"
            size="lg"
            full
            icon={<Icon name="plus" size={20} />}
            disabled={full}
            onClick={() => (blocks ? setPicking(true) : append())}
          >
            {blocks ? 'Add block' : `Add ${field.label.toLowerCase()} item`}
          </Button>
        </BottomBar>
      }
    >
      <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
        {value.length > 0 ? (
          <Card>
            <BlockList aria-label={`${field.label} items`} id={item.name}>
              {value.map((raw, i) => {
                const it = asItem(raw);
                const kind = kindOf(raw);
                const label = kind?.label ?? `Unknown ${String(it[BLOCK_KEY] ?? 'item')}`;
                const key = typeof it[ITEM_KEY] === 'string' ? (it[ITEM_KEY] as string) : `at-${i}`;
                const invalid = (errors[String(i)]?.length ?? 0) > 0;
                return (
                  <BlockRow
                    key={key}
                    title={label}
                    sub={(kind ? itemTitle(kind.fields, it) : undefined) ?? (invalid ? 'Check this' : undefined)}
                    position={i + 1}
                    total={value.length}
                    onMove={(delta) => move(i, delta)}
                    onOpen={() => setOpened(i)}
                    aria-label={`${i + 1}. ${label}`}
                    className={invalid ? 'bg-tint-danger' : undefined}
                  />
                );
              })}
            </BlockList>
          </Card>
        ) : (
          <p className="m-0 px-1 text-base text-tray-muted-foreground">No {noun}s yet</p>
        )}
        <Problems name={item.name} error={errors['']} />
      </div>
      {/* The open item, one level down: its fields as rows, and Remove. */}
      <Sheet
        open={shown !== null}
        onOpenChange={(next) => (next ? undefined : setOpened(null))}
        title={openKind?.label ?? `Unknown ${noun}`}
        sub={shown === null ? undefined : `${blocks ? 'Block' : 'Item'} ${shown + 1} of ${value.length}`}
        bar={<DoneBar onDone={() => setOpened(null)} />}
      >
        {shown !== null ? (
          <div className="flex flex-col gap-3 px-4 pt-1 pb-8">
            {openKind ? (
              <Card as="fieldset" aria-label={openKind.label}>
                <FieldRows
                  items={nestedItems(
                    `${item.name}.${shown}`,
                    openKind.fields,
                    asItem(value[shown]),
                    (v) => item.onChange(value.map((x, j) => (j === shown ? v : x))),
                    errors[String(shown)],
                  )}
                  ctx={nestedCtx(ctx)}
                  sub={openKind.label}
                  title={title}
                />
              </Card>
            ) : null}
            <Problems name={`${item.name}.${shown}`} error={splitErrors(errors[String(shown)])['']} />
            <Card>
              <ActionRow
                icon="trash"
                danger
                onClick={() => {
                  item.onChange(value.filter((_, j) => j !== shown));
                  setOpened(null);
                }}
              >
                Remove {noun}
              </ActionRow>
            </Card>
          </div>
        ) : null}
      </Sheet>
      {blocks ? (
        <Sheet open={picking} onOpenChange={setPicking} title="Add block" sub={field.label}>
          <div className="px-4 pt-1 pb-8">
            <Card as="fieldset" aria-label={`${field.label}: block kinds`}>
              {Object.entries(field.blocks).map(([kind, block]) => (
                <Row key={kind} title={block.label} chevron={false} data-block={kind} onClick={() => append(kind)} />
              ))}
            </Card>
          </div>
        </Sheet>
      ) : null}
    </Sheet>
  );
}
