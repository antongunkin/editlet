# Draft preview (Next.js)

The page overlay works everywhere without setup. The draft render is extra and Next.js only: after **Save** on a
`editlet/*` branch, the live site renders the page from that branch in Next draft mode. Set it up only when the human asks
for it.

## 1. Turn it on

```ts
// next.config.ts
export default withEditlet(nextConfig, {
  admin: { authUrl: '…', preview: true },
});
```

`preview: true` needs a known repository (`admin.repo`, or Vercel's git env) and `git.baseBranch` in the schema.

## 2. The route

```ts
// src/app/api/editlet/preview/route.ts
export { POST, DELETE } from 'editlet/next/preview';
```

## 3. Server env variables

Add the names to `.env.example`; the human sets the values in the host.

| Name | Value |
|---|---|
| `CMS_PREVIEW_SECRET` | At least 32 random characters. The human generates it: `openssl rand -base64 32` |
| `CMS_GITHUB_TOKEN` | A fine-grained GitHub token with read-only **Contents** access to the repository |

## 4. Pages read the preview ref

Every read on a content page passes `{ ref }`, list pages too:

```tsx
import { editletField, previewRef } from 'editlet/next';
import { getEntry } from '@/lib/cms';

const ref = await previewRef(); // { branch, sha } in an editor's draft render, else undefined
const post = await getEntry('post', slug, { ref });
return <h1 {...editletField(post, 'title')}>{post.data.title}</h1>;
```

- Call `previewRef()` outside any `'use cache'` scope.
- Do not set `dynamicParams = false` on content routes: a draft can add a slug that was not built.
- Change only the pages the human names, or list the pages that read content and ask.

## Limits to mention

- Images that exist only on the branch are broken in the draft render until the branch deploys.
- Behind a TLS proxy, forward `Host` / `X-Forwarded-Host` and `X-Forwarded-Proto`, or the route answers `403`.
