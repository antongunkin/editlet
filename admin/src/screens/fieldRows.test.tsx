import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FieldRows, type FieldItem } from './FieldRows';

import type { Field } from '../../../core/schema';
import type { FieldContext } from '../fields';
import { FieldRow } from '../ui/parts/rows';

const ctx = {
  entries: () => [],
  images: [],
  entryPath: 'cms/content/post/a.md',
  stageUpload: vi.fn(),
  resolveSrc: () => null,
  toSrc: (p: string) => p,
  Preview: () => null,
} as FieldContext;

const item = (field: Field, value: unknown, over: Partial<FieldItem> = {}): FieldItem => ({
  key: 'f',
  name: 'f',
  field,
  value,
  onChange: vi.fn(),
  ...over,
});

const select: Field = {
  type: 'select',
  label: 'Category',
  options: ['Tires', 'Parts', 'Paint'].map((l) => ({ label: l, value: l.toLowerCase() })),
};

describe('FieldRows', () => {
  it('an option list is one tab stop: arrows, Home and End move the focus; a click chooses and closes', async () => {
    const onChange = vi.fn();
    const onOpen = vi.fn();
    render(<FieldRows items={[item(select, 'parts', { onChange })]} ctx={ctx} sub="A post" open="f" onOpen={onOpen} />);
    const group = await screen.findByRole('radiogroup', { name: 'Category' });
    const radios = within(group).getAllByRole('radio');
    // Tires, Parts (chosen), Paint, None: only the chosen one is in the tab order.
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1]);
    radios[1]!.focus();
    fireEvent.keyDown(radios[1]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(radios[2]);
    fireEvent.keyDown(radios[2]!, { key: 'Home' });
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(radios[3]);
    // Moving the focus chose nothing.
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(radios[2]!);
    expect(onChange).toHaveBeenCalledWith('paint');
    expect(onOpen).toHaveBeenCalledWith(null);
  });

  it('with nothing chosen in a required list, the first option is the tab stop', async () => {
    render(
      <FieldRows items={[item({ ...select, required: true }, '')]} ctx={ctx} sub="A post" open="f" onOpen={() => {}} />,
    );
    const radios = within(await screen.findByRole('radiogroup', { name: 'Category' })).getAllByRole('radio');
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
  });

  it("a Yes/No row's switch is described by the field's whole problem", () => {
    render(
      <FieldRows
        items={[
          item({ type: 'boolean', label: 'In the header' }, undefined, { error: ['Must be set before publishing'] }),
        ]}
        ctx={ctx}
        sub="A page"
      />,
    );
    const toggle = screen.getByRole('switch', { name: 'In the header' });
    const described = document.getElementById(toggle.getAttribute('aria-describedby')!);
    expect(described?.textContent).toContain('Must be set before publishing');
  });

  it('a row that is loading is not a button', () => {
    render(<FieldRow label="Title" loading />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Loading…')).toBeDefined();
  });

  describe('nested (/design: a nested modal drawn open)', () => {
    const tags: Field = { type: 'reference', label: 'Tags', collections: ['tag'], multiple: true };
    const entriesCtx = {
      ...ctx,
      entries: () => [
        { ref: 'tag/a', title: 'Alpha' },
        { ref: 'tag/b', title: 'Beta' },
      ],
    } as FieldContext;

    it('opens the Add sheet of a list of references with the entries ticked', async () => {
      render(
        <FieldRows
          items={[item(tags, ['tag/a'])]}
          ctx={entriesCtx}
          sub="A post"
          open="f"
          nested={['add', 'tag/b']}
          onOpen={() => {}}
        />,
      );
      const add = await screen.findByRole('dialog', { name: 'Add tags' });
      expect(within(add).getByRole('button', { name: 'Add 1 entry' })).toBeDefined();
    });

    it('opens a calendar on its months or years', async () => {
      const date: Field = { type: 'datetime', label: 'Published', dateOnly: true };
      render(
        <FieldRows
          items={[item(date, '2026-11-10')]}
          ctx={ctx}
          sub="A post"
          open="f"
          nested={['years']}
          onOpen={() => {}}
        />,
      );
      const sheet = await screen.findByRole('dialog', { name: 'Published' });
      expect(within(sheet).getAllByText('2020 – 2031').length).toBeGreaterThan(0);
    });
  });
});
