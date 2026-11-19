import { cva } from 'class-variance-authority';
import {
  type ComponentProps,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { cn } from '../cn';
import { Button } from '../primitives/button';
import { Icon } from '../primitives/icon';
import { IconButton } from '../primitives/icon-button';

/**
 * The date picker (FigCraft `Calendar`, `Day/<state>`, `PickerHead/<days|months|years>`, `PickerTile/<109|80>/<state>`,
 * proposal §14.9; docs/admin/ui.md). Three views in one part: the days of a month (44 px round days), the 12 months of a
 * year and 12 years (rounded tiles). The title opens the next level up, a tile goes back down, the arrows page. The
 * grids follow the APG date picker: one tab stop, arrows, Home/End, PageUp/PageDown (Shift: a year). Dates are local
 * calendar days (`Date` at midnight); `TimeWheel` adds hours and minutes for a date-time field.
 */

type Info = { firstDay?: number };

/**
 * The first day of the week for a locale, 0 (Sunday) to 6, from `Intl.Locale#getWeekInfo` (or the older `weekInfo`
 * getter of Chrome 99–129). Firefox 128 has neither: Monday, the ISO week.
 */
export function weekStart(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? navigator.language) as Intl.Locale & {
      getWeekInfo?: () => Info;
      weekInfo?: Info;
    };
    const first = (typeof loc.getWeekInfo === 'function' ? loc.getWeekInfo() : loc.weekInfo)?.firstDay;
    if (first) return first % 7;
  } catch {
    // An unknown locale tag: the fallback.
  }
  return 1;
}

/** A local calendar day; years 0–99 stay themselves (`new Date(y, …)` would read them as 1900–1999). */
const ymd = (year: number, month: number, day: number) => {
  const d = new Date(2000, 0, 1);
  d.setFullYear(year, month, day);
  return d;
};
const daysIn = (year: number, month: number) => ymd(year, month + 1, 0).getDate();
const addDays = (d: Date, n: number) => ymd(d.getFullYear(), d.getMonth(), d.getDate() + n);
/** The month `n` months on, on day `day` or the month's last day (31 Jan + 1 month = 28 or 29 Feb). */
const atMonth = (d: Date, n: number, day = d.getDate()) => {
  const first = ymd(d.getFullYear(), d.getMonth() + n, 1);
  return ymd(first.getFullYear(), first.getMonth(), Math.min(day, daysIn(first.getFullYear(), first.getMonth())));
};
/** The same day `n` months on, clamped to the month's last day (31 Jan + 1 month = 28 or 29 Feb). */
export const addMonths = (d: Date, n: number): Date => atMonth(d, n);
const sameDay = (a: Date | undefined, b: Date) =>
  !!a && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayOnly = (d: Date) => ymd(d.getFullYear(), d.getMonth(), d.getDate());
/** A usable date: an Invalid Date (`new Date('')`) counts as none. */
const valid = (d: Date | undefined): d is Date => !!d && !Number.isNaN(d.getTime());

/** The 42 days shown for a month: six weeks from the week start before its first day. */
export function monthDays(year: number, month: number, start: number): Date[] {
  const first = ymd(year, month, 1);
  const from = addDays(first, -((first.getDay() - start + 7) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(from, i));
}

/**
 * A day or a tile of the picker. Hover is the 7 % ink fill, pressed 12 %, keyboard focus a 2 px ring inside, today (a
 * tile: the current month or year) the soft fill and semibold, the chosen one ink; out of range and other months 40 %.
 * In forced colours the chosen one keeps an outline inside.
 */
export const pickerCellVariants = cva(
  [
    'box-border inline-flex shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 align-top',
    'font-sans text-base font-normal text-foreground outline-none select-none',
    'hovered:bg-accent pressed:bg-muted-active focused:inset-ring-2 focused:inset-ring-foreground',
    'focused:outline-2 focused:outline-transparent',
    'data-today:bg-muted data-today:font-semibold',
    'data-selected:bg-gradient-ink data-selected:font-medium data-selected:text-on-ink data-selected:shadow-ink-small',
    'data-selected:outline-2 data-selected:-outline-offset-2 data-selected:outline-transparent',
    'aria-disabled:cursor-default aria-disabled:opacity-40 data-outside:cursor-default data-outside:opacity-40',
  ],
  {
    variants: { shape: { day: 'size-11 rounded-full', 109: 'h-11 w-27.25 rounded-xl', 80: 'h-11 w-20 rounded-xl' } },
    defaultVariants: { shape: 'day' },
  },
);

export interface PickerCellProps extends Omit<ComponentProps<'button'>, 'disabled'> {
  /** `day` (44 px round, `Day/`), or a month (109) or year (80) tile (`PickerTile/`). */
  shape?: 'day' | 109 | 80;
  /** Today; for a tile, the current month or year (`current`). */
  today?: boolean;
  selected?: boolean;
  /** Out of range: still focusable (the grid's keys pass over it), not chosen. */
  disabled?: boolean;
  /** A day of another month: drawn at 40 %, not a control (the keys reach it through its own month). */
  outside?: boolean;
}

/** `Day/<state>` and `PickerTile/<109|80>/<state>`. */
export function PickerCell({
  shape,
  today,
  selected,
  disabled,
  outside,
  className,
  onClick,
  ...props
}: PickerCellProps) {
  const cls = cn(pickerCellVariants({ shape }), className);
  if (outside)
    return (
      <span
        {...(props as ComponentProps<'span'>)}
        data-slot="picker-cell"
        data-outside=""
        aria-hidden="true"
        tabIndex={undefined}
        className={cls}
      />
    );
  return (
    <button
      type="button"
      data-slot="picker-cell"
      data-today={today ? '' : undefined}
      data-selected={selected ? '' : undefined}
      aria-disabled={disabled || undefined}
      aria-current={today ? (shape === 'day' || shape === undefined ? 'date' : 'true') : undefined}
      className={cls}
      onClick={disabled ? undefined : onClick}
      {...props}
    />
  );
}

export type PickerView = 'days' | 'months' | 'years';

export interface PickerHeadProps extends Omit<ComponentProps<'div'>, 'title'> {
  view: PickerView;
  title: string;
  onTitle?: () => void;
  onPrevious: () => void;
  onNext: () => void;
  /** Forces a state on the title button (the /design boards). */
  'data-state'?: string;
}

const PAGE_LABELS: Record<PickerView, [string, string]> = {
  days: ['Previous month', 'Next month'],
  months: ['Previous year', 'Next year'],
  years: ['Earlier years', 'Later years'],
};

/**
 * `PickerHead/<view>`: previous, the title, next. The title of the days opens the months and the months' title (the
 * year) opens the years, as a 44 px ghost button with a chevron; the years' title is only text.
 */
export function PickerHead({
  view,
  title,
  onTitle,
  onPrevious,
  onNext,
  className,
  'data-state': titleState,
  ...props
}: PickerHeadProps) {
  const [previous, next] = PAGE_LABELS[view];
  return (
    <div data-slot="picker-head" className={cn('flex w-full items-center', className)} {...props}>
      <IconButton icon={<Icon name="chevron-left" />} label={previous} onClick={onPrevious} />
      <span className="flex-1" />
      {view === 'years' ? (
        <span className="inline-flex h-11 items-center px-5 text-base font-medium text-foreground">{title}</span>
      ) : (
        <Button
          variant="ghost"
          iconRight={<Icon name="chevron-down" />}
          onClick={onTitle}
          data-state={titleState}
          aria-label={`${title}, ${view === 'days' ? 'choose a month' : 'choose a year'}`}
        >
          {title}
        </Button>
      )}
      <span className="flex-1" />
      <IconButton icon={<Icon name="chevron-right" />} label={next} onClick={onNext} />
    </div>
  );
}

/**
 * How many cells a key moves the focus in a grid of `cols` columns (`page` for PageUp/PageDown), or null for another key
 * or one held with Alt, Ctrl or Meta.
 */
function step(e: KeyboardEvent, cols: number, index: number, page: number): number | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null; // the browser's and the system's shortcuts
  switch (e.key) {
    case 'ArrowLeft':
      return -1;
    case 'ArrowRight':
      return 1;
    case 'ArrowUp':
      return -cols;
    case 'ArrowDown':
      return cols;
    case 'Home':
      return -(index % cols);
    case 'End':
      return cols - 1 - (index % cols);
    case 'PageUp':
      return -page;
    case 'PageDown':
      return page;
    default:
      return null;
  }
}

export interface CalendarProps extends Omit<ComponentProps<'div'>, 'onChange' | 'defaultValue'> {
  /** The chosen day. */
  value?: Date;
  onChange?: (day: Date) => void;
  /** The first and last days that can be chosen; the others are drawn at 40 %. */
  min?: Date;
  max?: Date;
  /** For the names and the week start; the browser's language by default. */
  locale?: string;
  /** Today (the soft day); the real today by default. */
  today?: Date;
  /** The view it opens on (`days`); /design shows *Edit · Published · months* and *· years* with it. */
  defaultView?: PickerView;
}

/** The first year of a page of 12 years, so `year` sits in its middle row (2026 → 2020–2031, as the design draws). */
const pageOf = (year: number) => year - 6;

export function Calendar({
  value: valueProp,
  onChange,
  min: minProp,
  max: maxProp,
  locale,
  today: todayProp,
  defaultView = 'days',
  className,
  ...props
}: CalendarProps) {
  const value = valid(valueProp) ? dayOnly(valueProp) : undefined;
  const min = valid(minProp) ? dayOnly(minProp) : undefined;
  const max = valid(maxProp) ? dayOnly(maxProp) : undefined;
  const today = dayOnly(valid(todayProp) ? todayProp : new Date());
  const [view, setView] = useState<PickerView>(defaultView);
  // The focused day; its month is the one shown, its year the months' year.
  const [focus, setFocus] = useState(() => value ?? today);
  // The day of the month the editor is on: paging months keeps it (31 Jan → Feb 28 → 31 Mar).
  const [anchor, setAnchor] = useState(() => focus.getDate());
  const [yearsFrom, setYearsFrom] = useState(() => pageOf(focus.getFullYear()));
  // A new value from outside (a typed date, a reopened picker) moves the focus to it.
  const [shown, setShown] = useState(value?.getTime());
  if (shown !== value?.getTime()) {
    setShown(value?.getTime());
    if (value) {
      setFocus(value);
      setAnchor(value.getDate());
      if (value.getFullYear() < yearsFrom || value.getFullYear() >= yearsFrom + 12)
        setYearsFrom(pageOf(value.getFullYear()));
    }
  }
  const titleId = useId();
  const grid = useRef<HTMLTableElement>(null);
  const moved = useRef(false);

  // After a key or a change of view, the focus follows the cell that now holds the tab stop.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  });

  // Moves the focused day (and the view); `follow` moves the DOM focus with it (keys, drills; not the arrows). The
  // years page follows the focused year, so the tab stop is always on the page.
  const go = (next: Date, nextView = view, follow = true) => {
    const y = next.getFullYear();
    if (y < yearsFrom || y >= yearsFrom + 12) setYearsFrom(yearsFrom + Math.floor((y - yearsFrom) / 12) * 12);
    moved.current = follow;
    setFocus(next);
    setView(nextView);
  };
  /** A move by days sets the anchor; one by months keeps it. */
  const goDay = (next: Date) => {
    setAnchor(next.getDate());
    go(next);
  };
  const byMonths = (n: number) => atMonth(focus, n, anchor);

  const start = weekStart(locale);
  const year = focus.getFullYear();
  const month = focus.getMonth();
  const out = (from: Date, to: Date) => (min ? to < min : false) || (max ? from > max : false);

  let title: string;
  let head: ReactNode;
  let body: ReactNode;
  if (view === 'days') {
    const long = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const weekday = (format: 'narrow' | 'long', i: number) =>
      new Intl.DateTimeFormat(locale, { weekday: format }).format(new Date(2026, 0, 4 + ((start + i) % 7)));
    const days = monthDays(year, month, start);
    title = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(focus);
    head = (
      <PickerHead
        view="days"
        title={title}
        onTitle={() => go(focus, 'months')}
        onPrevious={() => go(byMonths(-1), 'days', false)}
        onNext={() => go(byMonths(1), 'days', false)}
      />
    );
    body = (
      // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the days take the focus (one tab stop, APG grid)
      <table
        ref={grid}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- the APG date picker grid
        role="grid"
        aria-labelledby={titleId}
        className="w-full table-fixed border-collapse"
        onKeyDown={(e) => {
          const index = (focus.getDay() - start + 7) % 7;
          const by = step(e, 7, index, 0);
          if (by === null) return;
          e.preventDefault();
          if (e.key === 'PageUp' || e.key === 'PageDown')
            go(byMonths((e.key === 'PageUp' ? -1 : 1) * (e.shiftKey ? 12 : 1)));
          else goDay(addDays(focus, by));
        }}
      >
        <thead>
          <tr>
            {Array.from({ length: 7 }, (_, i) => (
              <th
                key={i}
                scope="col"
                aria-label={weekday('long', i)}
                className="p-0 text-center text-xs font-medium text-muted-foreground"
              >
                {weekday('narrow', i)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 6 }, (_, w) => (
            <tr key={w}>
              {days.slice(w * 7, w * 7 + 7).map((day) => {
                const selected = sameDay(value, day);
                const disabled = out(day, day);
                return (
                  <td
                    key={day.getTime()}
                    // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- explicit: aria-query (jsdom) reads a td in a grid as a cell
                    role="gridcell"
                    aria-selected={selected}
                    aria-disabled={disabled || undefined}
                    className="p-0 text-center"
                  >
                    <PickerCell
                      outside={day.getMonth() !== month}
                      today={sameDay(today, day)}
                      selected={selected}
                      disabled={disabled}
                      tabIndex={sameDay(focus, day) ? 0 : -1}
                      aria-label={long.format(day)}
                      onClick={() => {
                        setFocus(day);
                        setAnchor(day.getDate());
                        onChange?.(day);
                      }}
                    >
                      {day.getDate()}
                    </PickerCell>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    );
  } else {
    const months = view === 'months';
    const cols = months ? 3 : 4;
    const index = months ? month : year - yearsFrom;
    const tiles = Array.from({ length: 12 }, (_, i) => {
      const y = months ? year : yearsFrom + i;
      const from = months ? ymd(y, i, 1) : ymd(y, 0, 1);
      const to = months ? ymd(y, i + 1, 0) : ymd(y, 11, 31);
      const label = months ? new Intl.DateTimeFormat(locale, { month: 'short' }).format(from) : String(y);
      const selected = !!value && value.getFullYear() === y && (!months || value.getMonth() === i);
      const current = today.getFullYear() === y && (!months || today.getMonth() === i);
      const disabled = out(from, to);
      const pick = () =>
        months ? go(atMonth(ymd(y, i, 1), 0, anchor), 'days') : go(atMonth(ymd(y, month, 1), 0, anchor), 'months');
      return (
        <td
          key={i}
          // oxlint-disable-next-line jsx-a11y/no-redundant-roles -- explicit: aria-query (jsdom) reads a td in a grid as a cell
          role="gridcell"
          aria-selected={selected}
          aria-disabled={disabled || undefined}
          className={cn('p-0 text-center', i >= cols && 'pt-2')}
        >
          <PickerCell
            shape={months ? 109 : 80}
            today={current}
            selected={selected}
            disabled={disabled}
            tabIndex={i === index ? 0 : -1}
            // The tile's own word, then the year (WCAG 2.5.3: the name starts with what the tile shows, "Feb 2026").
            aria-label={months ? `${label} ${y}` : label}
            onClick={pick}
          >
            {label}
          </PickerCell>
        </td>
      );
    });
    title = months ? String(year) : `${yearsFrom} – ${yearsFrom + 11}`;
    head = months ? (
      <PickerHead
        view="months"
        title={title}
        onTitle={() => {
          moved.current = true;
          setYearsFrom(pageOf(year));
          setView('years');
        }}
        onPrevious={() => go(byMonths(-12), 'months', false)}
        onNext={() => go(byMonths(12), 'months', false)}
      />
    ) : (
      // The arrows move the focused year by a page, so a tile of the new page holds the tab stop.
      <PickerHead
        view="years"
        title={title}
        onPrevious={() => go(byMonths(-144), 'years', false)}
        onNext={() => go(byMonths(144), 'years', false)}
      />
    );
    body = (
      // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the tiles take the focus (one tab stop, APG grid)
      <table
        ref={grid}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- the APG date picker grid
        role="grid"
        aria-labelledby={titleId}
        className="w-full table-fixed border-collapse"
        onKeyDown={(e) => {
          const by = step(e, cols, index, 12);
          if (by === null) return;
          e.preventDefault();
          go(byMonths(months ? by : by * 12));
        }}
      >
        <tbody>
          {Array.from({ length: 12 / cols }, (_, r) => (
            <tr key={r}>{tiles.slice(r * cols, r * cols + cols)}</tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div data-slot="calendar" className={cn('flex w-full flex-col', view !== 'days' && 'gap-2', className)} {...props}>
      {/* The grid's name, and a live region that stays mounted across the views, so each new title is announced. */}
      <span id={titleId} aria-live="polite" className="sr-only">
        {title}
      </span>
      {head}
      {body}
    </div>
  );
}

const STEP_PX = 48; // a cell (44) and the gap (4): a drag of one cell moves the wheel by one value

/** One column of the time wheel: a spin button over 0…`max`, five values visible, the chosen one in the middle. */
function Wheel({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  // The latest value and handler: several steps can land before the next render (a fast drag, a wheel flick).
  const latest = useRef({ value, onChange });
  useEffect(() => {
    latest.current = { value, onChange };
  });
  const size = max + 1;
  const set = (v: number) => {
    const next = ((v % size) + size) % size;
    latest.current.value = next;
    latest.current.onChange(next);
  };
  const move = (n: number) => set(latest.current.value + n);
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });

  // A wheel turn or a trackpad flick steps it; React's onWheel is passive, so the page would scroll too.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      if (Math.abs(acc) < STEP_PX / 2) return;
      moveRef.current(Math.sign(acc));
      acc = 0;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const keys: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
    if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(max);
    else if (e.key in keys) move(keys[e.key]!);
    else return;
    e.preventDefault();
  };
  const onPointerDown = (e: PointerEvent) => {
    drag.current = { y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const steps = Math.trunc((d.y - e.clientY) / STEP_PX);
    if (steps === 0) return;
    d.y -= steps * STEP_PX;
    // Captured only once it is a drag: a tap's pointerup must still land on the value it hit.
    if (!d.moved) e.currentTarget.setPointerCapture?.(e.pointerId);
    d.moved = true;
    move(steps);
  };
  // A tap (no drag) on a value chooses it.
  const onPointerUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const offset = (e.target as HTMLElement).closest<HTMLElement>('[data-offset]')?.dataset.offset;
    if (offset) move(Number(offset));
  };

  const pad = (n: number) => String(((n % size) + size) % size).padStart(2, '0');
  return (
    <div
      ref={ref}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a wheel of values to flick, not a text field (APG spinbutton)
      role="spinbutton"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={pad(value)}
      className="flex touch-none cursor-ns-resize flex-col gap-1 rounded-xl outline-none select-none focused:inset-ring-2 focused:inset-ring-foreground focused:outline-2 focused:outline-transparent"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    >
      {[-2, -1, 0, 1, 2].map((o) => (
        <span
          key={o}
          data-offset={o}
          aria-hidden="true"
          className={cn(
            'flex h-11 w-24 items-center justify-center rounded-xl',
            o === 0 ? 'bg-muted text-2xl font-semibold text-foreground' : 'text-lg text-muted-foreground',
          )}
        >
          {pad(value + o)}
        </span>
      ))}
    </div>
  );
}

export interface TimeWheelProps {
  hours: number;
  minutes: number;
  onChange: (time: { hours: number; minutes: number }) => void;
  /** Removes the time (a date and time field keeps the day); no button without it. */
  onClear?: () => void;
  className?: string;
}

/**
 * The time of a date and time field: an hours and a minutes wheel (24 hours), five values each, the chosen one in the
 * middle on the soft fill. Arrow up and down step (PageUp/PageDown by 10, Home/End to the ends), a drag or the wheel
 * flicks, a tap on a value chooses it. *Clear time* removes it.
 */
export function TimeWheel({ hours, minutes, onChange, onClear, className }: TimeWheelProps) {
  // Each wheel reads the other's latest value, not the one of the last render.
  const time = useRef({ hours, minutes });
  useEffect(() => {
    time.current = { hours, minutes };
  });
  const change = (part: Partial<{ hours: number; minutes: number }>) => {
    time.current = { ...time.current, ...part };
    onChange(time.current);
  };
  return (
    <div data-slot="time-wheel" className={cn('flex w-full flex-col gap-4 pt-2', className)}>
      <div className="flex items-center justify-center gap-3">
        <Wheel label="Hours" value={hours} max={23} onChange={(h) => change({ hours: h })} />
        <span aria-hidden="true" className="text-2xl font-semibold text-foreground">
          :
        </span>
        <Wheel label="Minutes" value={minutes} max={59} onChange={(m) => change({ minutes: m })} />
      </div>
      {onClear ? (
        <Button variant="ghost" full onClick={onClear}>
          Clear time
        </Button>
      ) : null}
    </div>
  );
}
