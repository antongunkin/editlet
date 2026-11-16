# Editing on the live site

On the live site there is no dev API. The editor signs in with GitHub, commits to `editlet/<name>` branches (`git.branchPrefix`) and opens pull
requests; a merge publishes. You set up four things: the auth handler, the GitHub App, the `admin` options, and branch
protection. The human does every step outside the repo; you prepare the files and give exact values.

## 1. Choose where the auth handler runs

It needs one stable public HTTPS URL. Preview deploys sign in through the production URL too.

| Site | Host the handler | `authUrl` |
|---|---|---|
| Next.js (Vercel or Node) | A route in the site (below) | `https://<production domain>/api/editlet/oauth` |
| Astro with an SSR adapter | An endpoint in the site | `https://<production domain>/api/editlet/oauth` |
| Static Astro, or any other site | A Cloudflare Worker, or a Node / Bun / Deno server | The worker or server URL |

If the human did not say, recommend the route in the site for Next.js and a Cloudflare Worker for static Astro, and
ask once.

**Next.js route:**

```ts
// src/app/api/editlet/oauth/[...path]/route.ts
import { handleRequest, type Env } from 'editlet/auth';

const handler = (request: Request) => handleRequest(request, process.env as Env);
export { handler as GET, handler as OPTIONS, handler as POST };
```

Keep this route out of middleware and out of site-wide CSP and COOP headers.

**Astro SSR endpoint:**

```ts
// src/pages/api/editlet/oauth/[...path].ts
import { handleRequest } from 'editlet/auth';

export const prerender = false;
export const ALL = ({ request }) => handleRequest(request, process.env);
```

**Cloudflare Worker** (a separate folder or repo, not the site):

```ts
// worker.ts
import { handleRequest, type Env } from 'editlet/auth';
export default { fetch: (request: Request, env: Env) => handleRequest(request, env) };
```

```toml
# wrangler.toml
name = "editlet-auth"
main = "worker.ts"
compatibility_date = "2026-11-01"
keep_vars = true
```

The human deploys it (`npx wrangler@4 deploy`) and sets the secret (`npx wrangler@4 secret put
GITHUB_CLIENT_SECRET`). Its URL is `https://editlet-auth.<account>.workers.dev`.

## 2. The `admin` options

```ts
// next.config.ts
export default withEditlet(nextConfig, {
  admin: { authUrl: 'https://example.com/api/editlet/oauth' },
});
```

```js
// astro.config.mjs
integrations: [editlet({ admin: { repo: 'acme/site', authUrl: 'https://editlet-auth.acme.workers.dev' } })];
```

- `repo` (`owner/name`) can be left out on Vercel and in GitHub Actions; the adapters read it from their env. Set it
  for any other host.
- `authUrl` must be absolute `https` (or `http://localhost`), or a path starting with `/`.
- On Vercel, build it from the production domain so preview deploys use the same handler:
  `authUrl: \`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/api/editlet/oauth\``. Fall back to the literal
  domain when the variable is not set (local builds).
- Everything in `admin` is written to the public `/editlet/config.json`. NEVER put a secret there.

## 3. Environment variables

Write the names to `.env.example` (create it if missing), with empty values and a comment each. NEVER write values.

```text
# GitHub App client ID (not the App ID)
GITHUB_CLIENT_ID=
# GitHub App client secret: set it in the host as a secret, never in a file
GITHUB_CLIENT_SECRET=
# Origins of the admin pages, comma-separated: https://example.com
ALLOWED_ORIGINS=
# Only behind a proxy or under a path: https://example.com/api/editlet/oauth
PUBLIC_URL=
```

Tell the human where to set them: Vercel → Project → Settings → Environment Variables (Production, and Preview if
previews should sign in), Cloudflare → the worker's Variables and Secrets. If they want you to run `vercel env add`,
ask first and let them type the secret value themselves.

**`ALLOWED_ORIGINS`** is the main security setting: any page on an allowed origin can get a signed-in user's token.
List the site's own origin(s). A wildcard is allowed only in the host and only on a domain the team owns
(`https://*.preview.example.com`). NEVER suggest a wildcard on a shared domain: `*.vercel.app`, `*.netlify.app`,
`*.pages.dev`, `*.github.io`, `*.workers.dev`.

## 4. The GitHub App (the human creates it)

Give these values; the human fills them in at GitHub → Settings → Developer settings → GitHub Apps → New GitHub App
(or the organization's settings):

| Field | Value |
|---|---|
| GitHub App name | for example `<site> Editlet` |
| Homepage URL | the site URL |
| Callback URL | `<authUrl>/callback`, for example `https://example.com/api/editlet/oauth/callback` |
| Expire user authorization tokens | on |
| Webhook | off (untick Active) |
| Repository permissions | Contents: Read and write; Pull requests: Read and write; Deployments: Read-only |
| Where can it be installed | Only on this account |

Then: generate a client secret (it goes into `GITHUB_CLIENT_SECRET` in the host), copy the **Client ID** into
`GITHUB_CLIENT_ID`, and install the app on the content repository.

## 5. Protect the base branch

An editor's token can merge through the GitHub API, so only GitHub can enforce review. Tell the human to add a ruleset
on the base branch (GitHub → repo Settings → Rules → Rulesets → New branch ruleset): target the base branch, require
a pull request with at least one approval, and allow no bypass. If they ask you to do it with `gh api`, show the exact
command and run it only after an explicit yes. If they want editors who change only content, follow
[roles](roles.md) instead: it includes this ruleset.

## 6. Headers

The site must not send `Cross-Origin-Opener-Policy: same-origin`: it cuts the sign-in popup off. Use `unsafe-none`
(the default) or `same-origin-allow-popups`. Check `headers()` in `next.config.*`, middleware, `vercel.json` and
`_headers`.

## 7. Verify after the deploy

```bash
node .claude/skills/editlet-setup/scripts/doctor.mjs --url https://example.com
```

Then the human opens `https://example.com/?editlet`, signs in with GitHub, saves an edit, and sees an `editlet/*` branch and
the **Review changes** screen. Branch previews show only when the host reports deployments to GitHub (Vercel does).

## What the human does, as a checklist for your final message

1. Create the GitHub App with the values in § 4, generate the secret, install the app.
2. Set the variables in the host (§ 3).
3. Add the branch ruleset (§ 5).
4. Deploy, then run `doctor --url` or ask you to.
