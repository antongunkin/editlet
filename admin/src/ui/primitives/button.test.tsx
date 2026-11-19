import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from './button';
import { IconButton } from './icon-button';

describe('Button', () => {
  it('is a native button of type button by default', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('type')).toBe('button');
  });

  it('loading: busy, shows the busy label, stays focusable, and a click does nothing', () => {
    const onClick = vi.fn();
    render(
      <Button loading busyLabel="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Saving…' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('disabled: not clickable', () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is named by its label, also as the tooltip', () => {
    render(<IconButton icon={<svg />} label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' }).getAttribute('title')).toBe('Close');
  });

  it('needs a label', () => {
    /* oxlint-disable jsx-a11y/control-has-associated-label -- the missing label is what this test is about */
    // @ts-expect-error label is required: no icon button is unnamed
    render(<IconButton icon={<svg />} />);
    /* oxlint-enable jsx-a11y/control-has-associated-label */
  });
});
