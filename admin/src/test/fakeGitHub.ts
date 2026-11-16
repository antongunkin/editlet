// The P7 GitHub fake set up for the admin: repo `o/r`, `main` = the node fixture site, plus the two REST reads the
// admin's access check makes (`GET /user`, `GET /repos/o/r`), which the P7 fake does not route.
import { fixtureFiles } from './fixture';

import { createFakeGitHub, json, type FakeGitHub, type FileInput } from '../../../github/test/fakeGitHub';

export type AdminFakeGitHub = FakeGitHub & { fetch: typeof fetch };

export function createAdminFakeGitHub(
  opts: {
    files?: Record<string, FileInput>;
    push?: boolean;
    admin?: boolean;
    login?: string;
    repoMissing?: boolean;
  } = {},
): AdminFakeGitHub {
  const fake = createFakeGitHub({ owner: 'o', repo: 'r', branches: { main: opts.files ?? fixtureFiles() } });
  const login = opts.login ?? 'octocat';
  const push = opts.push ?? true;

  async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? 'GET').toUpperCase();
    const isUser = url.pathname === '/user';
    const isRepo = url.pathname === `/repos/${fake.state.owner}/${fake.state.repo}`;
    if (url.origin !== 'https://api.github.com' || method !== 'GET' || !(isUser || isRepo)) {
      return fake.fetch(input, init);
    }
    fake.calls.push({ method, url: url.toString() });
    const auth = new Headers(init.headers).get('authorization');
    if (!auth?.startsWith('Bearer ') || auth === 'Bearer bad') {
      return json({ message: 'Bad credentials', status: '401' }, 401);
    }
    if (isUser) return json({ login, avatar_url: `https://avatars.test/${login}.png` });
    if (opts.repoMissing) return json({ message: 'Not Found', status: '404' }, 404);
    return json({
      full_name: `${fake.state.owner}/${fake.state.repo}`,
      permissions: { push, admin: opts.admin === true, maintain: opts.admin === true },
    });
  }

  return { ...fake, fetch: adminFetch as typeof fetch };
}
