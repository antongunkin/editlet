import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Banner, BannerRegion } from './banner';

/** Text nodes added under `root`, as an assistive technology watching a live region would see them. */
function watchAdditions(root: Element) {
  const added: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((n) => {
        const text = n.textContent?.trim();
        if (text) added.push(text);
      });
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return { added, stop: () => observer.disconnect(), flush: () => observer.takeRecords() };
}

describe('BannerRegion', () => {
  it('is a live region on the page before any banner comes into it, polite or assertive, with no role of its own', () => {
    const { container, rerender } = render(<BannerRegion />);
    const region = container.firstElementChild!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.hasAttribute('role')).toBe(false);
    expect(region.childElementCount).toBe(0);
    rerender(<BannerRegion assertive />);
    expect(container.firstElementChild).toBe(region);
    expect(region.getAttribute('aria-live')).toBe('assertive');
  });

  it('adds a banner to the same region once, and an unchanged message is not announced again', async () => {
    const { container, rerender } = render(<BannerRegion>{null}</BannerRegion>);
    const region = container.firstElementChild!;
    const watcher = watchAdditions(region);
    const withBanner = (
      <BannerRegion>
        <Banner tone="danger">Not connected to the site</Banner>
      </BannerRegion>
    );
    await act(async () => rerender(withBanner));
    await act(async () => rerender(withBanner));
    watcher.flush().forEach((r) => r.addedNodes.forEach((n) => watcher.added.push(n.textContent ?? '')));
    watcher.stop();
    expect(container.firstElementChild).toBe(region);
    expect(screen.getAllByText('Not connected to the site')).toHaveLength(1);
    // One insertion of the banner (its text arrives inside it), not one per render.
    expect(watcher.added.filter((t) => t.includes('Not connected'))).toHaveLength(1);
  });
});

describe('Banner', () => {
  it('says its state in words and draws the tone icon as decoration', () => {
    const { container } = render(<Banner tone="success">Published.</Banner>);
    expect(screen.getByText('Published.')).toBeDefined();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
