import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Avatar } from './avatar';

/** jsdom loads no images: this `Image` reports a load or an error for the URL, as a browser would. */
function stubImage(outcome: 'load' | 'error') {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_url: string) {
      setTimeout(() => (outcome === 'load' ? this.onload : this.onerror)?.(), 0);
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

afterEach(() => vi.unstubAllGlobals());

describe('Avatar', () => {
  it('shows the first letter of the name until the picture has loaded, then the picture', async () => {
    stubImage('load');
    const { container } = render(<Avatar name="octocat" src="https://avatars.test/octocat.png" />);
    expect(screen.getByText('O')).toBeDefined();
    await waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('https://avatars.test/octocat.png'),
    );
    expect(screen.queryByText('O')).toBeNull();
  });

  it('keeps the letter when the picture does not load', async () => {
    stubImage('error');
    const { container } = render(<Avatar name="octocat" src="https://avatars.test/octocat.png" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('O')).toBeDefined();
  });
});
