import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FieldRows, type FieldItem } from './FieldRows';

import type { Field } from '../../../core/schema';
import type { FieldContext } from '../fields';
import { FieldRow } from '../ui/parts/rows';

const ctx = {
  entries: () => [],
  wantEntries: () => {},
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

  describe('reference pickers', () => {
    const one: Field = { type: 'reference', label: 'Author', collections: ['author'] };
    const many: Field = { type: 'reference', label: 'Tags', collections: ['tag'], multiple: true };

    it.each([one, many])('asks for the options of $label only once its modal opens', async (field) => {
      const wantEntries = vi.fn();
      const rows = (open: string | null) => (
        <FieldRows items={[item(field, '')]} ctx={{ ...ctx, wantEntries }} sub="A post" open={open} onOpen={() => {}} />
      );
      const view = render(rows(null));
      expect(wantEntries).not.toHaveBeenCalled();
      view.rerender(rows('f'));
      await screen.findByRole('dialog', { name: field.label });
      view.rerender(rows('f'));
      expect(wantEntries.mock.calls).toEqual([[field.type === 'reference' && field.collections]]);
    });

    it('shows a loading row, not "No entries to add", while the options load', async () => {
      render(
        <FieldRows
          items={[item(many, [])]}
          ctx={{ ...ctx, entriesPending: true }}
          sub="A post"
          open="f"
          nested={['add']}
          onOpen={() => {}}
        />,
      );
      const add = await screen.findByRole('dialog', { name: 'Add tags' });
      expect(within(add).getByText('Loading…')).toBeDefined();
      expect(within(add).queryByText('No entries to add')).toBeNull();
    });
  });

  describe('the picker page: 20 options at a time', () => {
    const one: Field = { type: 'reference', label: 'Author', collections: ['author'] };
    const many: Field = { type: 'reference', label: 'Tags', collections: ['tag'], multiple: true };
    /** `n` entries: `tag/e01` titled *Entry 01*, and so on. */
    const entries = (n: number) =>
      Array.from({ length: n }, (_, i) => {
        const no = String(i + 1).padStart(2, '0');
        return { ref: `tag/e${no}`, title: `Entry ${no}` };
      });
    const withEntries = (n: number) => ({ ...ctx, entries: () => entries(n) }) as FieldContext;

    const sheets = {
      async single(value = '', field: Field = one) {
        render(
          <FieldRows items={[item(field, value)]} ctx={withEntries(45)} sub="A post" open="f" onOpen={() => {}} />,
        );
        const dialog = within(await screen.findByRole('dialog', { name: 'Author' }));
        const group = within(dialog.getByRole('radiogroup', { name: 'Author' }));
        return { dialog, options: () => group.getAllByRole('radio'), search: dialog.getByLabelText('Search author') };
      },
      async add(field: Field = many, value: string[] = []) {
        render(
          <FieldRows
            items={[item(field, value)]}
            ctx={withEntries(45)}
            sub="A post"
            open="f"
            nested={['add']}
            onOpen={() => {}}
          />,
        );
        const dialog = within(await screen.findByRole('dialog', { name: 'Add tags' }));
        const group = within(dialog.getByRole('group', { name: 'Tags to add' }));
        return { dialog, options: () => group.getAllByRole('checkbox'), search: dialog.getByLabelText('Search tags') };
      },
    };

    it.each(['single', 'add'] as const)(
      '%s: 20, then 40, then 45; the focus goes to the first new one',
      async (kind) => {
        const { dialog, options } = await sheets[kind]();
        const more = (n: number) => dialog.getByRole('button', { name: `Show ${n} more` });
        expect(options()).toHaveLength(20);
        expect(dialog.getByText('Showing 20 of 45: search to narrow them.')).toBeDefined();
        fireEvent.click(more(20));
        expect(options()).toHaveLength(40);
        expect(document.activeElement).toBe(options()[20]);
        expect(dialog.getByText('Showing 40 of 45: search to narrow them.')).toBeDefined();
        fireEvent.click(more(5));
        expect(options()).toHaveLength(45);
        expect(document.activeElement).toBe(options()[40]);
        expect(dialog.queryByRole('button', { name: /more$/ })).toBeNull();
        expect(dialog.queryByText(/^Showing/)).toBeNull();
      },
    );

    it.each(['single', 'add'] as const)('%s: a new query shows the first page again', async (kind) => {
      const { dialog, options, search } = await sheets[kind]();
      fireEvent.click(dialog.getByRole('button', { name: 'Show 20 more' }));
      expect(options()).toHaveLength(40);
      // Matches every entry, so only the page changes.
      fireEvent.change(search, { target: { value: 'entry' } });
      expect(options()).toHaveLength(20);
      fireEvent.click(dialog.getByRole('button', { name: 'Show 20 more' }));
      fireEvent.change(search, { target: { value: '' } });
      expect(options()).toHaveLength(20);
    });

    it('shows the chosen entry first while nothing is typed, as the one tab stop', async () => {
      const { options, search } = await sheets.single('tag/e30');
      expect(options()).toHaveLength(20);
      expect(options()[0]!.textContent).toContain('Entry 30');
      expect(options()[0]!.getAttribute('aria-checked')).toBe('true');
      expect(options()[1]!.textContent).toContain('Entry 01');
      expect(options().map((r) => r.tabIndex)).toEqual([0, ...Array<number>(19).fill(-1)]);
      // The arrows walk the options that show.
      options()[0]!.focus();
      fireEvent.keyDown(options()[0]!, { key: 'End' });
      expect(document.activeElement).toBe(options()[19]);
      expect(options()[19]!.textContent).toContain('Entry 19');
      // Typed, the order is the entries' own again; the chosen one is past this page.
      fireEvent.change(search, { target: { value: 'entry' } });
      expect(options()[0]!.textContent).toContain('Entry 01');
      expect(options().map((r) => r.tabIndex)).toEqual([0, ...Array<number>(19).fill(-1)]);
    });

    it('counts the picked entries a new query hides, and they stay picked', async () => {
      const { dialog, options, search } = await sheets.add();
      fireEvent.click(options()[0]!);
      fireEvent.click(options()[1]!);
      fireEvent.change(search, { target: { value: 'Entry 45' } });
      expect(options()).toHaveLength(1);
      expect(dialog.getByRole('button', { name: 'Add 2 entries' })).toBeDefined();
      fireEvent.click(options()[0]!);
      expect(dialog.getByRole('button', { name: 'Add 3 entries' })).toBeDefined();
      fireEvent.change(search, { target: { value: '' } });
      expect(
        options()
          .slice(0, 3)
          .map((o) => o.getAttribute('aria-checked')),
      ).toEqual(['true', 'true', 'false']);
    });

    it('turns the other options off at `max`, on every page', async () => {
      const { dialog, options } = await sheets.add({ ...many, max: 3 } as Field, ['tag/e45']);
      fireEvent.click(options()[0]!);
      fireEvent.click(options()[1]!);
      const off = () => options().map((o) => (o as HTMLButtonElement).disabled);
      expect(off()).toEqual([false, false, ...Array<boolean>(18).fill(true)]);
      // Every new option is off: the focus stays among the options, on the last one that takes it.
      fireEvent.click(dialog.getByRole('button', { name: 'Show 20 more' }));
      expect(off()).toEqual([false, false, ...Array<boolean>(38).fill(true)]);
      expect(document.activeElement).toBe(options()[1]);
    });

    it('keeps the order while a choice closes the modal', async () => {
      const onChange = vi.fn();
      const rows = (value: string, open: string | null) => (
        <FieldRows
          items={[item(one, value, { onChange })]}
          ctx={withEntries(45)}
          sub="A post"
          open={open}
          onOpen={() => {}}
        />
      );
      const view = render(rows('tag/e30', 'f'));
      const group = await screen.findByRole('radiogroup', { name: 'Author' });
      view.rerender(rows('tag/e02', null));
      expect(within(group).getAllByRole('radio', { hidden: true })[0]!.textContent).toContain('Entry 30');
      view.rerender(rows('tag/e02', 'f'));
      const reopened = await screen.findByRole('radiogroup', { name: 'Author' });
      expect(within(reopened).getAllByRole('radio')[0]!.textContent).toContain('Entry 02');
    });

    it('draws no page controls for 20 options or fewer', async () => {
      render(<FieldRows items={[item(one, '')]} ctx={withEntries(20)} sub="A post" open="f" onOpen={() => {}} />);
      const dialog = within(await screen.findByRole('dialog', { name: 'Author' }));
      expect(dialog.getAllByRole('radio')).toHaveLength(20);
      expect(dialog.queryByRole('button', { name: /more$/ })).toBeNull();
      expect(dialog.queryByText(/^Showing/)).toBeNull();
    });
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
