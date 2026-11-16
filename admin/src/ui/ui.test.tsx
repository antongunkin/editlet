import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './Button';
import { cn } from './cn';
import { Dialog, DialogContent, DialogEdges, DialogFooter, DialogHeader, DialogTitle } from './Dialog';
import { Field } from './Field';
import { StatusBadge } from './StatusBadge';
import { Switcher, SwitcherItem } from './Switcher';

describe('cn', () => {
  it('joins truthy classes from strings, arrays and objects', () => {
    expect(cn('a', false, ['b', null], { c: true, d: false })).toBe('a b c');
  });
});

describe('Button', () => {
  it('renders the variant and size classes', () => {
    render(
      <Button variant="primary" size="sm">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.className).toContain('editlet-button');
    expect(button.className).toContain('editlet-button--primary');
    expect(button.className).toContain('editlet-button--sm');
    expect(button.getAttribute('type')).toBe('button');
  });
});

describe('Dialog', () => {
  it('shows its content when open and calls onOpenChange(false) from the close button', () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog open={false} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
          </DialogHeader>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText('Review changes')).toBeNull();

    rerender(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review changes</DialogTitle>
          </DialogHeader>
          <DialogFooter>Footer</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText('Review changes')).toBeDefined();
    expect(screen.getByRole('dialog', { hidden: true }).hasAttribute('open')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Title</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('draws the window edges on its sheet, so the window resizes while it is open', () => {
    render(
      <DialogEdges.Provider value={<div data-testid="edge" />}>
        <Dialog open onOpenChange={() => {}}>
          <DialogContent>
            <DialogTitle>Gallery</DialogTitle>
          </DialogContent>
        </Dialog>
      </DialogEdges.Provider>,
    );
    const edge = screen.getByTestId('edge');
    expect(edge.parentElement).toBe(screen.getByRole('dialog', { hidden: true }));
  });

  it('an alertdialog has no close button, ignores a click around it and closes on Escape', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent role="alertdialog">
          <DialogTitle>Remove image?</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(dialog);
    fireEvent.click(dialog.querySelector('.editlet-dialog__scroll')!);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Field', () => {
  it('shows the error text and the required marker', () => {
    render(
      <Field label="Title" htmlFor="title" required error="Required" hint="Shown in lists">
        <input id="title" />
      </Field>,
    );
    expect(screen.getByText('*').className).toBe('editlet-field__required');
    expect(screen.getByRole('alert').textContent).toContain('Required');
    expect(screen.getByLabelText(/Title/)).toBeDefined();
    // The hint sits in the same label as the name, on the same line.
    const hint = screen.getByText('Shown in lists');
    expect(hint.closest('label')).toBe(screen.getByText('Title', { exact: false }).closest('label'));
  });

  it('omits the required marker and error when not given', () => {
    render(
      <Field label="Summary">
        <input />
      </Field>,
    );
    expect(screen.queryByText('*')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('StatusBadge', () => {
  it('renders Draft only for drafts', () => {
    const { rerender } = render(<StatusBadge draft />);
    expect(screen.getByText('Draft')).toBeDefined();
    rerender(<StatusBadge draft={false} />);
    expect(screen.queryByText('Draft')).toBeNull();
  });
});

function renderSwitcher(onKeyDown = vi.fn(), disabled = false) {
  const onClick = vi.fn();
  render(
    <Switcher aria-label="Mode" onKeyDown={onKeyDown}>
      <SwitcherItem active onClick={() => onClick('a')}>
        A
      </SwitcherItem>
      <SwitcherItem disabled={disabled} onClick={() => onClick('b')}>
        B
      </SwitcherItem>
      <SwitcherItem icon onClick={() => onClick('c')}>
        C
      </SwitcherItem>
    </Switcher>,
  );
  return { onClick, onKeyDown, tab: (name: string) => screen.getByRole('tab', { name }) };
}

describe('Switcher', () => {
  it('renders a tablist of buttons that mark the active one', () => {
    const { tab } = renderSwitcher();
    expect(screen.getByRole('tablist', { name: 'Mode' }).className).toBe('editlet-switcher');
    expect(tab('A').getAttribute('aria-selected')).toBe('true');
    expect(tab('A').dataset.state).toBe('active');
    expect(tab('B').dataset.state).toBe('inactive');
    expect(tab('A').getAttribute('type')).toBe('button');
    expect(tab('C').className).toBe('editlet-switcher__item editlet-switcher__item--icon');
  });

  it('moves focus and selection with the arrows, Home and End, wrapping around', () => {
    const { onClick, onKeyDown, tab } = renderSwitcher();
    const list = screen.getByRole('tablist');
    tab('A').focus();
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tab('C'));
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('A'));
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(tab('C'));
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(tab('A'));
    expect(onClick.mock.calls.map(([v]) => v)).toEqual(['c', 'a', 'c', 'a']);
    expect(onKeyDown).toHaveBeenCalledTimes(4);
  });

  it('skips disabled items and passes other keys through untouched', () => {
    const { onClick, onKeyDown, tab } = renderSwitcher(vi.fn(), true);
    expect(tab('B').hasAttribute('data-disabled')).toBe(true);
    tab('A').focus();
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tab('C'));
    onClick.mockClear();
    const enter = fireEvent.keyDown(screen.getByRole('tablist'), { key: 'Enter' });
    expect(enter).toBe(true);
    expect(onClick).not.toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalledTimes(2);
  });

  it('passes keys through when it has no enabled items', () => {
    const onKeyDown = vi.fn();
    render(
      <Switcher onKeyDown={onKeyDown}>
        <SwitcherItem disabled>Only</SwitcherItem>
      </Switcher>,
    );
    expect(fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' })).toBe(true);
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
