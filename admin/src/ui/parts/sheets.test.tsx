import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ActionSheet } from './action-sheet';
import { Confirm, type ConfirmProps } from './confirm';
import { ActionRow } from './rows';
import { Sheet } from './sheet';

function Harness(props: Partial<ConfirmProps>) {
  const [open, setOpen] = useState(true);
  return (
    <Confirm
      open={open}
      onOpenChange={setOpen}
      title="Delete this post?"
      description="Git history keeps it."
      confirmLabel="Delete post"
      onConfirm={() => {}}
      {...props}
    />
  );
}

describe('Confirm', () => {
  it('is an alertdialog named by its title and text, with the focus on Cancel', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this post?' });
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' })));
  });

  it('confirm calls onConfirm and closes; Cancel closes without it', async () => {
    const onConfirm = vi.fn();
    const { unmount } = render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete post' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    unmount();

    render(<Harness onConfirm={onConfirm} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('with `pending` defined it stays open on confirm, and the confirm button is disabled while pending', async () => {
    const onConfirm = vi.fn();
    const { rerender } = render(<Harness pending={false} onConfirm={onConfirm} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete post' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alertdialog')).toBeDefined();
    rerender(<Harness pending onConfirm={onConfirm} />);
    expect(screen.getByRole('button', { name: 'Delete post' })).toHaveProperty('disabled', true);
  });

  it('confirmDisabled disables the confirm button, not Cancel', async () => {
    render(<Harness confirmDisabled />);
    expect(await screen.findByRole('button', { name: 'Delete post' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', false);
  });

  it('puts its children between the description and the buttons', async () => {
    render(
      <Harness>
        <input aria-label="Branch name" />
      </Harness>,
    );
    const dialog = await screen.findByRole('alertdialog');
    const order = [
      within(dialog).getByText('Git history keeps it.'),
      within(dialog).getByRole('textbox', { name: 'Branch name' }),
      within(dialog).getByRole('button', { name: 'Delete post' }),
      within(dialog).getByRole('button', { name: 'Cancel' }),
    ];
    for (let i = 1; i < order.length; i++)
      expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('takes `initialFocus` instead of Cancel', async () => {
    function WithField() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Harness initialFocus={ref}>
          <input ref={ref} aria-label="New slug" />
        </Harness>
      );
    }
    render(<WithField />);
    const field = await screen.findByRole('textbox', { name: 'New slug' });
    await waitFor(() => expect(document.activeElement).toBe(field));
  });

  it('a click on the scrim does not close it', async () => {
    render(<Harness />);
    await screen.findByRole('alertdialog');
    const scrim = document.querySelector('.sheet-scrim')!;
    fireEvent.pointerDown(scrim);
    fireEvent.mouseDown(scrim);
    fireEvent.click(scrim);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('alertdialog')).toBeDefined();
  });

  it('while pending, Cancel and Escape still close it (the caller decides whether to allow that)', async () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Confirm
        open
        onOpenChange={onOpenChange}
        pending
        title="Delete this post?"
        description="Git history keeps it."
        confirmLabel="Delete post"
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    onOpenChange.mockClear();
    rerender(
      <Confirm
        open
        onOpenChange={onOpenChange}
        pending
        title="Delete this post?"
        description="Git history keeps it."
        confirmLabel="Delete post"
        onConfirm={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('Escape closes it', async () => {
    render(<Harness />);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
});

describe('Sheet', () => {
  it('is a dialog named by its title, with a Close button and the focus on itself', async () => {
    render(
      <Sheet title="Edit · Title" sub="Tires for a rigid bike" defaultOpen>
        <input aria-label="Title" />
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Edit · Title' });
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(sheet));
    expect(document.activeElement).not.toBe(within(sheet).getByRole('textbox', { name: 'Title' }));
  });

  it('the handle is not a control for keys or screen readers: one Close in the tree', async () => {
    render(<Sheet title="Edit · Title" defaultOpen />);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getAllByRole('button')).toHaveLength(1);
  });

  it('`closable={false}` has no Close, and Escape leaves it open', async () => {
    const onOpenChange = vi.fn();
    render(
      <Sheet open closable={false} onOpenChange={onOpenChange} title="Sign in again">
        <button type="button">Sign in with GitHub</button>
      </Sheet>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Sign in again' });
    expect(within(sheet).queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('dialog', { name: 'Sign in again' })).toBeDefined();
  });
});

describe('ActionSheet', () => {
  it('is a dialog named by its title with the actions and Cancel', async () => {
    render(
      <ActionSheet title="Tires for a rigid bike" defaultOpen>
        <ActionRow icon="copy">Duplicate</ActionRow>
      </ActionSheet>,
    );
    const sheet = await screen.findByRole('dialog', { name: 'Tires for a rigid bike' });
    expect(within(sheet).getByRole('button', { name: 'Duplicate' })).toBeDefined();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
