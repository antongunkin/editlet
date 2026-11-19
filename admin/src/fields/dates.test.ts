import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { formatStored, parseStored, storeDay, storeMoment } from './dates';

describe('datetime values', () => {
  // West of Greenwich, where a day read as UTC midnight shows as the day before: in UTC these tests would prove nothing.
  const zone = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterAll(() => {
    // `process.env.TZ = undefined` would store the string "undefined", which Node reads as UTC.
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  });

  it('reads a stored day from its parts, never as UTC midnight', () => {
    const day = parseStored('2026-11-10', true)!;
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 10, 10, 0]);
    expect(day.getTimezoneOffset()).toBeGreaterThan(0);
    expect(parseStored('0005-01-01', true)!.getFullYear()).toBe(5);
    expect(parseStored('0000-02-29', true)!.getDate()).toBe(29);
    expect(parseStored('2024-02-31', true)).toBeUndefined();
    expect(parseStored('2024-05-01', false)).toBeUndefined();
  });

  it('reads a zone-less moment in local time; a value it cannot read stays as stored', () => {
    const at = parseStored('2024-05-01T10:30:15', false)!;
    expect([at.getHours(), at.getMinutes()]).toEqual([10, 30]);
    expect(formatStored('next week', false)).toBe('next week');
    // West of Greenwich, a day read as UTC midnight would show as Nov 9.
    expect(formatStored('2026-11-10', true)).toContain('10');
    expect(formatStored('2026-11-10', true)).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 10, 10)),
    );
  });

  it('stores a day from its local parts, and a moment in UTC', () => {
    expect(storeDay(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
    const year5 = new Date(2026, 0, 1);
    year5.setFullYear(5);
    expect(storeDay(year5)).toBe('0005-01-01');
    expect(storeMoment(new Date(2026, 0, 15), 9, 0)).toBe(
      new Date(2026, 0, 15, 9, 0).toISOString().replace('.000Z', 'Z'),
    );
  });
});
