import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { cn } from './cn';
import { Field } from './Field';
import { Button } from './primitives/button';
import { StatusBadge } from './StatusBadge';
import { Switcher, SwitcherItem } from './Switcher';

describe('cn', () => {
  it('joins truthy classes from strings, arrays and objects', () => {
    expect(cn('a', false, ['b', null], { c: true, d: false })).toBe('a b c');
  });
});

describe('Button', () => {
  it('renders a button of type button with its label', () => {
    render(
      <Button variant="primary" size="sm">
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button.getAttribute('type')).toBe('button');
  });
});

describe('Field', () => {
  it('shows the error text and the required marker', () => {
    render(
      <Field label="Title" htmlFor="title" required error="Required" hint="Shown in lists">
        <input id="title" />
      </Field>,
    );
    expect(screen.getByText('*').getAttribute('aria-hidden')).toBe('true');
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

  it('a file status wins over Draft and Published, in its tone', () => {
    const { rerender, container } = render(<StatusBadge draft status="changed" showPublished />);
    expect(container.textContent).toBe('Changed');
    expect(container.querySelector('[data-slot="badge"]')?.className).toContain('unsaved');
    rerender(<StatusBadge status="review" />);
    expect(container.textContent).toBe('In review');
    rerender(<StatusBadge status="unsaved" />);
    expect(container.textContent).toBe('Unsaved');
    rerender(<StatusBadge draft status={null} />);
    expect(container.textContent).toBe('Draft');
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
      <SwitcherItem onClick={() => onClick('c')}>C</SwitcherItem>
    </Switcher>,
  );
  return { onClick, onKeyDown, tab: (name: string) => screen.getByRole('tab', { name }) };
}

describe('Switcher', () => {
  it('renders a tablist of buttons that mark the active one', () => {
    const { tab } = renderSwitcher();
    expect(tab('A').getAttribute('aria-selected')).toBe('true');
    expect(tab('B').getAttribute('aria-selected')).toBe('false');
    expect(tab('A').getAttribute('type')).toBe('button');
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
