import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sheet, SheetProvider } from './sheet';

/** Five sheets, each inside the one before (a picker, the entry on top, its field, an object, a field of it). */
function Nested({ depth }: { depth: number }) {
  return (
    <Sheet open title={`Level ${depth}`}>
      {depth < 5 ? <Nested depth={depth + 1} /> : null}
    </Sheet>
  );
}

describe('the sheet levels', () => {
  it('step 20 px down per level from 64 px, four steps (64, 84, 104, 124); deeper ones stay at 124', () => {
    render(
      <SheetProvider>
        <Nested depth={1} />
      </SheetProvider>,
    );
    const tops = [...document.querySelectorAll('[class*="pt-"]')]
      .map((el) => /\bpt-(16|21|26|31)\b/.exec(el.className)?.[1])
      .filter(Boolean);
    expect(tops).toEqual(['16', '21', '26', '31', '31']);
  });
});
