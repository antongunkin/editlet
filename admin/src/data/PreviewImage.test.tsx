import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BIG_PREVIEW, ImagePlaceholder, PreviewImage } from './PreviewImage';

describe('PreviewImage', () => {
  it('has no size of its own: the rich text body styles its images (a regression in 4.3 cropped them to 160 px)', () => {
    render(<PreviewImage url="blob:x" alt="A cat" />);
    const img = screen.getByRole('img', { name: 'A cat' });
    expect(img.getAttribute('class')).toBeNull();
  });

  it('takes the size of the call site', () => {
    render(<PreviewImage url="blob:x" alt="A cat" className={BIG_PREVIEW} />);
    expect(screen.getByRole('img', { name: 'A cat' }).className).toContain('h-40');
  });

  it('shows a small placeholder, or one the call site sizes', () => {
    const { rerender } = render(<ImagePlaceholder alt="" />);
    expect(screen.getByRole('img', { name: 'No image' }).className).toContain('w-24');
    rerender(<ImagePlaceholder alt="Missing" className={BIG_PREVIEW} />);
    expect(screen.getByRole('img', { name: 'Missing' }).className).toContain('h-40');
  });
});
