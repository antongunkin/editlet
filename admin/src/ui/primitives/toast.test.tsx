import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToastView, Toaster, toastManager } from './toast';

afterEach(() => {
  act(() => toastManager.close());
});

describe('Toaster', () => {
  it('has its live region on the page from the start, and a toast added later appears in it once', async () => {
    const { container } = render(<Toaster />);
    // Base UI's viewport is the region (and a polite announcer next to it); it exists before any toast.
    expect(container.querySelector('[aria-live], [role="region"]')).not.toBeNull();
    expect(screen.queryByText('Saved · 1 commit')).toBeNull();
    await act(async () => {
      toastManager.add({ title: 'Saved · 1 commit' });
    });
    expect(screen.getAllByText('Saved · 1 commit').length).toBeGreaterThanOrEqual(1);
    const inViewport = Array.from(container.querySelectorAll('[data-slot="toast"]')).filter((el) =>
      el.textContent?.includes('Saved · 1 commit'),
    );
    expect(inViewport).toHaveLength(1);
  });
});

describe('the toast icon follows its type', () => {
  const iconOf = (title: string) => {
    const toast = screen
      .getAllByText(title)
      .map((el) => el.closest('[data-slot="toast"]'))
      .find(Boolean)!;
    const icon = toast.querySelector('[data-icon]')!;
    return { name: icon.getAttribute('data-icon'), tone: icon.getAttribute('class') ?? '' };
  };

  it.each([
    [undefined, 'check-circle', 'text-chart-2'],
    ['copy', 'copy', 'text-foreground'],
    ['error', 'alert', 'text-destructive'],
  ])('type %s draws %s in %s', async (type, name, tone) => {
    render(<Toaster />);
    await act(async () => {
      toastManager.add({ title: `Toast ${String(type)}`, type });
    });
    const icon = iconOf(`Toast ${String(type)}`);
    expect(icon.name).toBe(name);
    expect(icon.tone.split(' ')).toContain(tone);
  });

  it('ToastView takes an icon on its own (the /design boards draw it so)', () => {
    render(<ToastView icon={{ name: 'copy', tone: 'foreground' }}>Duplicated</ToastView>);
    expect(
      screen.getByText('Duplicated').closest('[data-slot="toast"]')!.querySelector('[data-icon="copy"]'),
    ).not.toBeNull();
  });
});
