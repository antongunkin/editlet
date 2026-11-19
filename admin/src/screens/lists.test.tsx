import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemorySource } from '../../../core/source';
import { readEditletRoute, withEditletRoute } from '../../../loader/protocol';
import { App } from '../App';
import { pendingNewEntries } from '../entry/pending';
import { tokenSession, writeSession } from '../github/session';
import { activeBranchKey } from '../github/workspace';
import { createAdminFakeGitHub } from '../test/fakeGitHub';
import { createFakeWindow, ORIGIN } from '../test/fakeWindow';
import { LIVE_CONFIG, renderLiveApp, siteFetch } from '../test/liveApp';
import { createTestQueryClient, doneField, fixtureFiles, HOME_LOADED, renderApp, sheet } from '../test/render';

/** The fixture site with `titleField: 'title'` on post and one extra draft post. */
function variantFiles(): Record<string, string | Uint8Array> {
  const files = fixtureFiles();
  const schema = JSON.parse(files['cms/schema.json'] as string) as {
    collections: Record<string, Record<string, unknown>>;
  };
  schema.collections.post!.titleField = 'title';
  files['cms/schema.json'] = JSON.stringify(schema, null, 2);
  files['cms/content/post/second-post.md'] = '---\ntitle: Second post\ndraft: true\n---\nDraft body\n';
  return files;
}

/** The fixture site with `post`'s keys changed (`pluralLabel`, `url`; `undefined` removes one). */
function postWith(keys: Record<string, unknown>): Record<string, string | Uint8Array> {
  const files = variantFiles();
  const schema = JSON.parse(files['cms/schema.json'] as string) as {
    collections: Record<string, Record<string, unknown>>;
  };
  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined) delete schema.collections.post![key];
    else schema.collections.post![key] = value;
  }
  files['cms/schema.json'] = JSON.stringify(schema, null, 2);
  return files;
}

const main = () => screen.getByRole('main');
const filterChips = () => within(main()).getByRole('group', { name: 'Show' });
const editletRoute = () => readEditletRoute(window.location.href);

afterEach(() => {
  pendingNewEntries.clear();
  window.history.replaceState(null, '', '/');
});

describe('Home', () => {
  it('has the header actions and All content; dev mode has no Your changes and no account, only Appearance', async () => {
    renderApp();
    const all = await within(main()).findByRole('link', { name: HOME_LOADED });
    expect(all.textContent).toContain('3 entries · media · model');
    expect(within(main()).getByRole('heading', { name: 'Home', level: 1 })).toBeDefined();
    expect(within(main()).queryByText('Your changes')).toBeNull();
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Account' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull();
  });

  it('opens All content', async () => {
    renderApp();
    fireEvent.click(await within(main()).findByRole('link', { name: HOME_LOADED }));
    expect(editletRoute()).toBe('all-content');
    expect(await within(main()).findByRole('heading', { name: 'All content', level: 1 })).toBeDefined();
  });
});

describe('All content', () => {
  it('lists the collections with counts, Media and the Content model; a row opens its screen', async () => {
    renderApp({ route: 'all-content' });
    const collections = await within(main()).findByRole('list', { name: 'Collections' });
    await within(collections).findByRole('link', { name: /^Posts?\s*1 entry$/ });
    expect(within(collections).getByRole('link', { name: /^Authors?\s*1 entry$/ })).toBeDefined();
    expect(within(collections).getByRole('link', { name: /^Home page\s*Single page/ })).toBeDefined();
    expect(within(main()).getByRole('link', { name: /^Media/ })).toBeDefined();
    fireEvent.click(within(main()).getByRole('link', { name: /^Content model/ }));
    expect(editletRoute()).toBe('schema');
  });

  it('goes Back to Home', async () => {
    renderApp({ route: 'all-content' });
    fireEvent.click(await screen.findByRole('link', { name: 'Back' }));
    expect(editletRoute()).toBe('');
  });
});

describe('Collection', () => {
  const list = () => within(main()).getByRole('list', { name: /entries$/ });
  function mockHistory(byPath: (path: string) => object | null) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      const body = url.pathname.endsWith('/history') ? byPath(url.searchParams.get('path')!) : null;
      return new Response(body ? JSON.stringify(body) : '{}', { status: body ? 200 : 404 });
    });
  }
  const width = window.innerWidth;
  afterEach(() => {
    vi.restoreAllMocks();
    window.innerWidth = width;
  });

  it('a row on a phone: the title, and under it the status; the header names the collection', async () => {
    window.innerWidth = 375;
    renderApp({ files: variantFiles(), route: 'post' });
    const hello = await within(main()).findByRole('button', { name: /^Hello world/ });
    expect(hello.textContent).toBe('Hello worldPublished');
    expect(within(list()).getByRole('button', { name: /^Second post/ }).textContent).toBe('Second postDraft');
    expect(within(main()).getByRole('heading', { level: 1, name: /^Posts?$/ })).toBeDefined();
    expect(within(main()).getByRole('link', { name: 'Back' })).toBeDefined();
  });

  it('in a wide window the status is a badge after the title', async () => {
    window.innerWidth = 600;
    renderApp({ files: variantFiles(), route: 'post' });
    const draft = await within(main()).findByRole('button', { name: /^Second post/ });
    expect(draft.textContent).toBe('Second postDraft');
    expect(draft.querySelector('[data-slot="badge"]')?.textContent).toBe('Draft');
  });

  it('filter chips: All and Drafts with their counts; Drafts narrows the list', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    const chips = within(main()).getByRole('group', { name: 'Show' });
    const all = within(chips).getByRole('button', { name: /^All\s*2$/ });
    const drafts = within(chips).getByRole('button', { name: /^Drafts\s*1$/ });
    expect(all.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(drafts);
    expect(drafts.getAttribute('aria-pressed')).toBe('true');
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
    expect(within(list()).getByRole('button', { name: /^Second post/ })).toBeDefined();
    fireEvent.click(all);
    expect(within(list()).getAllByRole('button')).toHaveLength(2);
  });

  it('a filter with nothing in it says so', async () => {
    const files = variantFiles();
    delete files['cms/content/post/second-post.md'];
    renderApp({ files, route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    fireEvent.click(within(main()).getByRole('button', { name: /^Drafts\s*0$/ }));
    expect(within(main()).getByRole('status').textContent).toBe('No drafts. Every entry is published.');
    expect(within(main()).queryByRole('list')).toBeNull();
  });

  /** The dev server's `GET /__editlet/git` answering `files` (other requests: 404, so no history). */
  function mockGit(files: { path: string; status: string }[] | null) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input), 'http://localhost');
      if (!url.pathname.endsWith('/git')) return new Response('{}', { status: 404 });
      if (files === null) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ branch: 'main', changes: files.length, files, project: 'p' }));
    });
  }

  it('Changed: the files saved to disk and not committed, counted and narrowed; the row says Changed', async () => {
    window.innerWidth = 375;
    mockGit([{ path: 'cms/content/post/second-post.md', status: 'modified' }]);
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    const changed = await within(filterChips()).findByRole('button', { name: /^Changed\s*1$/ });
    // The status word comes first: Changed, not Draft.
    expect(within(list()).getByRole('button', { name: /^Second post/ }).textContent).toBe('Second postChanged');
    expect(within(list()).getByRole('button', { name: /^Hello world/ }).textContent).toBe('Hello worldPublished');
    // The draft stays under Drafts too.
    expect(within(filterChips()).getByRole('button', { name: /^Drafts\s*1$/ })).toBeDefined();
    fireEvent.click(changed);
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
    expect(within(list()).getByRole('button', { name: /^Second post/ })).toBeDefined();
  });

  it('in a wide window a changed row has the Changed badge', async () => {
    window.innerWidth = 600;
    mockGit([{ path: 'cms/content/post/hello-world.md', status: 'modified' }]);
    renderApp({ files: variantFiles(), route: 'post' });
    const hello = await within(main()).findByRole('button', { name: /^Hello world/ });
    await waitFor(() => expect(hello.querySelector('[data-slot="badge"]')?.textContent).toBe('Changed'));
  });

  it('dev mode has no In review chip; Changed with nothing in it says so', async () => {
    mockGit([]);
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    fireEvent.click(await within(filterChips()).findByRole('button', { name: /^Changed\s*0$/ }));
    expect(within(main()).getByRole('status').textContent).toBe(
      'Nothing changed. Edits and saved changes that are not live show here.',
    );
    expect(within(filterChips()).queryByRole('button', { name: /^In review/ })).toBeNull();
  });

  it('Changed counts … until the statuses load, then 0 when the git route fails', async () => {
    let answer!: () => void;
    const gate = new Promise<void>((r) => (answer = r));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (!String(input).endsWith('/git')) return new Response('{}', { status: 404 });
      await gate;
      return new Response('{}', { status: 500 });
    });
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    const pending = await within(filterChips()).findByRole('button', { name: /^Changed\s*…$/ });
    fireEvent.click(pending);
    // Placeholder rows, not the empty text, while it loads.
    expect(within(main()).queryByRole('status')).toBeNull();
    answer();
    await within(filterChips()).findByRole('button', { name: /^Changed\s*0$/ });
  });

  it('when it changed comes from the git history; newest first by default', async () => {
    window.innerWidth = 375;
    mockHistory((path) => ({
      updated: path.endsWith('second-post.md')
        ? { actor: { name: 'Ann Lee' }, date: '2025-11-19T14:48:00Z', message: 'm' }
        : { actor: { name: 'Bob Stone' }, date: '2025-10-02T09:00:00Z', message: 'm' },
      created: null,
      commits: 1,
    }));
    renderApp({ files: variantFiles(), route: 'post' });
    const second = await within(main()).findByRole('button', { name: /^Second post/ });
    await waitFor(() => expect(second.textContent).toBe('Second postDraft · Nov 19, 2025 · Ann L'));
    expect(
      within(list())
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Second postDraft · Nov 19, 2025 · Ann L', 'Hello worldPublished · Oct 2, 2025 · Bob S']);
  });

  it('Sort: the header button opens one choice; a tap sorts, closes, and the choice is marked', async () => {
    window.innerWidth = 375;
    mockHistory((path) => ({
      updated: path.endsWith('second-post.md')
        ? { actor: { name: 'Ann Lee' }, date: '2025-11-19T14:48:00Z', message: 'm' }
        : { actor: { name: 'Bob Stone' }, date: '2025-10-02T09:00:00Z', message: 'm' },
      created: null,
      commits: 1,
    }));
    renderApp({ files: variantFiles(), route: 'post' });
    await within(main()).findByRole('button', { name: /^Second post/ });
    fireEvent.click(within(main()).getByRole('button', { name: 'Sort' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'Sort' }));
    const options = dialog.getAllByRole('radio').map((r) => r.textContent);
    expect(options).toEqual(['Newest first', 'Oldest first', 'Title A–Z', 'Title Z–A', 'By author', 'By status']);
    expect(dialog.getByRole('radio', { name: 'Newest first' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(dialog.getByRole('radio', { name: 'Title A–Z' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(
      within(list())
        .getAllByRole('button')
        .map((b) => b.querySelector('span > span')?.textContent),
    ).toEqual(['Hello world', 'Second post']);
    fireEvent.click(within(main()).getByRole('button', { name: 'Sort' }));
    const again = within(await screen.findByRole('dialog', { name: 'Sort' }));
    expect(again.getByRole('radio', { name: 'Title A–Z' }).getAttribute('aria-checked')).toBe('true');
  });

  it('shows 20 rows and Show 20 more under them; a sort or a chip goes back to the first 20', async () => {
    const files = variantFiles();
    for (let i = 10; i < 33; i++) files[`cms/content/post/p${i}.md`] = `---\ntitle: Post ${i}\n---\n`;
    renderApp({ files, route: 'post' });
    await within(main()).findByRole('button', { name: /^Hello world/ });
    expect(within(list()).getAllByRole('button')).toHaveLength(21);
    const more = within(list()).getByRole('button', { name: /^Show 5 more/ });
    expect(more.textContent).toBe('Show 5 more20 of 25 shown');
    fireEvent.click(more);
    expect(within(list()).getAllByRole('button')).toHaveLength(25);
    expect(within(list()).queryByRole('button', { name: /^Show/ })).toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: /^Drafts\s*1$/ }));
    fireEvent.click(within(main()).getByRole('button', { name: /^All\s*25$/ }));
    expect(within(list()).getAllByRole('button')).toHaveLength(21);
  });

  it('a row opens the entry route', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    fireEvent.click(await within(main()).findByRole('button', { name: /^Hello world/ }));
    expect(editletRoute()).toBe('post/hello-world');
    expect(await within(main()).findByRole('group', { name: / fields$/ })).toBeDefined();
  });

  it('a collection without entries says so; the one CTA is New <collection>', async () => {
    const files = variantFiles();
    delete files['cms/content/post/hello-world.md'];
    delete files['cms/content/post/second-post.md'];
    renderApp({ files, route: 'post' });
    expect(await within(main()).findByText('No entries yet')).toBeDefined();
    expect(within(main()).queryByRole('group', { name: 'Show' })).toBeNull();
    expect(within(main()).getByRole('button', { name: 'New post' })).toBeDefined();
  });

  it('the heading and the All content row read pluralLabel; New post stays singular', async () => {
    renderApp({ files: postWith({ pluralLabel: 'Posts' }), route: 'post' });
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Posts' })).toBeDefined();
    fireEvent.click(within(main()).getByRole('button', { name: 'New post' }));
    const dialog = within(await screen.findByRole('dialog', { name: 'New post' }));
    expect(dialog.getByText('Posts')).toBeDefined();
    expect(dialog.getByRole('button', { name: 'Create post' })).toBeDefined();
  });

  it('All content names a collection by its pluralLabel, a singleton by its label', async () => {
    renderApp({ files: postWith({ pluralLabel: 'Posts' }), route: 'all-content' });
    const collections = await within(main()).findByRole('list', { name: 'Collections' });
    await within(collections).findByRole('link', { name: /^Posts\s*2 entries$/ });
    expect(within(collections).getByRole('link', { name: /^Home page\s*Single page/ })).toBeDefined();
  });

  it('a singleton route renders the entry screen', async () => {
    renderApp({ route: 'homePage' });
    expect(await within(main()).findByRole('group', { name: / fields$/ })).toBeDefined();
  });
});

describe('Collection in GitHub mode', () => {
  const ENTRY = 'cms/content/post/hello-world.md';

  /**
   * `main` plus `editlet/a`, which edits post/hello-world (titled by its slug), with an open pull request or none; the
   * admin opens `route` (the collection) on `active`.
   */
  function fakeOnBranch(pull: { draft: boolean } | null, active = 'editlet/a', route = 'post') {
    const fake = createAdminFakeGitHub();
    const sha = fake.state.commits.get(fake.state.refs.get('main')!)!.files.get(ENTRY)!;
    const text = new TextDecoder().decode(fake.state.blobs.get(sha));
    fake.state.refs.set('editlet/a', fake.state.refs.get('main')!);
    fake.commit('editlet/a', { [ENTRY]: text.replace('Hello world', 'On A') });
    if (pull) {
      fake.state.pulls.push({
        number: 2,
        title: 'A',
        body: '',
        draft: pull.draft,
        head: 'editlet/a',
        base: 'main',
        state: 'open',
      });
    }
    window.localStorage.setItem(activeBranchKey('o', 'r'), active);
    window.history.replaceState(null, '', withEditletRoute('/editlet/', route));
    writeSession(window.sessionStorage, tokenSession('pat_1'));
    renderLiveApp(siteFetch(LIVE_CONFIG, fake));
  }

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('a branch with an open pull request: the entry is in review and changed; the badge says In review', async () => {
    window.innerWidth = 375;
    fakeOnBranch({ draft: false });
    const row = await screen.findByRole('button', { name: /^hello-world/ });
    await within(filterChips()).findByRole('button', { name: /^In review\s*1$/ });
    expect(within(filterChips()).getByRole('button', { name: /^Changed\s*1$/ })).toBeDefined();
    expect(row.textContent).toMatch(/^hello-worldIn review · /);
    fireEvent.click(within(filterChips()).getByRole('button', { name: /^In review/ }));
    expect(within(main()).getAllByRole('button', { name: /^hello-world/ })).toHaveLength(1);
  });

  it('the base branch: another branch’s open pull request puts its entry in review', async () => {
    window.innerWidth = 375;
    fakeOnBranch({ draft: false }, 'main');
    const row = await screen.findByRole('button', { name: /^hello-world/ });
    await within(filterChips()).findByRole('button', { name: /^In review\s*1$/ });
    // Nothing changed on main itself.
    expect(within(filterChips()).getByRole('button', { name: /^Changed\s*0$/ })).toBeDefined();
    expect(row.textContent).toMatch(/^hello-worldIn review/);
  });

  it('the entry’s title badge: In review beats Changed on a branch with an open pull request', async () => {
    fakeOnBranch({ draft: false }, 'editlet/a', 'post/hello-world');
    await screen.findByRole('button', { name: /^Title/ });
    const badge = () =>
      within(main()).getByRole('heading', { level: 1 }).parentElement!.querySelector('[data-slot="badge"]');
    await waitFor(() => expect(badge()?.textContent).toBe('In review'));
  });

  it('in a wide window an entry in review has the In review badge', async () => {
    window.innerWidth = 600;
    fakeOnBranch({ draft: false });
    const row = await screen.findByRole('button', { name: /^hello-world/ });
    await waitFor(() => expect(row.querySelector('[data-slot="badge"]')?.textContent).toBe('In review'));
  });

  it('the base branch: a draft pull request puts nothing in review; the chip says so', async () => {
    fakeOnBranch({ draft: true }, 'main');
    await screen.findByRole('button', { name: /^hello-world/ });
    fireEvent.click(await within(filterChips()).findByRole('button', { name: /^In review\s*0$/ }));
    expect(within(main()).getByRole('status').textContent).toBe('Nothing in review.');
  });

  it('a draft pull request: Changed, nothing in review', async () => {
    window.innerWidth = 375;
    fakeOnBranch({ draft: true });
    const row = await screen.findByRole('button', { name: /^hello-world/ });
    await within(filterChips()).findByRole('button', { name: /^Changed\s*1$/ });
    expect(row.textContent).toMatch(/^hello-worldChanged · /);
    fireEvent.click(within(filterChips()).getByRole('button', { name: /^In review\s*0$/ }));
    expect(within(main()).getByRole('status').textContent).toBe('Nothing in review.');
  });
});

describe('A new entry', () => {
  it('the CTA counts the required fields, opens the first, and is Save once they are filled', async () => {
    const files = variantFiles();
    const schema = JSON.parse(files['cms/schema.json'] as string);
    schema.collections.post.fields.title.required = true;
    files['cms/schema.json'] = JSON.stringify(schema);
    renderApp({ files, route: 'post/brand-new' });
    const cta = await within(main()).findByRole('button', { name: 'Fill 1 required field' });
    fireEvent.click(cta);
    const title = await sheet('Title');
    fireEvent.change(title.getByLabelText(/^Title/), { target: { value: 'Filled' } });
    await doneField();
    expect(await within(main()).findByRole('button', { name: 'Save' })).toBeDefined();
  });
});

describe('New entry', () => {
  const open = async () => {
    fireEvent.click(await within(main()).findByRole('button', { name: 'New post' }));
    return within(await screen.findByRole('dialog', { name: 'New post' }));
  };

  it('asks for the name first; the address follows it and Create opens the blank entry', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    expect(dialog.getByText('Address')).toBeDefined();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'My Post' } });
    expect(dialog.getByText('my-post')).toBeDefined();

    fireEvent.click(dialog.getByRole('button', { name: 'Create post' }));
    expect(editletRoute()).toBe('post/my-post');
    expect(pendingNewEntries.get('post/my-post')).toEqual({ title: 'My Post' });
    expect(await within(main()).findByRole('group', { name: / fields$/ })).toBeDefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens with the cursor in the name', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByLabelText('Title')));
  });

  it('Create is off until there is an address; Enter in the name creates', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    expect((dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Enter' } });
    fireEvent.submit(dialog.getByLabelText('Title').closest('form')!);
    expect(editletRoute()).toBe('post/enter');
  });

  it('a taken address turns the name red with the reason and turns Create off', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    const name = dialog.getByLabelText('Title');
    fireEvent.change(name, { target: { value: 'Hello world' } });
    expect(dialog.getByRole('alert').textContent).toBe('A post with this address already exists');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect((dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Edit opens the address as a field: an invalid one is refused, an edited one stops following the name', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'My Post' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Edit the address' }));
    const address = dialog.getByLabelText('Address') as HTMLInputElement;
    expect(address.value).toBe('my-post');
    const create = dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement;

    fireEvent.change(address, { target: { value: 'Not A Slug' } });
    expect(dialog.getByRole('alert').textContent).toBe('The address can use lowercase letters, numbers and hyphens.');
    expect(address.getAttribute('aria-invalid')).toBe('true');
    expect(create.disabled).toBe(true);

    fireEvent.change(address, { target: { value: 'kept' } });
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Other title' } });
    expect(address.value).toBe('kept');
    expect(create.disabled).toBe(false);
  });

  it('a name with no Latin letters makes no address: the reason and Edit are there', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Привет мир' } });
    expect(dialog.getByRole('alert').textContent).toContain('This name makes no address');
    expect((dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: 'Edit the address' }));
    await waitFor(() => expect(document.activeElement).toBe(dialog.getByLabelText('Address')));
    fireEvent.change(dialog.getByLabelText('Address'), { target: { value: 'privet' } });
    expect((dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('a taken address keeps Edit next to the reason, and Edit puts the cursor in the address', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    const dialog = await open();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Hello world' } });
    expect(dialog.getByRole('alert').textContent).toBe('A post with this address already exists');
    fireEvent.click(dialog.getByRole('button', { name: 'Edit the address' }));
    const address = dialog.getByLabelText('Address') as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(address));
    fireEvent.change(address, { target: { value: 'hello-world-2' } });
    expect((dialog.getByRole('button', { name: 'Create post' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the page's address around the slug from the collection's url; Edit edits the slug only", async () => {
    renderApp({ files: postWith({ url: '/posts/{slug}/' }), route: 'post' });
    const dialog = await open();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Tires' } });
    const line = dialog.getByText('Address').parentElement!;
    expect(line.textContent).toBe('Address/posts/tires/Edit');
    fireEvent.click(dialog.getByRole('button', { name: 'Edit the address' }));
    const address = dialog.getByLabelText('Address') as HTMLInputElement;
    expect(address.value).toBe('tires');
    expect(address.parentElement!.textContent).toBe('/posts//');
    fireEvent.change(address, { target: { value: 'tires-2' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Create post' }));
    expect(editletRoute()).toBe('post/tires-2');
  });

  it('without {slug} in url, or without url, the address is the slug alone', async () => {
    for (const url of ['/blog', undefined]) {
      const { unmount } = renderApp({ files: postWith({ url }), route: 'post' });
      const dialog = await open();
      fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Tires' } });
      expect(dialog.getByText('Address').parentElement!.textContent).toBe('AddresstiresEdit');
      unmount();
    }
  });

  it('opens empty each time', async () => {
    renderApp({ files: variantFiles(), route: 'post' });
    let dialog = await open();
    fireEvent.change(dialog.getByLabelText('Title'), { target: { value: 'Left over' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    dialog = await open();
    expect((dialog.getByLabelText('Title') as HTMLInputElement).value).toBe('');
  });
});

describe('other routes', () => {
  it('schema renders the content model', async () => {
    renderApp({ route: 'schema' });
    expect(await within(main()).findByRole('heading', { name: 'Content model' })).toBeDefined();
    expect(await within(main()).findByRole('button', { name: /^Post/ })).toBeDefined();
  });

  it('branch:x in dev mode says branch preview is for production mode', async () => {
    renderApp({ route: 'branch:x' });
    expect(await within(main()).findByText('Branch preview is available in production mode.')).toBeDefined();
    expect(within(main()).getByRole('heading', { level: 1, name: 'Branch preview' })).toBeDefined();
    expect(within(main()).getByRole('heading', { level: 2, name: 'Branch preview' })).toBeDefined();
  });

  it('a/b/c and an unknown collection render not found', async () => {
    const { unmount } = renderApp({ route: 'a/b/c' });
    expect(await within(main()).findByRole('heading', { name: 'Not found' })).toBeDefined();
    unmount();
    renderApp({ route: 'nope' });
    expect(await within(main()).findByRole('heading', { name: 'Not found' })).toBeDefined();
  });
});

describe('App', () => {
  it('shows the not-configured screen when the dev API and config.json answer 404', async () => {
    const fetch = (async () => new Response('Not found', { status: 404 })) as unknown as typeof globalThis.fetch;
    render(<App fetch={fetch} queryClient={createTestQueryClient()} />);
    expect(await screen.findByRole('heading', { name: 'Editing is not set up' })).toBeDefined();
  });

  it('shows the schema issues when the dev API reports a broken schema', async () => {
    const body = JSON.stringify({ issues: [{ file: 'cms/schema.json', path: '', message: 'Invalid JSON' }] });
    const fetch = (async () => new Response(body, { status: 500 })) as unknown as typeof globalThis.fetch;
    render(<App fetch={fetch} queryClient={createTestQueryClient()} />);
    expect(await screen.findByText('cms/schema.json: Invalid JSON')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'The schema has errors' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Copy fix prompt' })).toBeDefined();
  });
});

describe('Shell embedded', () => {
  it('Escape outside a dialog collapses the window into the pill; the pill’s × posts close', async () => {
    const fake = createFakeWindow();
    render(<App source={createMemorySource(fixtureFiles())} win={fake.win} queryClient={createTestQueryClient()} />);
    act(() => fake.fromSite({ type: 'init', route: '', site: { origin: ORIGIN, href: `${ORIGIN}/` } }));
    await within(main()).findByRole('link', { name: HOME_LOADED });

    expect(screen.getByRole('button', { name: 'Appearance' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Minimize' })).toBeDefined();
    const sent = () => fake.parent.postMessage.mock.calls.map(([m]) => (m as { type: string }).type);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(sent()).not.toContain('close');
    fireEvent.click(screen.getByRole('button', { name: 'Close Editlet' }));
    expect(sent()).toContain('close');
  });
});
