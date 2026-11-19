import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Icon } from './icon';
import { ICONS } from './icons';

describe('Icon', () => {
  it('draws the named path on the 24 grid in currentColor, hidden from assistive technology', () => {
    const { container } = render(<Icon name="plus" size={16} className="x" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBe(false);
    expect(svg.getAttribute('class')).toBe('x');
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(container.querySelector('path')!.getAttribute('d')).toBe(ICONS.plus);
  });

  it('with a label is an image with that name', () => {
    const { getByRole, container } = render(<Icon name="alert" label="Warning" strokeWidth={1.5} />);
    expect(getByRole('img', { name: 'Warning' })).toBeDefined();
    const svg = container.querySelector('svg')!;
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('stroke-width')).toBe('1.5');
  });
});
