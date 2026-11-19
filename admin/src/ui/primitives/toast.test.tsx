import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Toaster, toastManager } from './toast';

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
