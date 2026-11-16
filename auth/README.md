# Editlet auth handler

Finishes GitHub App sign-in for the Editlet admin, which runs entirely in the browser.

**Why it exists.** GitHub's token endpoint has no CORS and always needs the client secret, so a browser cannot finish
OAuth alone. This handler holds the secret, swaps the sign-in code for a user token, refreshes expiring tokens, and
gives tokens only to allowlisted admin origins. It stores nothing: no database, no KV, no token logs.

**What it is.** One Web-standard function, `handleRequest(request, env) → Response`, with no dependencies. It runs on
Cloudflare Workers, Vercel/Next.js, Node in Docker (AWS and others), Bun and Deno.

## How it works

1. The admin opens a popup at `/auth`. The handler sends the user to GitHub with PKCE and a `state` cookie.
2. GitHub sends the user back to `/callback`. The handler checks `state`, swaps the code for tokens, and posts them to
   the admin window with `postMessage`. Only an allowlisted origin can receive them.
3. Access tokens live 8 hours. The admin calls `/refresh` to get a new pair; each refresh token works once.

## Features

| Feature | Doc |
|---|---|
| Popup sign-in: PKCE, `state` cookie, token handoff | [docs/auth/sign-in.md](../../../docs/auth/sign-in.md) |
| Token refresh and rotation | [docs/auth/refresh.md](../../../docs/auth/refresh.md) |
| Origin allowlist: who may receive tokens | [docs/auth/allowlist.md](../../../docs/auth/allowlist.md) |
| Hosting: GitHub App setup, Cloudflare, Vercel, Docker/AWS, Bun, Deno, local test | [docs/auth/hosting.md](../../../docs/auth/hosting.md) |
| Browser client for the admin: `startLogin`, `refresh`, errors | [docs/auth/client.md](../../../docs/auth/client.md) |

## Configuration

| Variable | Required | Example |
|---|---|---|
| `GITHUB_CLIENT_ID` | yes | `Iv23li...` (the app's client ID, not its app ID) |
| `GITHUB_CLIENT_SECRET` | yes, as a secret | — |
| `ALLOWED_ORIGINS` | yes | `https://example.com, https://*.preview.example.com` |
| `PUBLIC_URL` | behind a proxy or under a path | `https://example.com/api/editlet/oauth` |

## Endpoints

Paths are relative to the public URL (`PUBLIC_URL`, or the host root when it is unset). Anything else returns `404`.

| Endpoint | Purpose |
|---|---|
| `GET /auth?origin=<admin origin>` | Starts sign-in (popup) |
| `GET /callback` | GitHub returns here; the page posts the result to the admin |
| `POST /refresh`, `OPTIONS /refresh` | New tokens from a refresh token (CORS) |
| `GET /health` | `204` for health checks |

## Files

| File | Role |
|---|---|
| `handler.ts` | All logic: routing, sign-in, refresh, allowlist |
| `worker.ts` / `server.ts` | Entries for Cloudflare / for Node, Bun and Deno |
| `client.ts`, `protocol.ts` | Browser helper and shared message types |
| `Dockerfile`, `wrangler.toml` | Container image / Cloudflare config |
