import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MarkdownField } from '../fields/MarkdownField';
import type { FieldContext } from '../fields/types';
import { Sheet, SheetProvider } from '../ui/parts/sheet';

const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  entries: () => [],
  images: ['cms/content/post/hello-world/cover.webp', 'cms/content/shared/logo.png'],
  entryPath: 'cms/content/post/hello-world.md',
  stageUpload: vi.fn(async (file: File) => `hello-world/${file.name}`),
  resolveSrc: (src) => (src === '' || /^\w+:/.test(src) ? null : `cms/content/post/${src}`),
  toSrc: (p) => p.replace('cms/content/post/', ''),
  Preview: ({ path, alt }) => <img data-testid="preview" data-path={path ?? ''} alt={alt} />,
  ...over,
});

function renderBody(initial: string, c = ctx(), inSheet = false) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <MarkdownField
        name="body"
        field={{ type: 'markdown', label: 'Body' }}
        value={value}
        onChange={(v) => {
          onChange(v);
          setValue(v);
        }}
        ctx={c}
      />
    );
  }
  // In the Body's own full-screen modal, as on the entry screen: the image dialog is a second modal over it.
  render(
    inSheet ? (
      <SheetProvider>
        <Sheet open full title="Body">
          <Harness />
        </Sheet>
      </SheetProvider>
    ) : (
      <Harness />
    ),
  );
  return { onChange };
}

/** The rich editor's editable area (the Source textarea, also named Body, stands in while the editor loads). */
const editable = () =>
  waitFor(() => {
    const area = screen
      .queryAllByRole('textbox', { name: 'Body' })
      .find((el) => el.getAttribute('contenteditable') === 'true');
    expect(area).toBeDefined();
    return area!;
  });
const toolbar = async () => screen.findByRole('toolbar', { name: 'Formatting' });

afterEach(() => localStorage.clear());

describe('RichEditor', () => {
  it('opens in Rich by default with a labelled editable area and changes nothing on load', async () => {
    const { onChange } = renderBody('# Title\n\nSome *text* here.\n');
    const area = await editable();
    expect(area.getAttribute('contenteditable')).toBe('true');
    expect(area.querySelector('h1')?.textContent).toBe('Title');
    expect(area.querySelector('em')?.textContent).toBe('text');
    await toolbar();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('has one tab stop in the toolbar and moves with the arrow keys', async () => {
    renderBody('Text\n');
    const bar = await toolbar();
    const controls = within(bar).getAllByRole('button');
    const select = within(bar).getByRole('combobox', { name: 'Block type' });
    expect(select.tabIndex).toBe(0);
    expect(controls.every((b) => b.tabIndex === -1)).toBe(true);
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(bar).getByRole('button', { name: 'Bold' }));
    expect(within(bar).getByRole('button', { name: 'Bold' }).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(controls.at(-1));
    expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps HTML as text in a raw block; editing it changes only that block', async () => {
    const body = 'Intro  kept.\n\n<div class="note">Hi</div>\n\n* star\n';
    const { onChange } = renderBody(body);
    const raw = (await screen.findByRole('textbox', { name: 'Markdown kept as text' })) as HTMLTextAreaElement;
    expect(raw.value).toBe('<div class="note">Hi</div>');
    fireEvent.input(raw, { target: { value: '<div class="note">Bye</div>' } });
    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith('Intro  kept.\n\n<div class="note">Bye</div>\n\n* star\n'),
    );
  });

  it('falls back to Source when most of the body cannot be kept exactly', async () => {
    renderBody('<div>a</div>\n\n<div>b</div>\n\ntext\n');
    expect(await screen.findByText(/can't keep exactly; editing as source/)).toBeDefined();
    expect((screen.getByLabelText(/^Body/) as HTMLTextAreaElement).value).toBe(
      '<div>a</div>\n\n<div>b</div>\n\ntext\n',
    );
  });

  it('inserts an image from the media picker with a src relative to the entry, and shows its preview', async () => {
    const { onChange } = renderBody('Text\n');
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Image' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Alt text'), { target: { value: 'A cover' } });
    fireEvent.click(within(dialog).getByTitle('cms/content/post/hello-world/cover.webp'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('![A cover](hello-world/cover.webp)Text\n'));
    const area = await editable();
    await waitFor(() =>
      expect(within(area).getByTestId('preview').getAttribute('data-path')).toBe(
        'cms/content/post/hello-world/cover.webp',
      ),
    );
  });

  it('the image dialog is a second modal over the Body’s: Escape closes only it, a pick inserts the image', async () => {
    const { onChange } = renderBody('Text\n', ctx({ contentDir: 'cms/content' }), true);
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Image' }));
    const picker = await screen.findByRole('dialog', { name: 'Insert image' });
    expect(within(picker).getByRole('button', { name: 'cover.webp, post/hello-world' })).toBeDefined();
    fireEvent.keyDown(picker, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Insert image' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Body' })).toBeDefined();

    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Image' }));
    const again = await screen.findByRole('dialog', { name: 'Insert image' });
    fireEvent.change(within(again).getByLabelText('Alt text'), { target: { value: 'A cover' } });
    fireEvent.click(within(again).getByTitle('cms/content/post/hello-world/cover.webp'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('![A cover](hello-world/cover.webp)Text\n'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Insert image' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Body' })).toBeDefined();
  });

  it('refuses javascript: links', async () => {
    renderBody('Text\n');
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(await within(dialog).findByText(/Use a web address/)).toBeDefined();
  });

  it('adds a link with its text at the cursor', async () => {
    const { onChange } = renderBody('Text\n');
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Link' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('URL'), { target: { value: 'https://editlet.dev' } });
    fireEvent.change(within(dialog).getByLabelText('Text'), { target: { value: 'Editlet' } });
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' })));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('[Editlet](https://editlet.dev)Text\n'));
  });

  it('reloads the document when the value changes from outside (Source edits)', async () => {
    renderBody('First\n');
    await toolbar();
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    fireEvent.change(screen.getByLabelText(/^Body/), { target: { value: '## Second\n' } });
    fireEvent.click(screen.getByRole('tab', { name: 'Rich' }));
    const area = await editable();
    await waitFor(() => expect(area.querySelector('h2')?.textContent).toBe('Second'));
  });
  it('uploads an image from the image dialog and inserts it; a failed upload shows the error', async () => {
    const stageUpload = vi
      .fn<(file: File) => Promise<string>>()
      .mockRejectedValueOnce(new Error('Too big'))
      .mockResolvedValueOnce('hello-world/new.png');
    const { onChange } = renderBody('Text\n', ctx({ stageUpload }));
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Image' }));
    const dialog = await screen.findByRole('dialog');
    const file = new File(['x'], 'new.png', { type: 'image/png' });
    fireEvent.change(within(dialog).getByTestId('media-picker-file'), { target: { files: [file] } });
    expect(await within(dialog).findByText('Too big')).toBeDefined();
    fireEvent.change(within(dialog).getByLabelText('Alt text'), { target: { value: 'New' } });
    fireEvent.change(within(dialog).getByTestId('media-picker-file'), { target: { files: [file] } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('![New](hello-world/new.png)Text\n'));
    expect(stageUpload).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses an image address that is not allowed', async () => {
    renderBody('Text\n', ctx({ toSrc: () => 'javascript:alert(1)' }));
    fireEvent.click(within(await toolbar()).getByRole('button', { name: 'Image' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByTitle('cms/content/post/hello-world/cover.webp'));
    expect(await within(dialog).findByText('This image address is not allowed')).toBeDefined();
  });

  it('opens the link sheet with Mod-K and closes it with ×', async () => {
    const { onChange } = renderBody('Text\n');
    const area = await editable();
    fireEvent.keyDown(area, { key: 'k', ctrlKey: true });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add link' })).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes the block type, inserts a divider and a table with row and column tools', async () => {
    const { onChange } = renderBody('Text\n');
    const bar = await toolbar();
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Block type' }), { target: { value: 'h2' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('## Text\n'));
    fireEvent.change(within(bar).getByRole('combobox', { name: 'Block type' }), { target: { value: 'paragraph' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Text\n'));
    fireEvent.click(within(bar).getByRole('button', { name: 'Table' }));
    expect(await within(bar).findByRole('button', { name: 'Add row' })).toBeDefined();
    const last = () => String(onChange.mock.lastCall?.[0] ?? '');
    const rows = () =>
      last()
        .split('\n')
        .filter((l) => l.startsWith('|')).length;
    const before = rows();
    fireEvent.click(within(bar).getByRole('button', { name: 'Add row' }));
    await waitFor(() => expect(rows()).toBe(before + 1));
    fireEvent.click(within(bar).getByRole('button', { name: 'Add column' }));
    await waitFor(() => expect(last().split('\n')[0]!.split('|')).toHaveLength(6));
  });

  it('gives select-to-edit the text it shows and selects the matched words', async () => {
    const selectTarget = vi.fn();
    renderBody('**Bold** plain\n', ctx({ selectTarget }));
    const bar = await toolbar();
    const target = await waitFor(() => {
      const fn = selectTarget.mock.calls.findLast(([name, t]) => name === 'body' && t)?.[1];
      expect(fn).toBeTypeOf('function');
      return fn as () => Promise<{ text: string; select(start: number, end: number): void } | null>;
    });
    const projection = (await target())!;
    expect(projection.text).toBe('Bold plain');
    act(() => projection.select(0, 4));
    await waitFor(() =>
      expect(within(bar).getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe('true'),
    );
  });

  it('calls onBlur only when focus leaves the whole editor', async () => {
    const onBlur = vi.fn();
    render(
      <MarkdownField
        name="body"
        field={{ type: 'markdown', label: 'Body' }}
        value="Text\n"
        onChange={() => {}}
        onBlur={onBlur}
        ctx={ctx()}
      />,
    );
    const area = await editable();
    const bold = within(await toolbar()).getByRole('button', { name: 'Bold' });
    fireEvent.blur(area, { relatedTarget: bold });
    expect(onBlur).not.toHaveBeenCalled();
    fireEvent.blur(area, { relatedTarget: null });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
