// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ACTIVITY_HOLD_MS, ActivityStatus } from './ActivityStatus';

afterEach(() => cleanup());

const deferred = () => {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  return { promise, resolve };
};

function setup({ syncing = true } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const load = deferred();
  const save = deferred();
  let mutate = () => {};
  // The query's next fetch: the first load, then whatever a test sets for a refetch.
  const next = { fetch: () => load.promise };
  function Probe() {
    useQuery({ queryKey: ['x'], queryFn: () => next.fetch() });
    mutate = useMutation({ mutationFn: () => save.promise }).mutate as () => void;
    return <ActivityStatus syncing={syncing} />;
  }
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  /** The indicator's text; '' while idle (nothing is shown). */
  const text = () => document.querySelector('.editlet-window__activity')?.textContent ?? '';
  const refetch = () => void client.refetchQueries({ queryKey: ['x'] });
  return { load, save, next, refetch, mutate: () => mutate(), text };
}

describe('the activity indicator', () => {
  // React Query reports on a 0ms timer, so this runs on real timers and waits for each state.
  const settle = { timeout: ACTIVITY_HOLD_MS * 3 };

  it('shows Loading…, then nothing once the hold is over; Saving… during a mutation; Syncing… on a refetch', async () => {
    const { load, save, next, mutate, refetch, text } = setup();
    await waitFor(() => expect(text()).toBe('Loading…'));
    await act(async () => load.resolve('data'));
    // Busy states stay up for the hold, so a quick fetch does not flash.
    expect(text()).toBe('Loading…');
    await waitFor(() => expect(text()).toBe(''), settle);

    act(() => mutate());
    await waitFor(() => expect(text()).toBe('Saving…'));
    await act(async () => save.resolve('ok'));
    await waitFor(() => expect(text()).toBe(''), settle);

    const again = deferred();
    next.fetch = () => again.promise;
    act(() => refetch());
    await waitFor(() => expect(text()).toBe('Syncing…'));
    await act(async () => again.resolve('more'));
    await waitFor(() => expect(text()).toBe(''), settle);
  });

  it('leaves refreshes out with syncing off (the dev server polls every few seconds)', async () => {
    const { load, next, refetch, text } = setup({ syncing: false });
    await act(async () => load.resolve('data'));
    await waitFor(() => expect(text()).toBe(''), settle);
    const again = deferred();
    next.fetch = () => again.promise;
    act(() => refetch());
    await new Promise((r) => setTimeout(r, 50));
    expect(text()).toBe('');
    await act(async () => again.resolve('more'));
  });
});
