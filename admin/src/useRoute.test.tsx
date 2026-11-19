import { act, render, screen } from '@testing-library/react';
import { useEffect, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeWindow, ORIGIN } from './test/fakeWindow';
import {
  BEFORE_CLOSE_TIMEOUT_MS,
  BridgeProvider,
  useBridge,
  usePagePath,
  useRoute,
  type BeforeClose,
} from './useRoute';

import { adminMessage } from '../../loader/protocol';

const site = { origin: ORIGIN, href: `${ORIGIN}/blog/` };

let guard: (() => boolean) | null = null;
let beforeClose: BeforeClose | null = null;
/** What the probe's close-with-exit button passes as `exit`. */
let exit: Promise<void> | null = null;

function Probe() {
  const { route, raw, navigate } = useRoute();
  const { status, setGuard, close, canLeave, addBeforeClose } = useBridge();
  const page = usePagePath();
  const [leave, setLeave] = useState('');
  useEffect(() => {
    setGuard(guard);
    const remove = beforeClose ? addBeforeClose(beforeClose) : undefined;
    return () => {
      setGuard(null);
      remove?.();
    };
  }, [setGuard, addBeforeClose]);
  return (
    <div>
      <span data-testid="raw">{raw}</span>
      <span data-testid="kind">{route.kind}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="page">{page ?? 'none'}</span>
      <button onClick={() => navigate({ kind: 'collection', collection: 'post' })}>to-post</button>
      <button onClick={() => navigate('post/hello-world')}>to-entry</button>
      <button onClick={() => close()}>close</button>
      <button onClick={() => close({ exit: () => exit })}>close-with-exit</button>
      <button onClick={() => setLeave(String(canLeave()))}>can-leave</button>
      <span data-testid="can-leave">{leave}</span>
    </div>
  );
}

/** Clicks the probe's can-leave button and reads what `canLeave()` returned. */
function askCanLeave() {
  act(() => screen.getByText('can-leave').click());
  return screen.getByTestId('can-leave').textContent;
}

beforeEach(() => {
  guard = null;
  beforeClose = null;
  exit = null;
});

describe('BridgeProvider without a parent page', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('canLeave asks the guard, and is true without one', () => {
    let allow = false;
    const ask = vi.fn(() => allow);
    guard = ask;
    const { unmount } = render(
      <BridgeProvider>
        <Probe />
      </BridgeProvider>,
    );
    expect(askCanLeave()).toBe('false');
    allow = true;
    expect(askCanLeave()).toBe('true');
    expect(ask).toHaveBeenCalledTimes(2);
    unmount();

    guard = null;
    render(
      <BridgeProvider>
        <Probe />
      </BridgeProvider>,
    );
    expect(askCanLeave()).toBe('true');
  });

  it('close() does not ask the guard', () => {
    const ask = vi.fn(() => false);
    guard = ask;
    window.history.replaceState(null, '', '/editlet/?editlet=post');
    render(
      <BridgeProvider>
        <Probe />
      </BridgeProvider>,
    );
    act(() => screen.getByText('close').click());
    expect(ask).not.toHaveBeenCalled();
  });
});

function mount(extra?: ReactNode) {
  const fake = createFakeWindow({ href: `${ORIGIN}/editlet/?editlet=post` });
  render(
    <BridgeProvider win={fake.win}>
      <Probe />
      {extra}
    </BridgeProvider>,
  );
  return fake;
}

describe('BridgeProvider embedded', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('init route wins, and navigate replaces state and posts navigate', () => {
    const { win, parent, fromSite } = mount();
    expect(screen.getByTestId('status').textContent).toBe('pending');
    expect(parent.postMessage).toHaveBeenCalledWith(adminMessage({ type: 'ready' }), '*');

    act(() => fromSite({ type: 'init', route: 'schema', site }));
    expect(screen.getByTestId('raw').textContent).toBe('schema');
    expect(screen.getByTestId('status').textContent).toBe('connected');
    expect(win.location.href).toBe(`${ORIGIN}/editlet/?editlet=schema`);

    act(() => screen.getByText('to-entry').click());
    expect(win.history.pushState).not.toHaveBeenCalled();
    expect(win.location.href).toBe(`${ORIGIN}/editlet/?editlet=post/hello-world`);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      adminMessage({ type: 'navigate', route: 'post/hello-world' }),
      ORIGIN,
    );
  });

  it("keeps the page's pathname from init and follows page messages", () => {
    const { fromSite } = mount();
    expect(screen.getByTestId('page').textContent).toBe('none');
    act(() => fromSite({ type: 'init', route: 'post/tires', site }));
    expect(screen.getByTestId('page').textContent).toBe('/blog/');
    act(() => fromSite({ type: 'page', href: `${ORIGIN}/posts/tires?x=1#top` }));
    expect(screen.getByTestId('page').textContent).toBe('/posts/tires');
    expect(screen.getByTestId('raw').textContent).toBe('post/tires');
  });

  it('applies a site navigate when the guard allows', () => {
    guard = () => true;
    const { win, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    act(() => fromSite({ type: 'navigate', route: 'post/other' }));
    expect(screen.getByTestId('raw').textContent).toBe('post/other');
    expect(win.location.href).toBe(`${ORIGIN}/editlet/?editlet=post/other`);
  });

  it('re-sends navigate with the current route when the guard denies a site navigate', () => {
    guard = () => false;
    const { win, parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post/hello-world', site }));
    act(() => fromSite({ type: 'navigate', route: 'post' }));
    expect(screen.getByTestId('raw').textContent).toBe('post/hello-world');
    expect(win.location.href).toBe(`${ORIGIN}/editlet/?editlet=post/hello-world`);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      adminMessage({ type: 'navigate', route: 'post/hello-world' }),
      ORIGIN,
    );
  });

  it('treats a repeated init like a site navigate (guarded)', () => {
    let allow = false;
    guard = () => allow;
    const { win, parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post/hello-world', site }));
    act(() => fromSite({ type: 'init', route: 'post', site }));
    expect(screen.getByTestId('raw').textContent).toBe('post/hello-world');
    expect(win.location.href).toBe(`${ORIGIN}/editlet/?editlet=post/hello-world`);
    expect(parent.postMessage).toHaveBeenLastCalledWith(
      adminMessage({ type: 'navigate', route: 'post/hello-world' }),
      ORIGIN,
    );
    allow = true;
    act(() => fromSite({ type: 'init', route: 'post', site }));
    expect(screen.getByTestId('raw').textContent).toBe('post');
  });

  it('close() before init does not ask the guard', () => {
    const ask = vi.fn(() => true);
    guard = ask;
    mount();
    act(() => screen.getByText('close').click());
    expect(ask).not.toHaveBeenCalled();
  });

  it('answers close-request with close only when the guard allows', () => {
    let allow = false;
    guard = () => allow;
    const { parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });

    act(() => fromSite({ type: 'close-request' }));
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);

    allow = true;
    act(() => fromSite({ type: 'close-request' }));
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('close() is guarded too', () => {
    let allow = false;
    guard = () => allow;
    const { parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });
    act(() => screen.getByText('close').click());
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);
    allow = true;
    act(() => screen.getByText('close').click());
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('sends close after the beforeClose promise settles; at once when it returns null', async () => {
    let release!: () => void;
    let wait = true;
    beforeClose = () => (wait ? new Promise<void>((r) => (release = r)) : null);
    const { parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });

    act(() => fromSite({ type: 'close-request' }));
    await act(async () => {});
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);
    await act(async () => release());
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);

    parent.postMessage.mockClear();
    wait = false;
    act(() => screen.getByText('close').click());
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('close({ exit }) runs exit only once the guard allows it, and sends close when it settles', async () => {
    let release!: () => void;
    exit = new Promise<void>((r) => (release = r));
    let allow = false;
    guard = () => allow;
    const { parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });

    act(() => screen.getByText('close-with-exit').click());
    await act(async () => release());
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);

    exit = new Promise<void>((r) => (release = r));
    allow = true;
    act(() => screen.getByText('close-with-exit').click());
    await act(async () => {});
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);
    await act(async () => release());
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('awaits every beforeClose hook, and a removed hook is not run', async () => {
    const ran: string[] = [];
    let release!: () => void;
    beforeClose = () => new Promise<void>((r) => (release = () => (ran.push('probe'), r())));
    function Extra() {
      const { addBeforeClose } = useBridge();
      useEffect(() => {
        const removeA = addBeforeClose(() => (ran.push('a'), null));
        const removeB = addBeforeClose(() => (ran.push('b'), null));
        removeB();
        return removeA;
      }, [addBeforeClose]);
      return null;
    }
    const { parent, fromSite } = mount(<Extra />);
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });
    act(() => fromSite({ type: 'close-request' }));
    await act(async () => {});
    expect(ran).toEqual(['a']);
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);
    await act(async () => release());
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('sends close after BEFORE_CLOSE_TIMEOUT_MS when beforeClose never settles', async () => {
    vi.useFakeTimers();
    beforeClose = () => new Promise<void>(() => {});
    const { parent, fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    const close = adminMessage({ type: 'close' });
    act(() => fromSite({ type: 'close-request' }));
    await act(async () => vi.advanceTimersByTime(BEFORE_CLOSE_TIMEOUT_MS - 1));
    expect(parent.postMessage).not.toHaveBeenCalledWith(close, ORIGIN);
    await act(async () => vi.advanceTimersByTime(1));
    expect(parent.postMessage).toHaveBeenLastCalledWith(close, ORIGIN);
  });

  it('becomes disconnected after 3000 ms without init', () => {
    vi.useFakeTimers();
    mount();
    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByTestId('status').textContent).toBe('pending');
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId('status').textContent).toBe('disconnected');
  });

  it('stays connected when init arrives in time', () => {
    vi.useFakeTimers();
    const { fromSite } = mount();
    act(() => fromSite({ type: 'init', route: 'post', site }));
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByTestId('status').textContent).toBe('connected');
  });
});
