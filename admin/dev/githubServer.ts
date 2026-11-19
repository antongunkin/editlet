// The built admin in GitHub mode against an in-memory fake GitHub (repo `o/r`, `main` = the node fixture site), with
// a fake sign-in popup and fake branch previews, so the whole sign-in → save → pull request flow runs in a real browser.
// `githubHost.ts` runs it from the command line; the Playwright suite (admin/e2e/) starts one per test on a free port.
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ADMIN_PREFIX, buildDemoSite, CONTENT_TYPES, listen, pageEntries, send, serveAdmin } from './serve';

import { AUTH_MESSAGE_SOURCE, type AuthMessage } from '../../auth/protocol';
import { DEV_API_BASE } from '../../core/devApi';
import { decodeUtf8, parseEntryFile } from '../../core/entryFile';
import { EditletError } from '../../core/issues';
import { isHiddenContentPath, parseEntryPath } from '../../core/paths';
import { parseSchemaText, type Schema } from '../../core/schema';
import type { Entry } from '../../core/validate';
import type { FileInput } from '../../github/test/fakeGitHub';
import { DEFAULT_SCHEMA_PATH } from '../../node/fs';
import { ADMIN_CONFIG_FILE, type AdminConfig } from '../config';
import { createAdminFakeGitHub, type AdminFakeGitHub } from '../src/test/fakeGitHub';

const GITHUB_API = 'https://api.github.com/';
const FAKE_GITHUB = '/__fake-github/';
const FAKE_AUTH = '/__fake-auth';
const BASE_BRANCH = 'main';
const DEPLOY_POLL_MS = 1000;

export interface GitHubHostOptions {
  /** `0` (the default) picks a free port. */
  port?: number;
  /** The files of `main`; default the node fixture site. */
  files?: Record<string, FileInput>;
  /** The signed-in account: its login and repository permissions (default `octocat`, push, not admin). */
  login?: string;
  push?: boolean;
  admin?: boolean;
  /** `GET /repos/o/r` answers 404 ("Can't open o/r"). */
  repoMissing?: boolean;
  /** `config.json` for this origin; `null` answers 404 ("not set up"). Default: the fake repo and the fake sign-in. */
  config?: (origin: string) => AdminConfig | null;
  /** Add a `success` preview deployment for each new `editlet/*` head every second (default `true`). */
  autoDeploy?: boolean;
}

export interface GitHubHost {
  origin: string;
  /** The in-memory GitHub: tests read and change `fake.state` (pull requests, reviews, deployments). */
  fake: AdminFakeGitHub;
  /** Adds a deployment of `ref` at its head with one status (`success`, `in_progress`, `failure`…). */
  deploy(ref: string, state?: string): void;
  close(): Promise<void>;
}

/** `<script>` text that sends the admin's `https://api.github.com/…` requests to this host's fake. */
const FETCH_REWRITE = `<script>
(() => {
  const api = ${JSON.stringify(GITHUB_API)};
  const local = location.origin + ${JSON.stringify(FAKE_GITHUB)};
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!href.startsWith(api)) return original(input, init);
    const url = local + href.slice(api.length);
    return original(input instanceof Request ? new Request(url, input) : url, init);
  };
})();
</script>
`;

/** Puts `FETCH_REWRITE` before the module script, so the admin's first request already goes to the fake. */
function injectFetchRewrite(html: string): string {
  const at = html.indexOf('<script type="module"');
  if (at === -1) throw new Error('admin index.html has no module script');
  return html.slice(0, at) + FETCH_REWRITE + html.slice(at);
}

/** The popup `startLogin` opens: hands a fake token to the opener at `?origin` and closes. */
function fakeAuthPage(): string {
  const message: AuthMessage = {
    source: AUTH_MESSAGE_SOURCE,
    ok: true,
    token: { access_token: 'fake', token_type: 'bearer', scope: '' },
  };
  const data = JSON.stringify(message).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Fake GitHub sign-in</title></head>
  <body>
    <p>Signing in…</p>
    <script>
      const target = new URLSearchParams(location.search).get('origin');
      if (window.opener && target) {
        window.opener.postMessage(${data}, target);
        window.close();
      } else {
        document.body.textContent = 'Open this page from the admin sign-in.';
      }
    </script>
  </body>
</html>
`;
}

/** The schema and entries of the fake's current `main` (unreadable files are left out); `null` without a schema. */
function mainProject(fake: AdminFakeGitHub): { schema: Schema; entries: Entry[] } | null {
  const head = fake.state.commits.get(fake.state.refs.get(BASE_BRANCH) ?? '');
  if (!head) return null;
  const text = (path: string): string | null => {
    const sha = head.files.get(path);
    const bytes = sha === undefined ? undefined : fake.state.blobs.get(sha);
    if (!bytes) return null;
    const decoded = decodeUtf8(bytes, path);
    return 'text' in decoded ? decoded.text : null;
  };
  const schemaText = text(DEFAULT_SCHEMA_PATH);
  if (schemaText === null) return null;
  try {
    const schema = parseSchemaText(schemaText, DEFAULT_SCHEMA_PATH);
    const entries: Entry[] = [];
    for (const path of [...head.files.keys()].toSorted()) {
      const parsed = isHiddenContentPath(schema, path) ? null : parseEntryPath(schema, path);
      const source = parsed && text(path);
      if (!parsed || source === null) continue;
      try {
        const { data, body } = parseEntryFile(source);
        entries.push({ ...parsed, data, body });
      } catch (error) {
        if (!(error instanceof EditletError)) throw error;
      }
    }
    return { schema, entries };
  } catch (error) {
    if (error instanceof EditletError) return null;
    throw error;
  }
}

/** A fixed time for deployments, so screenshots and tests never depend on the clock. */
const DEPLOYED_AT = '2026-11-15T09:30:00Z';

function addDeployment(fake: AdminFakeGitHub, ref: string, sha: string, state: string, url: string): void {
  const id = fake.state.deployments.length + 1;
  fake.state.deployments.unshift({
    id,
    sha,
    ref,
    environment: 'Preview',
    created_at: DEPLOYED_AT,
    updated_at: DEPLOYED_AT,
  });
  const status = state === 'failure' || state === 'error' ? { log_url: `${url}build-log` } : { environment_url: url };
  fake.state.deploymentStatuses.set(id, [{ state, ...status, created_at: DEPLOYED_AT }]);
}

/** A `success` preview deployment for every `editlet/*` head that has none. */
function reportDeployments(fake: AdminFakeGitHub, origin: string): void {
  for (const [ref, sha] of fake.state.refs) {
    if (!ref.startsWith('editlet/')) continue;
    if (!fake.state.deployments.some((d) => d.ref === ref && d.sha === sha)) {
      addDeployment(fake, ref, sha, 'success', `${origin}/`);
    }
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

/** `/__fake-github/<rest>` → the fake at `https://api.github.com/<rest>`; returns its status, type and bytes. */
async function proxyFakeGitHub(
  fake: AdminFakeGitHub,
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<void> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const body = await readBody(req);
  const response = await fake.fetch(GITHUB_API + url.slice(FAKE_GITHUB.length), {
    method: req.method,
    headers,
    body: body.length > 0 ? body.toString('utf8') : undefined,
  });
  res.statusCode = response.status;
  const type = response.headers.get('content-type');
  if (type) res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(new Uint8Array(await response.arrayBuffer()));
}

export async function startGitHubHost(opts: GitHubHostOptions = {}): Promise<GitHubHost> {
  const site = await buildDemoSite();
  const fake = createAdminFakeGitHub({
    files: opts.files,
    login: opts.login,
    push: opts.push,
    admin: opts.admin,
    repoMissing: opts.repoMissing,
  });
  const { owner, repo } = fake.state;
  let origin = '';
  const configFor =
    opts.config ??
    ((at: string): AdminConfig => ({ github: { owner, repo, baseBranch: BASE_BRANCH }, authUrl: `${at}${FAKE_AUTH}` }));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];

    if (pathname.startsWith(FAKE_GITHUB)) {
      await proxyFakeGitHub(fake, req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method not allowed');
      return;
    }
    if (pathname === `${FAKE_AUTH}/auth`) {
      send(res, 200, fakeAuthPage(), CONTENT_TYPES['.html']);
      return;
    }
    if (pathname.startsWith(DEV_API_BASE)) {
      send(res, 404, 'Not found');
      return;
    }
    if (pathname === '/') {
      send(res, 200, site.page(mainProject(fake)?.entries ?? []), CONTENT_TYPES['.html']);
      return;
    }
    if (pathname === '/site.js') {
      send(res, 200, site.siteJs, CONTENT_TYPES['.js']);
      return;
    }
    if (pathname === `${ADMIN_PREFIX}${ADMIN_CONFIG_FILE}`) {
      const config = configFor(origin);
      if (config) send(res, 200, JSON.stringify(config), CONTENT_TYPES['.json']);
      else send(res, 404, 'Not found');
      return;
    }
    if (pathname.startsWith(ADMIN_PREFIX)) {
      await serveAdmin(pathname, res, injectFetchRewrite);
      return;
    }
    // An entry's own page on `main` (`/posts/<slug>` on the fixture): only its card. Any other path stays a plain 404.
    const project = mainProject(fake);
    const shown = project ? pageEntries(project.schema, project.entries, pathname) : [];
    if (shown.length > 0) {
      send(res, 200, site.page(shown), CONTENT_TYPES['.html']);
      return;
    }
    send(res, 404, 'Not found');
  }

  const server = await listen(handle, opts.port ?? 0);
  origin = server.origin;
  const timer =
    opts.autoDeploy === false ? undefined : setInterval(() => reportDeployments(fake, origin), DEPLOY_POLL_MS);
  return {
    origin,
    fake,
    deploy(ref, state = 'success') {
      const sha = fake.state.refs.get(ref);
      if (!sha) throw new Error(`No branch ${ref}`);
      addDeployment(fake, ref, sha, state, `${origin}/`);
    },
    async close() {
      clearInterval(timer);
      await server.close();
    },
  };
}
