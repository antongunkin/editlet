// A `datetime` field's values (docs/admin/ui.md, the date field's contract): what a stored value means, how the row
// shows it, and what the Calendar and the time wheels store.

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T/;

const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: 'medium' };
const DATETIME_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** The moment a stored value means; a value without a zone is read in the editor's time zone. `undefined` if unreadable. */
export function parseStored(value: string, dateOnly: boolean): Date | undefined {
  if (dateOnly) {
    const m = DATE.exec(value);
    if (!m) return undefined;
    // `new Date(y, …)` reads the years 0–99 as 1900–1999 (and 1900 has no 29 February): set the whole date as it is.
    const date = new Date(2000, 0, 1);
    date.setFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return date.getMonth() === Number(m[2]) - 1 ? date : undefined;
  }
  if (!DATETIME.test(value)) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** What the field shows: the date in the editor's locale and time zone; a value that cannot be read stays as stored. */
export function formatStored(value: string, dateOnly: boolean): string {
  const date = parseStored(value, dateOnly);
  if (!date) return value;
  // Made each time, so the editor's time zone is read now (a formatter keeps the zone it was made in).
  return new Intl.DateTimeFormat(undefined, dateOnly ? DATE_FORMAT : DATETIME_FORMAT).format(date);
}

/** A calendar day as stored: `YYYY-MM-DD` from its local parts (never `toISOString()`, which may give the day before). */
export function storeDay(day: Date): string {
  return `${String(day.getFullYear()).padStart(4, '0')}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

/** A day and a time as stored: that local moment in UTC, `2026-01-15T09:00:00Z`. */
export function storeMoment(day: Date, hours: number, minutes: number): string {
  const at = new Date(day);
  at.setHours(hours, minutes, 0, 0);
  return at.toISOString().replace('.000Z', 'Z');
}
