// The preview pill: tells the editor they see a branch, not the live site. Own Shadow DOM with inline styles so site
// CSS cannot reach it; the host carries PILL_ATTR so the patcher skips it. Text only, never HTML.
import { previewLabel as label } from './label';
import { PILL_ATTR } from './match';

import type { PreviewState } from '../window/channel';

export type PillState = PreviewState;
export type Pill = { update(state: PillState): void; remove(): void };

function style(el: HTMLElement, rules: Record<string, string>): void {
  for (const [k, v] of Object.entries(rules)) el.style.setProperty(k, v, 'important');
}

export function renderPill(doc: Document, state: PillState, onExit: () => void): Pill {
  const host = doc.createElement('div');
  host.setAttribute(PILL_ATTR, '');
  style(host, {
    all: 'initial',
    position: 'fixed',
    left: '16px',
    bottom: '16px',
    'z-index': '2147483647',
  });
  const root = host.attachShadow({ mode: 'open' });

  const box = doc.createElement('div');
  style(box, {
    display: 'flex',
    'align-items': 'center',
    gap: '8px',
    padding: '6px 6px 6px 12px',
    'border-radius': '999px',
    background: '#111827',
    color: '#f9fafb',
    font: '500 13px/1.4 system-ui, -apple-system, sans-serif',
    'box-shadow': '0 4px 16px rgba(0, 0, 0, 0.3)',
  });
  const text = doc.createElement('span');
  text.textContent = label(state);
  const exit = doc.createElement('button');
  exit.type = 'button';
  exit.textContent = 'Exit';
  style(exit, {
    font: 'inherit',
    color: '#111827',
    background: '#f9fafb',
    border: '0',
    'border-radius': '999px',
    padding: '2px 10px',
    cursor: 'pointer',
  });
  exit.addEventListener('click', () => onExit());

  box.append(text, exit);
  root.append(box);
  const attach = () => (doc.body ?? doc.documentElement).append(host);
  attach();

  return {
    update(next) {
      text.textContent = label(next);
      // The page removed it (a replaced <body> after client navigation): put it back.
      if (!host.isConnected) attach();
    },
    remove() {
      host.remove();
    },
  };
}
