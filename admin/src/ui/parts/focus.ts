import type { Drawer } from '@base-ui/react/drawer';
import type { ComponentProps, RefObject } from 'react';

/**
 * Where the focus goes when a modal closes (Base UI's `finalFocus`): `true` (the default) is the element that had it, or
 * the trigger; `false` nothing; a ref or a function (told how it closed: `'pointer' | 'keyboard' | 'touch'`…) names an
 * element, or `true`/`undefined` for the default. A modal opened from a ⋯ row has no trigger, and the browser's focus
 * on the row that was tapped is not reliable (Safari does not focus a tapped button), so it names ⋯ itself.
 */
export type FinalFocus = ComponentProps<typeof Drawer.Popup>['finalFocus'];

/**
 * `finalFocus` for the ⋯ action sheet: ⋯, unless the focus has already moved into another modal. Base UI returns the focus
 * once the sheet's exit animation ends, a few hundred ms after the row was pressed; the modal that row opened (Details,
 * Rename…, a confirm) has the focus by then, and a ref `finalFocus` would pull it out to the hidden ⋯. When the sheet
 * closes by itself (Escape, Cancel, a row that opens nothing) the focus is still inside it, and ⋯ gets it.
 */
export function returnToUnlessModal(target: RefObject<HTMLElement | null>): FinalFocus {
  return () => {
    const active = document.activeElement;
    const inOtherModal =
      !!active?.closest('[role="dialog"], [role="alertdialog"]') && !active.closest('[data-slot="action-sheet"]');
    return inOtherModal ? false : (target.current ?? true);
  };
}
