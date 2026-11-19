import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isTextEntry, trackModality } from './modality';

// The ring is the keyboard's (docs/admin/ui.md, State variants): the attribute says which input came last.

const attr = () => document.documentElement.dataset.editletModality;
let stop: () => void;

beforeEach(() => {
  delete document.documentElement.dataset.editletModality;
  document.body.innerHTML =
    '<button id="b">B</button><input id="t" type="text"><input id="c" type="checkbox"><textarea id="a"></textarea>' +
    '<select id="s"></select><div id="e" contenteditable="true"><p id="p">x</p></div>';
  stop = trackModality();
});
afterEach(() => stop());

const el = (id: string) => document.getElementById(id)!;
const key = (target: Element, init: KeyboardEventInit) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const point = (target: Element) => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

describe('trackModality', () => {
  it('says nothing before any input, and a bare focus() changes nothing', () => {
    el('t').focus();
    expect(attr()).toBeUndefined();
    point(el('b'));
    el('t').focus();
    expect(attr()).toBe('pointer');
  });

  it('a pointer down is pointer', () => {
    point(el('t'));
    expect(attr()).toBe('pointer');
  });

  it('Tab and Escape are keyboard, even in a text field', () => {
    point(el('t'));
    key(el('t'), { key: 'Tab' });
    expect(attr()).toBe('keyboard');
    point(el('t'));
    key(el('t'), { key: 'Escape' });
    expect(attr()).toBe('keyboard');
    point(el('t'));
    key(el('t'), { key: 'Tab', shiftKey: true });
    expect(attr()).toBe('keyboard');
  });

  it('a letter typed in a text field after a tap stays pointer', () => {
    for (const id of ['t', 'a', 'p']) {
      point(el(id));
      key(el(id), { key: 'a' });
      expect(attr(), id).toBe('pointer');
    }
  });

  it('a key on anything else is keyboard: a button, a checkbox, the page', () => {
    for (const target of [el('b'), el('c'), document.body]) {
      point(el('t'));
      key(target, { key: ' ' });
      expect(attr(), target.id || 'body').toBe('keyboard');
    }
  });

  it('⌘K and Ctrl+K are keyboard even from a text field; other combos and bare modifiers are ignored', () => {
    point(el('t'));
    key(el('t'), { key: 'k', metaKey: true });
    expect(attr()).toBe('keyboard');
    point(el('t'));
    key(el('t'), { key: 'K', ctrlKey: true });
    expect(attr()).toBe('keyboard');

    point(el('b'));
    for (const init of [
      { key: 'c', metaKey: true },
      { key: 'v', ctrlKey: true },
      { key: 'a', altKey: true },
    ])
      key(el('b'), init);
    for (const modifier of ['Shift', 'Control', 'Alt', 'Meta']) key(el('b'), { key: modifier });
    expect(attr()).toBe('pointer');
  });

  it('the cleanup removes the listeners', () => {
    stop();
    point(el('b'));
    expect(attr()).toBeUndefined();
    key(el('b'), { key: 'Tab' });
    expect(attr()).toBeUndefined();
    stop = trackModality();
  });

  it('works on another document', () => {
    const other = document.implementation.createHTMLDocument('x');
    const off = trackModality(other);
    other.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(other.documentElement.dataset.editletModality).toBe('pointer');
    expect(attr()).toBeUndefined();
    off();
  });
});

describe('isTextEntry', () => {
  it('is true for text fields only', () => {
    expect(isTextEntry(el('t'))).toBe(true);
    expect(isTextEntry(el('a'))).toBe(true);
    expect(isTextEntry(el('s'))).toBe(true);
    expect(isTextEntry(el('p'))).toBe(true);
    expect(isTextEntry(el('c'))).toBe(false);
    expect(isTextEntry(el('b'))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(document)).toBe(false);
  });
});
