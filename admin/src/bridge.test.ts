import { describe, expect, it, vi } from 'vitest';

import { createBridge } from './bridge';
import { createFakeWindow, ORIGIN } from './test/fakeWindow';

import { adminMessage } from '../../loader/protocol';

const site = { origin: ORIGIN, href: `${ORIGIN}/blog/` };

function setup(opts?: { standalone?: boolean }) {
  const fake = createFakeWindow(opts);
  const handlers = { onInit: vi.fn(), onNavigate: vi.fn(), onPage: vi.fn(), onCloseRequest: vi.fn() };
  const bridge = createBridge(fake.win, handlers);
  return { ...fake, handlers, bridge };
}

describe('createBridge', () => {
  it("posts ready with '*' on create when embedded", () => {
    const { parent, bridge } = setup();
    expect(bridge.embedded).toBe(true);
    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage).toHaveBeenCalledWith(adminMessage({ type: 'ready' }), '*');
    expect(bridge.connected()).toBe(false);
  });

  it('ignores init from a foreign origin', () => {
    const { fromSite, handlers, bridge } = setup();
    fromSite({ type: 'init', route: 'post', site }, { origin: 'https://evil.example' });
    expect(handlers.onInit).not.toHaveBeenCalled();
    expect(bridge.connected()).toBe(false);
  });

  it('ignores a message from another source', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'init', route: 'post', site }, { source: {} });
    expect(handlers.onInit).not.toHaveBeenCalled();
  });

  it('ignores non-protocol messages', () => {
    const { receive, handlers } = setup();
    receive({ type: 'init', route: 'post', site });
    receive('hello');
    expect(handlers.onInit).not.toHaveBeenCalled();
  });

  it('ignores site messages before init', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'navigate', route: 'post' });
    fromSite({ type: 'close-request' });
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onCloseRequest).not.toHaveBeenCalled();
  });

  it('accepts init from the parent at the same origin and pins it', () => {
    const { fromSite, handlers, bridge, parent } = setup();
    bridge.send({ type: 'refresh' });
    expect(parent.postMessage).toHaveBeenCalledTimes(1); // only `ready`: not pinned yet

    fromSite({ type: 'init', route: 'post/hello-world', site });
    expect(handlers.onInit).toHaveBeenCalledWith('post/hello-world', `${ORIGIN}/blog/`);
    expect(bridge.connected()).toBe(true);

    bridge.send({ type: 'navigate', route: 'post' });
    expect(parent.postMessage).toHaveBeenLastCalledWith(adminMessage({ type: 'navigate', route: 'post' }), ORIGIN);
  });

  it('routes navigate and close-request after init', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'init', route: '', site });
    fromSite({ type: 'navigate', route: 'post' });
    expect(handlers.onNavigate).toHaveBeenCalledWith('post');
    fromSite({ type: 'close-request' });
    expect(handlers.onCloseRequest).toHaveBeenCalledTimes(1);
  });

  it('passes the page href of a later page message, only after init', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'page', href: `${ORIGIN}/early` });
    expect(handlers.onPage).not.toHaveBeenCalled();
    fromSite({ type: 'init', route: '', site });
    fromSite({ type: 'page', href: `${ORIGIN}/posts/tires` });
    expect(handlers.onPage).toHaveBeenCalledWith(`${ORIGIN}/posts/tires`);
    fromSite({ type: 'page', href: `${ORIGIN}/evil` }, { origin: 'https://evil.example' });
    expect(handlers.onPage).toHaveBeenCalledTimes(1);
  });

  it('does not take a page message for a close request', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'init', route: '', site });
    fromSite({ type: 'page', href: `${ORIGIN}/posts/a` });
    expect(handlers.onCloseRequest).not.toHaveBeenCalled();
    expect(handlers.onNavigate).not.toHaveBeenCalled();
  });

  it('ignores messages from another origin or source after pinning', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'init', route: '', site });
    fromSite({ type: 'navigate', route: 'post' }, { origin: 'https://evil.example' });
    fromSite({ type: 'close-request' }, { source: {} });
    expect(handlers.onNavigate).not.toHaveBeenCalled();
    expect(handlers.onCloseRequest).not.toHaveBeenCalled();
  });

  it('accepts a later init (site re-answers ready) from the pinned origin', () => {
    const { fromSite, handlers } = setup();
    fromSite({ type: 'init', route: '', site });
    fromSite({ type: 'init', route: 'schema', site });
    expect(handlers.onInit).toHaveBeenLastCalledWith('schema', `${ORIGIN}/blog/`);
  });

  it('stops listening after destroy', () => {
    const { fromSite, handlers, bridge } = setup();
    bridge.destroy();
    fromSite({ type: 'init', route: 'post', site });
    expect(handlers.onInit).not.toHaveBeenCalled();
  });

  it('is a no-op when standalone', () => {
    const { win, fromSite, handlers, bridge, parent } = setup({ standalone: true });
    expect(bridge.embedded).toBe(false);
    expect(win.parent).toBe(win);
    fromSite({ type: 'init', route: 'post', site }, { source: win });
    bridge.send({ type: 'close' });
    expect(handlers.onInit).not.toHaveBeenCalled();
    expect(parent.postMessage).not.toHaveBeenCalled();
    expect(bridge.connected()).toBe(false);
  });
});
