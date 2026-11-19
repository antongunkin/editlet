import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Progress } from './progress';

const fill = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-slot="progress"] > div')!;

describe('Progress', () => {
  it('is decorative: hidden from assistive technology, with no role', () => {
    const { container } = render(<Progress value={3} max={12} />);
    const track = container.querySelector('[data-slot="progress"]')!;
    expect(track.getAttribute('aria-hidden')).toBe('true');
    expect(track.hasAttribute('role')).toBe(false);
  });

  it('fills value of max, and stays inside 0…100 %', () => {
    expect(fill(render(<Progress value={3} max={12} />).container).style.width).toBe('25%');
    expect(fill(render(<Progress value={20} max={12} />).container).style.width).toBe('100%');
    expect(fill(render(<Progress value={-1} max={12} />).container).style.width).toBe('0%');
    expect(fill(render(<Progress value={1} max={0} />).container).style.width).toBe('0%');
  });
});
