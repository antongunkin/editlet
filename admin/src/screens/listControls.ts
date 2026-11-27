import type { KeyboardEvent } from 'react';

// What the admin's lists of rows share: the page size and the keys of a list of radio rows. Apart from the screens, so
// the collection list, the field modals and the reference picker import it without importing each other.

/** Rows shown at a time; *Show 20 more* shows the next ones. */
export const PAGE_SIZE = 20;

/** The slug of a ref (`collection/slug`): what an entry shows under until its title is there. */
export const slugOf = (ref: string) => ref.slice(ref.indexOf('/') + 1);

const RADIO_KEYS: Record<string, (i: number, n: number) => number> = {
  ArrowDown: (i, n) => (i + 1) % n,
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowUp: (i, n) => (i - 1 + n) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
};

/**
 * A list of options in a modal is one tab stop (the chosen option, else the first): the arrow keys, Home and End move
 * the focus, Space or Enter chooses. Choosing closes the modal, so the focus moving does not choose (unlike a plain radio
 * group, where it would close the modal on the first arrow press).
 */
export function moveAmongRadios(e: KeyboardEvent<HTMLElement>) {
  const step = RADIO_KEYS[e.key];
  if (!step) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')];
  if (radios.length === 0) return;
  e.preventDefault();
  radios[step(Math.max(0, radios.indexOf(document.activeElement as HTMLElement)), radios.length)]?.focus();
}

/** The option's tab stop: the chosen one, else the first. */
export const radioTab = (selected: boolean, first: boolean, any: boolean) => (selected || (!any && first) ? 0 : -1);
