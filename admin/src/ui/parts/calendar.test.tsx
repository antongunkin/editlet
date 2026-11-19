import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { addMonths, Calendar, monthDays, TimeWheel, weekStart } from './calendar';

const NOV_10 = new Date(2026, 10, 10);
const TODAY = new Date(2026, 10, 15);
const focused = () => document.activeElement?.getAttribute('aria-label');
const title = () => screen.getByRole('grid').getAttribute('aria-labelledby');
const titleText = () => document.getElementById(title()!)?.textContent;
const key = (k: string, shiftKey = false) => fireEvent.keyDown(document.activeElement!, { key: k, shiftKey });

describe('weekStart', () => {
  const proto = Intl.Locale.prototype as Intl.Locale & { getWeekInfo?: unknown; weekInfo?: unknown };
  const saved = {
    getWeekInfo: Object.getOwnPropertyDescriptor(proto, 'getWeekInfo'),
    weekInfo: Object.getOwnPropertyDescriptor(proto, 'weekInfo'),
  };
  afterEach(() => {
    for (const [name, d] of Object.entries(saved))
      if (d) Object.defineProperty(proto, name, d);
      else delete (proto as unknown as Record<string, unknown>)[name];
  });

  it('reads Intl.Locale#getWeekInfo where the browser has it', () => {
    Object.defineProperty(proto, 'getWeekInfo', {
      configurable: true,
      value(this: Intl.Locale) {
        return { firstDay: this.region === 'US' ? 7 : 1 };
      },
    });
    expect(weekStart('en-US')).toBe(0);
    expect(weekStart('en-GB')).toBe(1);
  });

  it('reads the older weekInfo getter (Chrome 99–129)', () => {
    Object.defineProperty(proto, 'getWeekInfo', { configurable: true, value: undefined });
    Object.defineProperty(proto, 'weekInfo', { configurable: true, get: () => ({ firstDay: 6 }) });
    expect(weekStart('ar-EG')).toBe(6);
  });

  it('starts on Monday without either (Firefox 128), and for a tag it cannot read', () => {
    Object.defineProperty(proto, 'getWeekInfo', { configurable: true, value: undefined });
    Object.defineProperty(proto, 'weekInfo', { configurable: true, value: undefined });
    expect(weekStart('en-US')).toBe(1);
    expect(weekStart('not a tag')).toBe(1);
  });

  it('puts the week start first in the grid and in the month (1 Nov 2026 is a Sunday)', () => {
    Object.defineProperty(proto, 'getWeekInfo', { configurable: true, value: undefined });
    Object.defineProperty(proto, 'weekInfo', { configurable: true, value: undefined });
    render(<Calendar value={NOV_10} today={TODAY} locale="en-US" />);
    expect(screen.getAllByRole('columnheader')[0]!.getAttribute('aria-label')).toBe('Monday');
    expect(monthDays(2026, 10, 1)[0]).toEqual(new Date(2026, 9, 26));
    expect(monthDays(2026, 10, 0)[0]).toEqual(new Date(2026, 10, 1));
  });
});

describe('Calendar', () => {
  it('shows the month, marks today and the chosen day, and fades the other months', () => {
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    expect(titleText()).toBe('November 2026');
    expect(screen.getByRole('button', { name: 'Tuesday, 10 November 2026' }).hasAttribute('data-selected')).toBe(true);
    expect(screen.getByRole('button', { name: 'Sunday, 15 November 2026' }).getAttribute('aria-current')).toBe('date');
    expect(screen.getAllByRole('gridcell', { selected: true })).toHaveLength(1);
    // 26–31 October and 1–6 December are drawn, not controls
    expect(screen.getAllByRole('button', { name: /^\w+, \d+ November 2026$/ })).toHaveLength(30);
  });

  it('chooses a day; out of range is drawn but cannot be chosen', () => {
    const onChange = vi.fn();
    render(<Calendar value={NOV_10} today={TODAY} min={new Date(2026, 10, 5)} locale="en-GB" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday, 4 November 2026' }));
    expect(screen.getByRole('button', { name: 'Wednesday, 4 November 2026' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Friday, 20 November 2026' }));
    expect(onChange.mock.calls).toEqual([[new Date(2026, 10, 20)]]);
  });

  it('pages months, opens the months and the years from the title, and goes back down', () => {
    const onChange = vi.fn();
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(titleText()).toBe('December 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: /November 2026, choose a month/ }));
    expect(titleText()).toBe('2026');
    expect(screen.getAllByRole('gridcell')).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(titleText()).toBe('2027');
    fireEvent.click(screen.getByRole('button', { name: /2027, choose a year/ }));
    expect(titleText()).toBe('2021 – 2032');
    fireEvent.click(screen.getByRole('button', { name: 'Later years' }));
    expect(titleText()).toBe('2033 – 2044');
    fireEvent.click(screen.getByRole('button', { name: 'Earlier years' }));
    fireEvent.click(screen.getByRole('button', { name: 'Earlier years' }));
    expect(titleText()).toBe('2009 – 2020');
    fireEvent.click(screen.getByRole('button', { name: '2012' }));
    expect(titleText()).toBe('2012');
    fireEvent.click(screen.getByRole('button', { name: 'Feb 2012' }));
    expect(titleText()).toBe('February 2012');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves the focus with the APG grid keys across months', () => {
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    const day = screen.getByRole('button', { name: 'Tuesday, 10 November 2026' });
    expect(day.tabIndex).toBe(0);
    day.focus();
    key('ArrowRight');
    expect(focused()).toBe('Wednesday, 11 November 2026');
    key('ArrowDown');
    expect(focused()).toBe('Wednesday, 18 November 2026');
    key('Home');
    expect(focused()).toBe('Monday, 16 November 2026');
    key('End');
    expect(focused()).toBe('Sunday, 22 November 2026');
    key('ArrowUp');
    key('ArrowUp');
    key('ArrowUp');
    expect(focused()).toBe('Sunday, 1 November 2026');
    key('ArrowLeft');
    expect(focused()).toBe('Saturday, 31 October 2026');
    expect(titleText()).toBe('October 2026');
    key('PageDown');
    expect(focused()).toBe('Monday, 30 November 2026');
    key('PageUp', true);
    expect(focused()).toBe('Sunday, 30 November 2025');
    // one tab stop: the focused day only
    expect(screen.getAllByRole('button').filter((b) => b.tabIndex === 0)).toHaveLength(4); // arrows, title, the day
  });

  it('moves with the keys in the months and years and goes down with Enter', () => {
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    fireEvent.click(screen.getByRole('button', { name: /November 2026, choose a month/ }));
    expect(focused()).toBe('Nov 2026');
    key('ArrowUp');
    expect(focused()).toBe('Aug 2026');
    key('Home');
    expect(focused()).toBe('Jul 2026');
    key('PageDown');
    expect(focused()).toBe('Jul 2027');
    fireEvent.click(screen.getByRole('button', { name: /2027, choose a year/ }));
    expect(focused()).toBe('2027');
    key('ArrowDown');
    key('ArrowDown');
    expect(focused()).toBe('2035');
    expect(titleText()).toBe('2033 – 2044');
    key('End');
    expect(focused()).toBe('2036');
    fireEvent.click(document.activeElement!);
    expect(titleText()).toBe('2036');
    expect(focused()).toBe('Jul 2036');
  });

  it('pages the years by the arrows with the tab stop on the page, and a year is picked by Enter', () => {
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    fireEvent.click(screen.getByRole('button', { name: /November 2026, choose a month/ }));
    fireEvent.click(screen.getByRole('button', { name: /2026, choose a year/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Later years' }));
    expect(titleText()).toBe('2032 – 2043');
    const stop = screen.getAllByRole('button').filter((b) => b.tabIndex === 0 && /^\d{4}$/.test(b.textContent ?? ''));
    expect(stop.map((b) => b.textContent)).toEqual(['2038']);
    stop[0]!.focus();
    key('ArrowRight');
    expect(focused()).toBe('2039');
    fireEvent.click(document.activeElement!); // Enter on a button
    expect(titleText()).toBe('2039');
    expect(focused()).toBe('Nov 2039');
  });

  it('keeps the day of the month while paging months (31 Jan → Feb → 31 Mar)', () => {
    render(<Calendar value={new Date(2026, 0, 31)} today={TODAY} locale="en-GB" />);
    fireEvent.click(screen.getByRole('button', { name: /January 2026, choose a month/ }));
    key('ArrowRight');
    key('ArrowRight');
    expect(focused()).toBe('Mar 2026');
    fireEvent.click(document.activeElement!);
    expect(focused()).toBe('Tuesday, 31 March 2026');
    key('PageUp');
    expect(focused()).toBe('Saturday, 28 February 2026');
    key('PageUp');
    expect(focused()).toBe('Saturday, 31 January 2026');
  });

  it('follows a new value from outside, and takes an Invalid Date as no value', () => {
    const { rerender } = render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    rerender(<Calendar value={new Date(2027, 2, 3)} today={TODAY} locale="en-GB" />);
    expect(titleText()).toBe('March 2027');
    expect(screen.getByRole('button', { name: 'Wednesday, 3 March 2027' }).tabIndex).toBe(0);
    rerender(<Calendar value={new Date('')} today={TODAY} min={new Date('x')} locale="en-GB" />);
    expect(titleText()).toBe('March 2027');
    expect(screen.queryAllByRole('gridcell', { selected: true })).toHaveLength(0);
    rerender(<Calendar value={new Date('')} today={new Date('')} locale="en-GB" />);
    expect(screen.getByRole('grid')).toBeDefined();
  });

  it('shows the years 0–99 as themselves', () => {
    const year50 = new Date(2000, 0, 1);
    year50.setFullYear(50, 5, 15);
    render(<Calendar value={year50} today={TODAY} locale="en-GB" />);
    fireEvent.click(screen.getByRole('button', { name: /choose a month/ }));
    expect(titleText()).toBe('50');
    fireEvent.click(screen.getByRole('button', { name: /50, choose a year/ }));
    expect(titleText()).toBe('44 – 55');
  });

  it('ignores the keys held with Alt, Ctrl or Meta, and marks out-of-range cells disabled', () => {
    render(<Calendar value={NOV_10} today={TODAY} max={new Date(2026, 10, 20)} locale="en-GB" />);
    screen.getByRole('button', { name: 'Tuesday, 10 November 2026' }).focus();
    for (const mod of ['altKey', 'ctrlKey', 'metaKey'])
      fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight', [mod]: true });
    expect(focused()).toBe('Tuesday, 10 November 2026');
    const cell = screen.getByRole('button', { name: 'Saturday, 21 November 2026' }).closest('td')!;
    expect(cell.getAttribute('aria-disabled')).toBe('true');
  });

  it('keeps one live title across the views, so each change is announced', () => {
    render(<Calendar value={NOV_10} today={TODAY} locale="en-GB" />);
    const live = document.getElementById(title()!)!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByRole('button', { name: /November 2026, choose a month/ }));
    fireEvent.click(screen.getByRole('button', { name: /2026, choose a year/ }));
    expect(document.getElementById(title()!)).toBe(live);
    expect(live.textContent).toBe('2020 – 2031');
  });

  it('adds months by the calendar, clamping to the last day', () => {
    expect(addMonths(new Date(2026, 0, 31), 1)).toEqual(new Date(2026, 1, 28));
    expect(addMonths(new Date(2024, 0, 31), 1)).toEqual(new Date(2024, 1, 29));
    expect(addMonths(new Date(2026, 11, 15), 1)).toEqual(new Date(2027, 0, 15));
  });
});

describe('TimeWheel', () => {
  it('steps hours and minutes with the keys, around the clock, and clears', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(<TimeWheel hours={23} minutes={30} onChange={onChange} onClear={onClear} />);
    const hours = screen.getByRole('spinbutton', { name: 'Hours' });
    expect(hours.getAttribute('aria-valuetext')).toBe('23');
    fireEvent.keyDown(hours, { key: 'ArrowUp' });
    fireEvent.keyDown(screen.getByRole('spinbutton', { name: 'Minutes' }), { key: 'PageDown' });
    fireEvent.keyDown(hours, { key: 'Home' });
    // The props never change here: each wheel reads the other's latest value, not the last render's
    expect(onChange.mock.calls).toEqual([
      [{ hours: 0, minutes: 30 }],
      [{ hours: 0, minutes: 20 }],
      [{ hours: 0, minutes: 20 }],
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear time' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('chooses a value that is tapped', () => {
    const onChange = vi.fn();
    render(<TimeWheel hours={14} minutes={30} onChange={onChange} />);
    const minutes = screen.getByRole('spinbutton', { name: 'Minutes' });
    const below = [...minutes.querySelectorAll('[data-offset]')].find((c) => c.textContent === '32')!;
    fireEvent.pointerDown(below, { clientY: 100 });
    fireEvent.pointerUp(below, { clientY: 100 });
    expect(onChange.mock.calls).toEqual([[{ hours: 14, minutes: 32 }]]);
    expect(screen.queryByRole('button', { name: 'Clear time' })).toBeNull();
  });
});
