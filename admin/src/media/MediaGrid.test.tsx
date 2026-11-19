import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MediaTile } from './MediaGrid';

describe('MediaTile caption', () => {
  it('wraps the name at a word and keeps the folder on one line, with the whole folder as its tooltip', () => {
    render(
      <MediaTile
        preview={<span />}
        label="trek-950-1991.webp"
        path="bike/trek-950-1991/trek-950-1991.webp"
        caption={{ name: 'trek-950-1991.webp', folder: 'bike/trek-950-1991' }}
      />,
    );
    const name = screen.getByText('trek-950-1991.webp');
    const folder = screen.getByText('bike/trek-950-1991');
    expect(name.classList.contains('wrap-break-word')).toBe(true);
    expect(name.classList.contains('break-all')).toBe(false);
    expect(folder.classList.contains('truncate')).toBe(true);
    expect(folder.classList.contains('break-all')).toBe(false);
    expect(folder.getAttribute('title')).toBe('bike/trek-950-1991');
  });

  it('draws no caption without one', () => {
    render(<MediaTile preview={<span />} label="a.webp" path="a.webp" />);
    expect(screen.queryByText('a.webp')).toBeNull();
  });
});
