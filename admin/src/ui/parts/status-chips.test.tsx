import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BottomBar } from './bottom-bar';
import { BranchChip, ChangesChip, StatusChip, StatusChips } from './status-chips';

// jsdom computes no CSS: these check names, descriptions and the utilities that carry the bar's geometry. The values
// themselves are checked in a browser by src/design/e2e/bars.e2e.ts.

/** The accessible description: the text of the elements `aria-describedby` names. */
const description = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('status chips', () => {
  it('a labelled BranchChip is the Branch button, described by the whole branch line', () => {
    const onClick = vi.fn();
    render(<BranchChip name="main" suffix="live" description="main · live" aria-label="Branch" onClick={onClick} />);
    const chip = screen.getByRole('button', { name: 'Branch' });
    expect(description(chip)).toBe('main · live');
    // What it shows: the name and the muted suffix; the description is not drawn.
    expect(chip.textContent).toBe('main live');
    fireEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a BranchChip without a description is described by its name; without a label it is named by its text', () => {
    const { rerender } = render(<BranchChip name="editlet/spring" suffix="#1" aria-label="Branch" />);
    expect(description(screen.getByRole('button', { name: 'Branch' }))).toBe('editlet/spring');
    rerender(<BranchChip name="editlet/spring" suffix="#1" />);
    const chip = screen.getByRole('button', { name: 'editlet/spring #1' });
    expect(chip.hasAttribute('aria-describedby')).toBe(false);
  });

  it('the BranchChip gives way: it may shrink, and its name is cut with an ellipsis', () => {
    render(<BranchChip name="editlet/a-very-long-branch-name" aria-label="Branch" />);
    const chip = screen.getByRole('button', { name: 'Branch' });
    expect(chip.className).toMatch(/(^|\s)shrink(\s|$)/);
    expect(chip.className).not.toMatch(/shrink-0/);
    expect(within(chip).getByText('editlet/a-very-long-branch-name').className).toMatch(/truncate/);
  });

  it('the chips that are buttons grow their 44 px target upward only, never below the pill', () => {
    render(
      <>
        <BranchChip name="main" aria-label="Branch" />
        <ChangesChip>2 unsaved</ChangesChip>
      </>,
    );
    for (const chip of screen.getAllByRole('button')) {
      expect(chip.className).toMatch(/h-11/);
      expect(chip.className).toMatch(/-mt-3/);
      expect(chip.className).not.toMatch(/-my-|-mb-/);
    }
  });

  it('a ChangesChip is a button named by its count, with a decorative dot', () => {
    const onClick = vi.fn();
    render(<ChangesChip onClick={onClick}>Unsaved changes (2)</ChangesChip>);
    fireEvent.click(screen.getByRole('button', { name: 'Unsaved changes (2)' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a StatusChip is not a control: its words, on the tone’s tint, with the tone’s mark or a given icon', () => {
    const { container, rerender } = render(<StatusChip tone="success">Saved · 1 commit</StatusChip>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Saved · 1 commit')).toBeDefined();
    expect(container.firstElementChild!.className).toMatch(/bg-tint-success/);
    expect(container.querySelector('[data-icon="check"]')).not.toBeNull();
    rerender(
      <StatusChip tone="unsaved" icon={<svg data-testid="upload" />}>
        e2e.png · uploads when you save
      </StatusChip>,
    );
    expect(screen.getByTestId('upload')).toBeDefined();
    expect(container.firstElementChild!.className).toMatch(/bg-tint-unsaved/);
  });

  it('StatusChips lays the chips out in a wrapping row', () => {
    const { container } = render(
      <StatusChips>
        <StatusChip tone="danger">Offline</StatusChip>
      </StatusChips>,
    );
    expect(container.firstElementChild!.className).toMatch(/flex-wrap/);
  });
});

describe('BottomBar', () => {
  it('holds the status line, then the action row', () => {
    render(
      <BottomBar status={<StatusChip tone="danger">Offline</StatusChip>}>
        <button type="button">Save 2 changes</button>
      </BottomBar>,
    );
    const bar = screen.getByText('Offline').closest('[data-slot="bottom-bar"]')!;
    expect(bar.textContent).toBe('OfflineSave 2 changes');
  });

  it('pads past the safe area and keeps the keyboard’s height below itself', () => {
    const { container } = render(<BottomBar status="main" />);
    const bar = container.firstElementChild as HTMLElement;
    expect(bar.className.split(' ')).toEqual(expect.arrayContaining(['pb-safe', 'mb-keyboard', 'shadow-bottom-bar']));
    // No action row without an action.
    expect(bar.children).toHaveLength(0);
  });
});
