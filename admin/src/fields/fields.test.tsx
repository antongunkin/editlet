import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

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

  it('multiple select → string[] via checkboxes', () => {
    const options = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b' },
    ];
    const { onChange } = renderWidget({ type: 'select', label: 'Kinds', options, multiple: true }, ['a']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'B' }));
    expect(onChange).toHaveBeenLastCalledWith(['a', 'b']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'A' }));
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
    expect(ta.value).toBe('# Hi\n\n_em_\n');
    fireEvent.change(ta, { target: { value: '# Hi\n' } });
    expect(onChange).toHaveBeenLastCalledWith('# Hi\n');
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
    const zone = container.querySelector('[data-editlet="image-drop"]')!;
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

  it('image Gallery scopes to This entry or All, searches by path, names tiles by file and folder, uploads from its bar', async () => {
    const stageUpload = vi.fn(async (file: File) => `hello-world/${file.name}`);
    const { onChange } = renderWidget(
      { type: 'image', label: 'Cover' },
      { src: '', alt: 'Kept' },
      makeCtx({ stageUpload, contentDir: 'cms/content' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gallery' });
    expect(within(dialog).getByText('2 images')).toBeDefined();
    // The entry's own images are the default scope.
    const entry = within(dialog).getByRole('button', { name: /^This entry\s*1$/ });
    expect(entry.getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).queryByTitle('cms/content/shared/logo.png')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: /^All\s*2$/ }));
    const tiles = within(dialog).getAllByRole('button', { name: /, (post\/hello-world|shared)$/ });
    expect(tiles.map((t) => t.getAttribute('aria-label'))).toEqual([
      'cover.webp, post/hello-world',
      'logo.png, shared',
    ]);
    // The file and its folder are written under the picture: a tooltip does not exist on a touch screen.
    expect(within(tiles[1]!).getByText('logo.png')).toBeDefined();
    expect(within(tiles[1]!).getByText('shared')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Search images'), { target: { value: 'LOGO' } });
    expect(within(dialog).queryByTitle('cms/content/post/hello-world/cover.webp')).toBeNull();
    expect(within(dialog).getByTitle('cms/content/shared/logo.png')).toBeDefined();
    fireEvent.change(screen.getByTestId('media-picker-file'), { target: { files: [new File(['x'], 'new.png')] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ src: 'hello-world/new.png', alt: 'Kept' }));
    expect(stageUpload).toHaveBeenCalledOnce();
  });

  it('image Gallery starts with a fresh search and scope every time it opens', async () => {
    renderWidget({ type: 'image', label: 'Cover' }, { src: '', alt: '' });
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    let dialog = await screen.findByRole('dialog', { name: 'Gallery' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^All\s*2$/ }));
    fireEvent.change(within(dialog).getByLabelText('Search images'), { target: { value: 'zzz' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gallery' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Gallery' }));
    dialog = await screen.findByRole('dialog', { name: 'Gallery' });
    expect((within(dialog).getByLabelText('Search images') as HTMLInputElement).value).toBe('');
    expect(
      within(dialog)
        .getByRole('button', { name: /^This entry\s*1$/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
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

  it('image shows an openable preview, and a chip with the file name while it waits for the save', () => {
    const { unmount } = renderWidget({ type: 'image', label: 'Cover' }, { src: 'hello-world/cover.webp', alt: '' });
    expect(screen.getByTestId('preview').getAttribute('data-openable')).toBe('true');
    expect(screen.queryByText(/uploads when you save/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDefined();
    unmount();
    renderWidget(
      { type: 'image', label: 'Cover' },
      { src: 'hello-world/cover.webp', alt: '' },
      makeCtx({ isStaged: (p) => p === 'cms/content/post/hello-world/cover.webp' }),
    );
    expect(screen.getByText('cover.webp · uploads when you save')).toBeDefined();
  });

  it.each<[string, Field, unknown]>([
    ['string', { type: 'string', label: 'F' }, 'x'],
    ['string list', { type: 'string', list: true, label: 'F' }, []],
    ['text', { type: 'text', label: 'F' }, ''],
    ['markdown', { type: 'markdown', label: 'F' }, ''],
    ['number', { type: 'number', label: 'F' }, ''],
    ['url', { type: 'url', label: 'F' }, ''],
    ['json', { type: 'json', label: 'F' }, ''],
    ['color', { type: 'color', label: 'F' }, '#ffffff'],
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
