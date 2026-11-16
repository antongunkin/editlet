import { describe, expect, it } from 'vitest';

import { assetUrl } from './assetUrl';

const post = { collection: 'post' };

describe('assetUrl', () => {
  it('resolves relative sources below the content URL', () => {
    expect(assetUrl(post, 'hello-world/cover.webp')).toBe('/editlet/content/post/hello-world/cover.webp');
    expect(assetUrl(post, '../images/a.png')).toBe('/editlet/content/images/a.png');
  });

  it.each(['../../x.png', 'https://x.dev/a.png', '/a.png', '#top', 'mailto:a@b.c', ''])('keeps %j unchanged', (src) => {
    expect(assetUrl(post, src)).toBe(src);
  });
});
