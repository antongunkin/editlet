import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Card } from './card';
import { ActionRow, BlockRow, FieldRow, Option, PromptRow, Row, SelectedRow, StepRow } from './rows';

describe('rows', () => {
  it('a Row is one button: its name is the title and the line, and it opens on a click', () => {
    const onClick = vi.fn();
    render(<Row title="Tires for a rigid bike" sub="Post · 2h ago" lead="file" onClick={onClick} />);
    fireEvent.click(screen.getByRole('button', { name: /Tires for a rigid bike/ }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a loading Row says Loading in words and is busy, and is not a control', () => {
    const { container } = render(<Row title="Tires" loading />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Loading…')).toBeDefined();
    expect(container.querySelector('[data-slot="row"]')?.getAttribute('aria-busy')).toBe('true');
  });

  it('a FieldRow says its state in words: required, changed, invalid, read-only', () => {
    const { rerender } = render(<FieldRow label="Title" required value="Tires" changed />);
    expect(screen.getByRole('button', { name: /Title \*.*Changed.*Tires/ })).toBeDefined();
    rerender(<FieldRow label="Title" required invalid />);
    expect(screen.getByRole('button', { name: /Title \*.*Required.*Required/ })).toBeDefined();
    rerender(<FieldRow label="Slug" value="tires" readOnly />);
    expect(screen.getByRole('button', { name: /read-only/ })).toBeDefined();
  });

  it('a FieldRow with its own control (a switch) is not a button, so nothing is nested', () => {
    render(<FieldRow label="Show in the header" value="Yes" trailing={<button type="button">Toggle</button>} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('an Option is a radio, or a checkbox when several can be chosen, and says if it is chosen', () => {
    const { rerender } = render(<Option title="Mo Haddad" selected />);
    expect(screen.getByRole('radio', { name: 'Mo Haddad' }).getAttribute('aria-checked')).toBe('true');
    rerender(<Option title="Mo Haddad" multi />);
    expect(screen.getByRole('checkbox', { name: 'Mo Haddad' }).getAttribute('aria-checked')).toBe('false');
  });

  it('a SelectedRow removes its entry with a named button; a missing one is the same row', () => {
    const onRemove = vi.fn();
    render(<SelectedRow title="question/gone" sub="Not found" missing onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove question/gone' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('a BlockRow moves from the keyboard: arrow up -1, arrow down +1, nothing else', () => {
    const onMove = vi.fn();
    render(<BlockRow title="Hero" kind="type" onMove={onMove} />);
    const grip = screen.getByRole('button', { name: /Move Hero/ });
    fireEvent.keyDown(grip, { key: 'ArrowUp' });
    fireEvent.keyDown(grip, { key: 'ArrowDown' });
    fireEvent.keyDown(grip, { key: 'Enter' });
    expect(onMove.mock.calls).toEqual([[-1], [1]]);
  });

  it('a StepRow says where it stands, a danger ActionRow is a button, a Card holds rows', () => {
    render(
      <Card>
        <StepRow title="Review" kind="fail" />
        <ActionRow icon="trash" danger>
          Delete…
        </ActionRow>
      </Card>,
    );
    expect(screen.getByText('Failed')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeDefined();
  });
});

describe('row states', () => {
  it('only a row that is itself the control has hover and pressed; a selected Row is the current one', () => {
    const { container, rerender } = render(<StepRow title="Review" kind="todo" />);
    expect(container.firstElementChild!.className).not.toContain('hovered:');
    rerender(<SelectedRow title="Tires" />);
    expect(container.firstElementChild!.className).not.toContain('pressed:');
    rerender(<Row title="Tires" selected />);
    const row = screen.getByRole('button', { name: 'Tires' });
    expect(row.className).toContain('hovered:');
    expect(row.getAttribute('aria-current')).toBe('true');
  });
});

describe('PromptRow', () => {
  it('its Copy button is described by the title, and a copy is announced in a live region', () => {
    const { rerender } = render(<PromptRow title="Add a field" body="Add an optional string field." />);
    expect(screen.getByRole('button', { name: 'Copy', description: 'Add a field' })).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('');
    rerender(<PromptRow title="Add a field" body="Add an optional string field." copied />);
    expect(screen.getByRole('status').textContent).toBe('Copied to clipboard');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeDefined();
  });
});
