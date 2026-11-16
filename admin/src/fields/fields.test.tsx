import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { formatStored, fromPickerValue, parseStored, toPickerValue } from './DatetimeField';
import { FieldWidget } from './FormFields';
import type { FieldContext } from './types';

import type { Field } from '../../../core/schema';

function makeCtx(over: Partial<FieldContext> = {}): FieldContext {
  return {
    entries: (collections) =>
      collections.includes('post')
        ? [
            { ref: 'hello-world', title: 'Hello world' },
            { ref: 'second', title: 'Second post' },
          ]
        : [{ ref: 'jane', title: 'Jane' }],
    images: ['cms/content/post/hello-world/cover.webp', 'cms/content/shared/logo.png'],
    entryPath: 'cms/content/post/hello-world.md',
    stageUpload: vi.fn(async (file: File) => `hello-world/${file.name.toLowerCase()}`),
    resolveSrc: (src) => (src === '' ? null : `cms/content/post/${src}`),
    toSrc: (p) => p.replace('cms/content/post/', ''),
    Preview: ({ path, alt, openable }) => (
      <img data-testid="preview" data-path={path ?? ''} data-openable={String(openable === true)} alt={alt} />
    ),
    ...over,
  };
}

/** Renders a widget with local state so successive edits see the updated value. */
function renderWidget(field: Field, initial: unknown, ctx = makeCtx(), error?: string[]) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState<unknown>(initial);
    return (
      <FieldWidget
        name="f"
        field={field}
        value={value}
        error={error}
        ctx={ctx}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
      />
    );
  }
  const utils = render(<Harness />);
  return { ...utils, onChange, ctx };
}

describe('field widgets', () => {
  it('string → string; label, required and error wiring', () => {
    const { onChange } = renderWidget({ type: 'string', label: 'Title', required: true }, 'Hi', makeCtx(), [
      'Required',
      'Too short',
    ]);
    const input = screen.getByLabelText(/Title/) as HTMLInputElement;
    expect(input.value).toBe('Hi');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Required; Too short');
    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(onChange).toHaveBeenLastCalledWith('Hello');
  });

  it('string list → string[] with add and remove', () => {
    const { onChange } = renderWidget({ type: 'string', label: 'Tags', list: true }, ['a']);
    const input = screen.getByLabelText(/^Tags/);
    fireEvent.change(input, { target: { value: 'b' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a' }));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });

  it('text → string with rows', () => {
    const { onChange } = renderWidget({ type: 'text', label: 'Summary', rows: 7 }, '');
    const ta = screen.getByLabelText(/^Summary/) as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.rows).toBe(7);
    fireEvent.change(ta, { target: { value: 'x\ny' } });
    expect(onChange).toHaveBeenLastCalledWith('x\ny');
  });

  it('boolean → boolean with custom labels; undefined shows neither active', () => {
    const { onChange } = renderWidget(
      { type: 'boolean', label: 'Featured', labels: { true: 'On', false: 'Off' } },
      undefined,
    );
    const on = screen.getByRole('button', { name: 'On' });
    const off = screen.getByRole('button', { name: 'Off' });
    expect(on.getAttribute('aria-pressed')).toBe('false');
    expect(off.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(on);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(on.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(off);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('single select → string; empty option unless required', () => {
    const options = [
      { label: 'News', value: 'news' },
      { label: 'Blog', value: 'blog' },
    ];
    const { onChange, unmount } = renderWidget({ type: 'select', label: 'Category', options }, '');
    const select = screen.getByLabelText(/^Category/) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['', 'news', 'blog']);
    fireEvent.change(select, { target: { value: 'blog' } });
    expect(onChange).toHaveBeenLastCalledWith('blog');
    unmount();
    renderWidget({ type: 'select', label: 'Category', options, required: true }, 'news');
    const required = screen.getByLabelText(/Category/) as HTMLSelectElement;
    expect([...required.options].map((o) => o.value)).toEqual(['news', 'blog']);
  });

  it('multiple select → string[] via checkboxes', () => {
    const options = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ];
    const { onChange } = renderWidget({ type: 'select', label: 'Kinds', options, multiple: true }, ['a']);
    fireEvent.click(screen.getByLabelText('B'));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByLabelText('A'));
    expect(onChange).toHaveBeenLastCalledWith(['b']);
  });

  it('number → input text with min/max/step', () => {
    const { onChange } = renderWidget({ type: 'number', label: 'Rating', min: 0, max: 5, step: 0.5 }, '3');
    const input = screen.getByLabelText(/^Rating/) as HTMLInputElement;
    expect(input.type).toBe('number');
    expect(input.min).toBe('0');
    expect(input.max).toBe('5');
    expect(input.step).toBe('0.5');
    fireEvent.change(input, { target: { value: '4.5' } });
    expect(onChange).toHaveBeenLastCalledWith('4.5');
  });

  it('datetime: shows the date formatted with Intl; the native picker stores UTC ISO 8601', () => {
    const { onChange } = renderWidget({ type: 'datetime', label: 'At' }, '2024-05-01T10:30:15Z');
    const shown = screen.getByLabelText(/^At/) as HTMLInputElement;
    expect(shown.readOnly).toBe(true);
    expect(shown.value).toBe(formatStored('2024-05-01T10:30:15Z', false));
    expect(shown.value).not.toContain('2024-05-01T');
    const picker = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(picker.value).toBe(toPickerValue(new Date('2024-05-01T10:30:15Z'), false));
    fireEvent.change(picker, { target: { value: '2024-05-02T08:00' } });
    expect(onChange).toHaveBeenLastCalledWith(new Date('2024-05-02T08:00').toISOString().replace('.000Z', 'Z'));
    fireEvent.keyDown(shown, { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('datetime: a value that cannot be read stays as stored; the picker is empty', () => {
    renderWidget({ type: 'datetime', label: 'At' }, 'next week');
    expect((screen.getByLabelText(/^At/) as HTMLInputElement).value).toBe('next week');
    expect((document.querySelector('input[type="datetime-local"]') as HTMLInputElement).value).toBe('');
  });

  it('datetime dateOnly → date picker, stored as YYYY-MM-DD', () => {
    const { onChange } = renderWidget({ type: 'datetime', label: 'Day', dateOnly: true }, '2024-05-01');
    const shown = screen.getByLabelText(/^Day/) as HTMLInputElement;
    expect(shown.value).toBe(formatStored('2024-05-01', true));
    const picker = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(picker.value).toBe('2024-05-01');
    fireEvent.change(picker, { target: { value: '2024-06-01' } });
    expect(onChange).toHaveBeenLastCalledWith('2024-06-01');
  });

  it('datetime helpers: zone-less values are local time; invalid dates are unreadable', () => {
    expect(toPickerValue(parseStored('2024-05-01T10:30:15', false)!, false)).toBe('2024-05-01T10:30');
    expect(parseStored('2024-02-31', true)).toBeUndefined();
    expect(parseStored('2024-05-01', false)).toBeUndefined();
    expect(fromPickerValue('2024-05-02T08:00', true)).toBe('2024-05-02T08:00');
  });

  it('json → text with Valid / Invalid status', () => {
    const { onChange } = renderWidget({ type: 'json', label: 'Meta' }, '{"a":1}');
    expect(screen.getByText('Valid JSON')).toBeDefined();
    fireEvent.change(screen.getByLabelText(/^Meta/), { target: { value: '{bad' } });
    expect(onChange).toHaveBeenLastCalledWith('{bad');
    expect(screen.getByText('Invalid JSON')).toBeDefined();
  });

  it('url → string', () => {
    const { onChange } = renderWidget({ type: 'url', label: 'Link' }, '');
    fireEvent.change(screen.getByLabelText(/^Link/), { target: { value: 'https://x.dev' } });
    expect(onChange).toHaveBeenLastCalledWith('https://x.dev');
  });

  it('color → string from picker (lowercased) and text input', () => {
    const { onChange } = renderWidget({ type: 'color', label: 'Accent' }, '#AABBCC');
    const picker = screen.getByLabelText('Accent color picker') as HTMLInputElement;
    expect(picker.value).toBe('#aabbcc');
    fireEvent.change(picker, { target: { value: '#112233' } });
    expect(onChange).toHaveBeenLastCalledWith('#112233');
    fireEvent.change(screen.getByLabelText(/^Accent(?! color picker)/), { target: { value: '#00ff00' } });
    expect(onChange).toHaveBeenLastCalledWith('#00ff00');
  });

  it('markdown Source is a monospace textarea → body string, and the choice is remembered', () => {
    const { onChange } = renderWidget({ type: 'markdown', label: 'Body' }, '# Hi\n\n_em_\n');
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(localStorage.getItem('editlet:markdown-mode')).toBe('source');
    localStorage.removeItem('editlet:markdown-mode');
    const ta = screen.getByLabelText(/^Body/) as HTMLTextAreaElement;
    expect(ta.tagName).toBe('TEXTAREA');
    expect(ta.className).toContain('editlet-ff-markdown__textarea');
    expect(ta.value).toBe('# Hi\n\n_em_\n');
    fireEvent.change(ta, { target: { value: '# Hi\n' } });
    expect(onChange).toHaveBeenLastCalledWith('# Hi\n');
  });

  it('single reference → string from entries of the allowed collections, picked in a combobox', () => {
    const { onChange } = renderWidget({ type: 'reference', label: 'Author', collections: ['author'] }, '');
    const input = screen.getByRole('combobox', { name: /^Author/ });
    fireEvent.focus(input);
    const list = screen.getByRole('listbox');
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Janejane']);
    fireEvent.click(within(list).getByRole('option', { name: /Jane/ }));
    expect(onChange).toHaveBeenLastCalledWith('jane');
    expect(screen.getByRole('combobox', { name: /^Author/ }).getAttribute('aria-expanded')).toBe('false');
    expect((screen.getByRole('combobox', { name: /^Author/ }) as HTMLInputElement).value).toBe('Jane');
    fireEvent.click(screen.getByRole('button', { name: 'Clear Author' }));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('reference combobox: typing filters by title and ref, arrows and Enter pick, Escape closes', () => {
    const { onChange } = renderWidget({ type: 'reference', label: 'Post', collections: ['post'] }, '');
    const input = screen.getByRole('combobox', { name: /^Post/ });
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'sec' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Second postsecond']);
    fireEvent.change(input, { target: { value: 'hello world' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Hello worldhello-world']);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toEqual([]);
    expect(screen.getByText('No matching entries')).toBeDefined();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1]!.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('second');
    fireEvent.change(input, { target: { value: 'x' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('reference: a link opens the chosen entry when the context gives one', () => {
    const EntryLink = ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
      <a href={`#${to}`} {...props}>
        {children}
      </a>
    );
    renderWidget({ type: 'reference', label: 'Author', collections: ['author'] }, 'jane', makeCtx({ EntryLink }));
    expect(screen.getByRole('link', { name: 'Open Jane' }).getAttribute('href')).toBe('#jane');
  });

  it('reference: an unlisted value is "not found" once entries are loaded, not while loading', () => {
    const field: Field = { type: 'reference', label: 'Author', collections: ['author'] };
    const loading = renderWidget(field, 'author/gone', makeCtx({ entriesPending: true }));
    expect(screen.queryByText('Referenced entry not found: author/gone')).toBeNull();
    loading.unmount();
    renderWidget(field, 'author/gone');
    expect(screen.getByText('Referenced entry not found: author/gone')).toBeDefined();
    expect((screen.getByRole('combobox', { name: /^Author/ }) as HTMLInputElement).value).toBe(
      'Not found: author/gone',
    );
  });

  it('multiple reference: a missing item is a marked chip', () => {
    renderWidget({ type: 'reference', label: 'Related', collections: ['post'], multiple: true }, [
      'hello-world',
      'gone',
    ]);
    const chips = screen.getByRole('list', { name: 'Related selected' });
    expect(within(chips).getByText('Not found: gone').closest('li')?.className).toContain('--broken');
    expect(screen.getByText('Referenced entry not found: gone')).toBeDefined();
  });

  it('multiple reference adds and removes chips → string[]', () => {
    const { onChange } = renderWidget({ type: 'reference', label: 'Related', collections: ['post'], multiple: true }, [
      'hello-world',
    ]);
    const chips = screen.getByRole('list', { name: 'Related selected' });
    expect(within(chips).getByText('Hello world')).toBeDefined();
    const add = screen.getByRole('combobox', { name: /^Related/ });
    fireEvent.focus(add);
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Second postsecond']);
    fireEvent.click(screen.getByRole('option', { name: /Second post/ }));
    expect(onChange).toHaveBeenLastCalledWith(['hello-world', 'second']);
    expect(within(screen.getByRole('list', { name: 'Related selected' })).getByText('Second post')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Hello world' }));
    expect(onChange).toHaveBeenLastCalledWith(['second']);
    expect(screen.queryByRole('button', { name: 'Remove Hello world' })).toBeNull();
  });

  it('image Upload calls stageUpload and onChange with the returned src', async () => {
    const { onChange, ctx } = renderWidget({ type: 'image', label: 'Cover' }, { src: '', alt: 'A cat' });
    const file = new File([new Uint8Array([1, 2, 3])], 'Cover.webp', { type: 'image/webp' });
    const input = screen.getByTestId('f-file') as HTMLInputElement;
    expect(input.accept).toBe('image/*');
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/cover.webp', alt: 'A cat' }));
    expect(ctx.stageUpload).toHaveBeenCalledWith(file);
    expect(screen.getByTestId('preview').getAttribute('data-path')).toBe('cms/content/post/hello-world/cover.webp');
  });

  it('image: dropping a file on the field uploads it; a drag without files does nothing', async () => {
    const { onChange, ctx, container } = renderWidget({ type: 'image', label: 'Cover' }, { src: '', alt: 'A cat' });
    const zone = container.querySelector('.editlet-ff-image__body')!;
    const file = new File([new Uint8Array([1, 2, 3])], 'Dropped.webp', { type: 'image/webp' });

    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone.getAttribute('data-dragging')).toBe('true');
    fireEvent.dragLeave(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone.hasAttribute('data-dragging')).toBe(false);

    fireEvent.drop(zone, { dataTransfer: { types: ['text/plain'], files: [] } });
    expect(ctx.stageUpload).not.toHaveBeenCalled();

    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/dropped.webp', alt: 'A cat' }));
    expect(ctx.stageUpload).toHaveBeenCalledWith(file);
    expect(zone.hasAttribute('data-dragging')).toBe(false);
  });

  it('image Upload shows the stageUpload error inline', async () => {
    const ctx = makeCtx({ stageUpload: vi.fn(async () => Promise.reject(new Error('File is larger than 10 MB'))) });
    const { onChange } = renderWidget({ type: 'image', label: 'Cover' }, { src: '', alt: '' }, ctx);
    const file = new File(['x'], 'big.png', { type: 'image/png' });
    fireEvent.change(screen.getByTestId('f-file'), { target: { files: [file] } });
    expect(await screen.findByText('File is larger than 10 MB')).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('image Gallery picks toSrc(path), and alt text edits', () => {
    const { onChange } = renderWidget({ type: 'image', label: 'Cover' }, { src: '', alt: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    fireEvent.click(screen.getByTitle('cms/content/post/hello-world/cover.webp'));
    expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/cover.webp', alt: '' });
    expect(screen.queryByRole('heading', { name: 'Gallery' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Cover alt text'), { target: { value: 'Sunset' } });
    expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/cover.webp', alt: 'Sunset' });
  });

  it('image Gallery searches, scopes to the entry or All, and uploads from the picker', async () => {
    const stageUpload = vi.fn(async (file: File) => `hello-world/${file.name}`);
    const { onChange } = renderWidget(
      { type: 'image', label: 'Cover' },
      { src: '', alt: 'Kept' },
      makeCtx({ stageUpload }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'This entry (1)' }).getAttribute('aria-selected')).toBe('true');
    expect(within(dialog).queryByTitle('cms/content/shared/logo.png')).toBeNull();
    fireEvent.click(within(dialog).getByRole('tab', { name: 'All (2)' }));
    fireEvent.change(within(dialog).getByLabelText('Search images'), { target: { value: 'LOGO' } });
    expect(within(dialog).queryByTitle('cms/content/post/hello-world/cover.webp')).toBeNull();
    expect(within(dialog).getByTitle('cms/content/shared/logo.png')).toBeDefined();
    fireEvent.change(screen.getByTestId('media-picker-file'), { target: { files: [new File(['x'], 'new.png')] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/new.png', alt: 'Kept' }));
    expect(stageUpload).toHaveBeenCalledOnce();
  });

  it('image Remove is one icon button that asks first: Cancel keeps the image, Remove clears it', () => {
    const { onChange } = renderWidget(
      { type: 'image', label: 'Cover' },
      { src: 'hello-world/cover.webp', alt: 'A cat' },
    );
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText('Remove image?')).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Remove' }));
    expect(onChange).toHaveBeenLastCalledWith({ src: '', alt: '' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('image shows a large openable preview and the file name, which has the whole path as its title', () => {
    renderWidget({ type: 'image', label: 'Cover' }, { src: 'hello-world/cover.webp', alt: '' });
    expect(screen.getByTestId('preview').getAttribute('data-openable')).toBe('true');
    const name = screen.getByText('cover.webp');
    expect(name.getAttribute('title')).toBe('hello-world/cover.webp');
  });

  it.each<[string, Field, unknown]>([
    ['string', { type: 'string', label: 'F' }, 'x'],
    ['string list', { type: 'string', list: true, label: 'F' }, []],
    ['text', { type: 'text', label: 'F' }, ''],
    ['markdown', { type: 'markdown', label: 'F' }, ''],
    ['number', { type: 'number', label: 'F' }, ''],
    ['url', { type: 'url', label: 'F' }, ''],
    ['datetime', { type: 'datetime', label: 'F' }, ''],
    ['json', { type: 'json', label: 'F' }, ''],
    ['color', { type: 'color', label: 'F' }, '#ffffff'],
    [
      'select',
      {
        type: 'select',
        label: 'F',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      'a',
    ],
    [
      'multi select',
      {
        type: 'select',
        multiple: true,
        label: 'F',
        options: [
          { label: 'A', value: 'a' },
          { label: 'B', value: 'b' },
        ],
      },
      [],
    ],
    ['reference', { type: 'reference', label: 'F', collections: ['post'] }, ''],
    ['multi reference', { type: 'reference', multiple: true, label: 'F', collections: ['post'] }, []],
    ['boolean', { type: 'boolean', label: 'F' }, true],
    ['image', { type: 'image', label: 'F' }, { src: '', alt: '' }],
  ])(
    '%s: the hint comes before the control, and the control is described by the hint and the error',
    async (_, field, value) => {
      const { container } = renderWidget({ ...field, hint: 'Shown on the site' } as Field, value, makeCtx(), [
        'Bad value',
      ]);
      // The markdown body's rich editor (its default mode) loads lazily.
      await waitFor(() => expect(container.querySelectorAll('[aria-describedby]').length).toBeGreaterThan(0));
      const controls = [...container.querySelectorAll('[aria-describedby]')];
      const hint = screen.getByText('Shown on the site');
      for (const control of controls) {
        const texts = control
          .getAttribute('aria-describedby')!
          .split(' ')
          .map((id) => container.querySelector(`[id="${id}"]`)?.textContent);
        expect(texts).toEqual(['Shown on the site', 'Bad value']);
        expect(hint.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    },
  );

  it('a control without hint or error has no aria-describedby', () => {
    renderWidget({ type: 'string', label: 'Title' }, 'Hi');
    expect(screen.getByLabelText(/^Title/).hasAttribute('aria-describedby')).toBe(false);
  });
});
