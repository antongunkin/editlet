import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Tabs, TabsList, TabsPanel, TabsTrigger } from './tabs';

function Groups() {
  return (
    <Tabs defaultValue="content">
      <TabsList aria-label="Field groups">
        <TabsTrigger value="content" mark="changed">
          Content
        </TabsTrigger>
        <TabsTrigger value="media" mark="invalid">
          Media
        </TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsPanel value="content">Content fields</TabsPanel>
      <TabsPanel value="media">Media fields</TabsPanel>
      <TabsPanel value="settings">Settings fields</TabsPanel>
    </Tabs>
  );
}

describe('Tabs (field groups)', () => {
  it('shows the chosen group, and says a mark in words: the dot is decoration', () => {
    render(<Groups />);
    expect(screen.getByRole('tab', { name: 'Content, changed' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Media, has errors' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeDefined();
    expect(screen.getByRole('tabpanel').textContent).toBe('Content fields');
  });

  it('a click chooses another group', () => {
    render(<Groups />);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByRole('tabpanel').textContent).toBe('Settings fields');
  });
});
