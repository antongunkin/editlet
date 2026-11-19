// Text values only: fake-indexeddb's structured clone cannot carry a jsdom Blob (see loader/preview/db.test.ts).
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PreviewProvider, usePreview, useSiteRefresh } from './PreviewProvider';

import { readPreviewFlag, readSnapshot, writeSnapshot } from '../../../loader/preview/db';
import { PREVIEW_CHANNEL, PREVIEW_ROUTE, withEditletRoute } from '../../../loader/protocol';
import type { AdminConfig } from '../../config';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../test/fakeGitHub';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { closeSheets, findCta, openTitle, renderApp, rowText, saveReview } from '../test/render';
import { BridgeProvider } from '../useRoute';

const ENTRY = 'cms/content/post/hello-world.md';
const PREVIEW_NOTICE = 'Preview could not update; the page shows the last saved state';
const REF = 'post/hello-world';

/** Messages posted on the preview channel (a stand-in for `BroadcastChannel`). */
let messages: { name: string; data: unknown }[];

class SpyChannel {
  constructor(readonly name: string) {}
  postMessage(data: unknown): void {
    messages.push({ name: this.name, data });
  }
  addEventListener(): void {}
  close(): void {}
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fileAt(fake: AdminFakeGitHub, branch: string, path: string): string {
  const sha = fake.state.commits.get(fake.state.refs.get(branch)!)!.files.get(path)!;
  return new TextDecoder().decode(fake.state.blobs.get(sha));
}

/** `main` plus `editlet/x`: post/hello-world retitled "Edited". */
function fakeWithBranch(): AdminFakeGitHub {
  const fake = createAdminFakeGitHub();
  fake.state.refs.set('editlet/x', fake.state.refs.get('main')!);
  fake.commit('editlet/x', { [ENTRY]: fileAt(fake, 'main', ENTRY).replace('title: Hello world', 'title: Edited') });
  return fake;
}

async function openLive(
  fake: AdminFakeGitHub,
  opts: { active?: string; route?: string; fetch?: typeof fetch; win?: Window } = {},
) {
  if (opts.active) window.localStorage.setItem(activeBranchKey('o', 'r'), opts.active);
  window.history.replaceState(null, '', withEditletRoute('/editlet/', opts.route ?? ''));
  writeSession(window.sessionStorage, tokenSession('pat_1'));
  renderLiveApp(opts.fetch ?? siteFetch(LIVE_CONFIG, fake), { win: opts.win });
  await screen.findByRole('button', { name: /^Branch / });
  // A moved screen draws its own status line (its own chip) over the loading screen's: wait for it.
  await waitFor(() => expect(document.querySelector('main [data-editlet="screen"]')).not.toBeNull());
  return screen.getByRole('button', { name: /^Branch / });
}

/** The branch chip of the open screen: a branch switch draws a new one. */
const branch = () => screen.getByRole('button', { name: /^Branch / });

/** The account sheet's Sign out (the header's avatar opens it). */
async function signOut() {
  fireEvent.click(screen.getByRole('button', { name: 'Account' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
}

/** Types `text` into `input` one character at a time (well inside the 100 ms debounce). */
function typeInto(input: HTMLInputElement, text: string) {
  fireEvent.change(input, { target: { value: '' } });
  for (let i = 1; i <= text.length; i++) fireEvent.change(input, { target: { value: text.slice(0, i) } });
}

/** Waits for the provider's write on mount, then forgets its channel message. */
async function settleMount() {
  await waitFor(() => expect(messages.length).toBeGreaterThan(0));
  messages = [];
}

async function saveForm() {
  await closeSheets();
  fireEvent.click(await findCta(/^Save/));
  await saveReview();
}

/** Waits for the Title row to show `value` (the branch's file loaded), then opens its modal. */
async function titleWith(value: string) {
  await waitFor(() => expect(rowText('Title')).toContain(value));
  return openTitle();
}

beforeEach(() => {
  messages = [];
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.stubGlobal('BroadcastChannel', SpyChannel);
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('preview snapshot from the entry form (local mode)', () => {
  it('typing in a field writes a debounced snapshot and announces it', async () => {
    renderApp({ route: REF });
    const title = await openTitle();
    await settleMount();
    typeInto(title, 'New');

    await waitFor(async () => {
      const snap = await readSnapshot();
      expect(snap?.entries[REF]?.title).toEqual({ text: { from: 'Hello world', to: 'New' } });
    });
    const snap = await readSnapshot();
    expect(snap?.branch).toBe('local');
    expect(snap!.expiresAt).toBeGreaterThan(Date.now());
    await sleep(150);
    expect(messages).toEqual([{ name: PREVIEW_CHANNEL, data: { source: 'editlet', type: 'snapshot' } }]);
  });

  it('closing the entry removes its form preview', async () => {
    renderApp({ route: REF });
    const title = await openTitle();
    typeInto(title, 'New');
    await waitFor(async () => expect((await readSnapshot())?.entries[REF]).toBeDefined());

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await closeSheets();
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    await waitFor(async () => expect(await readSnapshot()).toBeNull());
  });

  it('a dirty close via close-request drops the form preview before the admin sends close', async () => {
    const fake = createFakeWindow();
    renderApp({ route: REF, win: fake.win });
    const title = await openTitle();
    act(() => fake.fromSite({ type: 'init', route: REF, site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
    typeInto(title, 'New');
    await waitFor(async () => expect((await readSnapshot())?.entries[REF]).toBeDefined());

    // The loader removes the iframe as soon as `close` arrives: read the snapshot at that moment.
    let atClose: Promise<unknown> | null = null;
    fake.parent.postMessage.mockImplementation((m: { type: string }) => {
      if (m.type === 'close') atClose = readSnapshot();
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => fake.fromSite({ type: 'close-request' }));
    await waitFor(() => expect(atClose).not.toBeNull());
    expect(await atClose).toBeNull();
  });

  it('a form preview left by a torn-down admin is cleared when the admin mounts', async () => {
    await writeSnapshot({
      v: 1,
      branch: 'local',
      expiresAt: Date.now() + 60_000,
      entries: { [REF]: { title: { text: { from: 'Hello world', to: 'Discarded' } } } },
    });
    renderApp();
    await waitFor(async () => expect(await readSnapshot()).toBeNull());
  });

  it('Save clears the form preview', async () => {
    renderApp({ route: REF });
    const title = await openTitle();
    typeInto(title, 'New');
    await waitFor(async () => expect((await readSnapshot())?.entries[REF]).toBeDefined());

    await saveForm();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Your changes' })).toBeNull());
    await waitFor(async () => expect(await readSnapshot()).toBeNull());
  });

  it('local mode never sets the flag', async () => {
    renderApp({ route: REF });
    const title = await openTitle();
    typeInto(title, 'New');
    await waitFor(async () => expect((await readSnapshot())?.entries[REF]).toBeDefined());
    expect(readPreviewFlag()).toBeNull();
  });
});

describe('preview snapshot from the active branch (GitHub mode)', () => {
  it('github: a non-base branch writes branch entries and the flag', async () => {
    await openLive(fakeWithBranch(), { active: 'editlet/x' });
    await waitFor(async () => {
      const snap = await readSnapshot();
      expect(snap?.branch).toBe('editlet/x');
      expect(snap?.entries[REF]?.title).toEqual({ text: { from: 'Hello world', to: 'Edited' } });
    });
    expect(readPreviewFlag()).toBe('editlet/x');
    expect(messages.length).toBeGreaterThan(0);
  });

  it('github: switching to the base branch clears snapshot and flag', async () => {
    await openLive(fakeWithBranch(), { active: 'editlet/x' });
    await waitFor(async () => expect((await readSnapshot())?.branch).toBe('editlet/x'));

    fireEvent.click(branch());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /^main/ }));
    await waitFor(() => expect(branch().textContent).toBe('main live'));
    await waitFor(async () => expect(await readSnapshot()).toBeNull());
    expect(readPreviewFlag()).toBeNull();
  });

  it('github: sign-out clears snapshot and flag', async () => {
    await openLive(fakeWithBranch(), { active: 'editlet/x' });
    await waitFor(async () => expect((await readSnapshot())?.branch).toBe('editlet/x'));
    expect(readPreviewFlag()).toBe('editlet/x');

    await signOut();
    await screen.findByRole('heading', { name: 'Sign in to edit' });
    await waitFor(async () => expect(await readSnapshot()).toBeNull());
    expect(readPreviewFlag()).toBeNull();
  });

  it('form edit over a branch change keeps the base from', async () => {
    await openLive(fakeWithBranch(), { active: 'editlet/x', route: REF });
    await screen.findByRole('button', { name: /^Title/ });
    const title = await titleWith('Edited');
    await waitFor(async () => expect((await readSnapshot())?.branch).toBe('editlet/x'));

    typeInto(title, 'New');
    await waitFor(async () => {
      const snap = await readSnapshot();
      expect(snap?.branch).toBe('editlet/x');
      expect(snap?.entries[REF]?.title).toEqual({ text: { from: 'Hello world', to: 'New' } });
    });
    expect(readPreviewFlag()).toBe('editlet/x');
  });

  it('github: after Save the snapshot holds the branch value', async () => {
    const fake = fakeWithBranch();
    await openLive(fake, { active: 'editlet/x', route: REF });
    await screen.findByRole('button', { name: /^Title/ });
    const title = await titleWith('Edited');
    typeInto(title, 'Saved');
    await waitFor(async () => expect((await readSnapshot())?.entries[REF]?.title).toBeDefined());

    await saveForm();
    await waitFor(() => expect(fileAt(fake, 'editlet/x', ENTRY)).toContain('title: Saved'));
    await sleep(300);
    await waitFor(async () => {
      const snap = await readSnapshot();
      expect(snap?.branch).toBe('editlet/x');
      expect(snap?.entries[REF]?.title).toEqual({ text: { from: 'Hello world', to: 'Saved' } });
    });
    expect(readPreviewFlag()).toBe('editlet/x');
  });
});

/** A call to the site's preview route, in the order the responses were sent. */
type RouteCall = { method: string; branch?: string; sha?: string; auth?: string | null; status: number };

/**
 * The live site with `config.preview` (or `config`): preview-route calls go to `calls` (and to `log`, as
 * `POST <sha>` / `DELETE`); `status(call)` answers each POST (default 204).
 */
function previewSite(
  fake: AdminFakeGitHub,
  opts: { config?: AdminConfig; log?: string[]; status?: () => number; delayMs?: number } = {},
) {
  const calls: RouteCall[] = [];
  // Made at the first call: `siteFetch` resolves `config.json` against the URL `openLive` sets.
  let inner: typeof fetch | undefined;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href, document.baseURI).pathname !== PREVIEW_ROUTE) {
      inner ??= siteFetch(opts.config ?? { ...LIVE_CONFIG, preview: true }, fake);
      return inner(input, init);
    }
    const method = init?.method ?? 'GET';
    if (opts.delayMs) await sleep(opts.delayMs);
    if (method === 'DELETE') {
      calls.push({ method, status: 204 });
      opts.log?.push('DELETE');
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(init?.body)) as { branch: string; sha: string };
    const auth = new Headers(init?.headers).get('Authorization');
    const status = opts.status?.() ?? 204;
    calls.push({ method, branch: body.branch, sha: body.sha, auth, status });
    opts.log?.push(`POST ${body.sha}`);
    return new Response(status === 204 ? null : 'Refused', { status });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

const headOf = (fake: AdminFakeGitHub, branch: string) => fake.state.refs.get(branch)!;

/** An embedded admin (fake window at `route`) whose bridge `send` calls go to `log` as `msg:<type>`. */
function embeddedAt(route: string, log: string[]) {
  const fake = createFakeWindow({ href: `${ORIGIN}${withEditletRoute('/editlet/', route)}` });
  fake.parent.postMessage.mockImplementation((m: { type: string }) => log.push(`msg:${m.type}`));
  const init = () => act(() => fake.fromSite({ type: 'init', route, site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
  return { win: fake.win, init };
}

describe('Layer B: the preview cookie (GitHub mode, config.preview)', () => {
  it('posts the active branch head with the editor token', async () => {
    const fake = fakeWithBranch();
    const site = previewSite(fake);
    await openLive(fake, { active: 'editlet/x', fetch: site.fetch });
    await waitFor(() => expect(site.calls).toHaveLength(1));
    expect(site.calls[0]).toEqual({
      method: 'POST',
      branch: 'editlet/x',
      sha: headOf(fake, 'editlet/x'),
      auth: 'Bearer pat_1',
      status: 204,
    });
  });

  it('refresh waits for the cookie', async () => {
    const fake = fakeWithBranch();
    const log: string[] = [];
    const site = previewSite(fake, { log, delayMs: 30 });
    const { win, init } = embeddedAt(REF, log);
    await openLive(fake, { active: 'editlet/x', route: REF, fetch: site.fetch, win });
    init();
    await screen.findByRole('button', { name: /^Title/ });
    const title = await titleWith('Edited');
    await waitFor(() => expect(site.calls).toHaveLength(1));
    const before = headOf(fake, 'editlet/x');

    fireEvent.change(title, { target: { value: 'Saved' } });
    await saveForm();
    await waitFor(() => expect(log).toContain('msg:refresh'));
    const after = headOf(fake, 'editlet/x');
    expect(after).not.toBe(before);
    expect(log.indexOf(`POST ${after}`)).toBeGreaterThanOrEqual(0);
    expect(log.indexOf(`POST ${after}`)).toBeLessThan(log.indexOf('msg:refresh'));
    // The new head is posted once, though both the save and the file list's new head ask for it.
    await sleep(200);
    expect(site.calls.filter((c) => c.sha === after)).toHaveLength(1);
  });

  it('no preview calls without config.preview', async () => {
    const fake = fakeWithBranch();
    const log: string[] = [];
    const site = previewSite(fake, { config: LIVE_CONFIG, log });
    const { win, init } = embeddedAt(REF, log);
    await openLive(fake, { active: 'editlet/x', route: REF, fetch: site.fetch, win });
    init();
    await screen.findByRole('button', { name: /^Title/ });
    const title = await titleWith('Edited');

    fireEvent.change(title, { target: { value: 'Saved' } });
    await saveForm();
    await waitFor(() => expect(log).toContain('msg:refresh'));
    // The account sheet is Home's: leave the entry, the collection and All content first.
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    fireEvent.click(
      await screen.findByRole('heading', { name: 'Post' }).then(() => screen.getByRole('link', { name: 'Back' })),
    );
    fireEvent.click(
      await screen
        .findByRole('heading', { name: 'All content' })
        .then(() => screen.getByRole('link', { name: 'Back' })),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Account' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to edit' });
    await sleep(100);
    expect(site.calls).toEqual([]);
  });

  it('switching to base sends DELETE', async () => {
    const fake = fakeWithBranch();
    const site = previewSite(fake);
    await openLive(fake, { active: 'editlet/x', fetch: site.fetch });
    await waitFor(() => expect(site.calls).toHaveLength(1));

    fireEvent.click(branch());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('button', { name: /^main/ }));
    await waitFor(() => expect(branch().textContent).toBe('main live'));
    await waitFor(() => expect(site.calls.map((c) => c.method)).toEqual(['POST', 'DELETE']));
  });

  it('sign-out sends DELETE', async () => {
    const fake = fakeWithBranch();
    const site = previewSite(fake);
    await openLive(fake, { active: 'editlet/x', fetch: site.fetch });
    await waitFor(() => expect(site.calls).toHaveLength(1));

    await signOut();
    await screen.findByRole('heading', { name: 'Sign in to edit' });
    await waitFor(() => expect(site.calls.map((c) => c.method)).toEqual(['POST', 'DELETE']));
  });

  it('a failed POST still refreshes and shows the notice', async () => {
    const fake = fakeWithBranch();
    const log: string[] = [];
    let refuse = false;
    const site = previewSite(fake, { log, status: () => (refuse ? 403 : 204) });
    const { win, init } = embeddedAt(REF, log);
    await openLive(fake, { active: 'editlet/x', route: REF, fetch: site.fetch, win });
    init();
    await screen.findByRole('button', { name: /^Title/ });
    const title = await titleWith('Edited');
    await waitFor(() => expect(site.calls).toHaveLength(1));
    expect(screen.queryByText(PREVIEW_NOTICE)).toBeNull();

    refuse = true;
    fireEvent.change(title, { target: { value: 'Saved' } });
    await saveForm();
    await waitFor(() => expect(log).toContain('msg:refresh'));
    expect(site.calls.some((c) => c.status === 403)).toBe(true);
    // The notice sits in the shell's live region (polite), which was on the page before it.
    expect((await screen.findByText(PREVIEW_NOTICE)).closest('[aria-live="polite"]')).not.toBeNull();
  });
});

function previewWrapper({ children }: { children: ReactNode }) {
  return (
    <BridgeProvider>
      <PreviewProvider flag={false}>{children}</PreviewProvider>
    </BridgeProvider>
  );
}

describe('useSiteRefresh', () => {
  it('runs the function set by setRefreshSite, until it is reset', async () => {
    const { result } = renderHook(() => ({ preview: usePreview(), refresh: useSiteRefresh() }), {
      wrapper: previewWrapper,
    });
    const custom = vi.fn(async () => {});
    act(() => result.current.preview.setRefreshSite(custom));
    await result.current.refresh();
    expect(custom).toHaveBeenCalledTimes(1);
    act(() => result.current.preview.setRefreshSite(null));
    await result.current.refresh();
    expect(custom).toHaveBeenCalledTimes(1);
  });
});
