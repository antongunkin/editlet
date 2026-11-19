// What the editor last used: a finger or a mouse (`pointer`) or the keyboard (`keyboard`), as `data-editlet-modality` on
// `<html>`. app.css's `focused:` variants draw the 2 px focus ring unless it says `pointer`: a text field is always
// `:focus-visible`, so without this a tap on a field would draw the ring, which the design draws only for the keyboard
// (a tap shows the caret). A bare `focus()` (a sheet closing, a script) changes nothing: the last input decides.
// `/design` does not call it: its boards draw states with `data-state`.

type Modality = 'pointer' | 'keyboard';

/** `<input>` types whose keys are not text: a letter pressed on one is keyboard use (Space on a checkbox). */
const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** A field where a key types text: a letter there says nothing the pointer did not (the user is typing after a tap). */
export function isTextEntry(el: EventTarget | null): boolean {
  if (!(el instanceof Element)) return false;
  if (
    el.closest('textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')
  )
    return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}

const MODIFIER_KEYS = new Set([
  'Shift',
  'Control',
  'Alt',
  'AltGraph',
  'Meta',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
]);

/** Starts tracking on `doc`; returns the cleanup that removes the listeners. */
export function trackModality(doc: Document = document): () => void {
  const set = (value: Modality) => {
    doc.documentElement.dataset.editletModality = value;
  };
  const onPointer = () => set('pointer');
  const onKey = (e: KeyboardEvent) => {
    if (MODIFIER_KEYS.has(e.key)) return;
    // ⌘K / Ctrl+K opens the search by keyboard even from a text field; other combos (copy, paste, select all) are not a
    // way of moving focus.
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') return set('keyboard');
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Tab' || e.key === 'Escape' || !isTextEntry(e.target)) set('keyboard');
  };
  doc.addEventListener('pointerdown', onPointer, true);
  doc.addEventListener('keydown', onKey, true);
  return () => {
    doc.removeEventListener('pointerdown', onPointer, true);
    doc.removeEventListener('keydown', onKey, true);
  };
}
