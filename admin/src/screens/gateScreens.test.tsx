import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrokenSchema, fixPrompt } from './BrokenSchema';
import { Unavailable } from './Unavailable';

import type { Issue } from '../../../core/issues';
import { createTestQueryClient } from '../test/render';
import { BridgeProvider } from '../useRoute';

// The screens before the shell exists draw in the window's own frame (GateFrame): Minimize in the header, their one
// action in the bottom bar.

const ISSUES: Issue[] = [
  { file: 'cms/schema.json', path: 'git', message: 'Invalid input: expected object, received undefined' },
  { file: 'cms/schema.json', path: 'collections.post.label', message: 'Invalid input: expected string' },
];

function renderGate(node: React.ReactNode) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <BridgeProvider>{node}</BridgeProvider>
    </QueryClientProvider>,
  );
}

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else Reflect.deleteProperty(navigator, 'clipboard');
});

describe('Unavailable', () => {
  it('is a state with the window header, and a bottom bar only when it has an action', () => {
    const { unmount } = renderGate(
      <Unavailable title="Editing is not set up" text="Set the admin option." icon="settings" tone="neutral" />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Editing is not set up' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeDefined();
    expect(document.querySelector('[data-slot="bottom-bar"]')).toBeNull();
    unmount();
    renderGate(
      <Unavailable title="No write access" text="Ask an owner.">
        <button type="button">Sign out</button>
      </Unavailable>,
    );
    expect(document.querySelector('[data-slot="bottom-bar"]')?.textContent).toBe('Sign out');
  });
});

describe('BrokenSchema', () => {
  it('lists the issues and copies a prompt to fix them', async () => {
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    renderGate(<BrokenSchema issues={ISSUES} />);
    expect(screen.getByRole('heading', { level: 1, name: 'The schema has errors' })).toBeDefined();
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'cms/schema.json: git: Invalid input: expected object, received undefined',
      'cms/schema.json: collections.post.label: Invalid input: expected string',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Copy fix prompt' }));
    await waitFor(() => expect(write).toHaveBeenCalledWith(fixPrompt(ISSUES)));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeDefined();
  });

  it('the prompt names the file and every issue, and asks for a plan first', () => {
    expect(fixPrompt(ISSUES)).toBe(
      [
        'cms/schema.json does not load. Fix these problems:',
        '- cms/schema.json: git: Invalid input: expected object, received undefined',
        '- cms/schema.json: collections.post.label: Invalid input: expected string',
        'Show me the plan before changing anything.',
      ].join('\n'),
    );
  });
});
