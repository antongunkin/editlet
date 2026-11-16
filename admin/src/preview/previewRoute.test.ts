import { afterEach, describe, expect, it, vi } from 'vitest';

import { deletePreview, postPreview } from './previewRoute';

import { PREVIEW_ROUTE } from '../../../loader/protocol';

const SHA = 'a'.repeat(40);

afterEach(() => vi.restoreAllMocks());

describe('postPreview', () => {
  it('postPreview sends the bearer token and body', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await postPreview({ branch: 'editlet/x', sha: SHA, token: 'tok_1', fetch })).toBe(true);
    expect(fetch).toHaveBeenCalledWith(PREVIEW_ROUTE, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok_1' },
      body: JSON.stringify({ branch: 'editlet/x', sha: SHA }),
      signal: expect.any(AbortSignal),
    });
  });

  it('postPreview gives up after 10 s: a hung route counts as a failed POST', async () => {
    const timer = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')));
        }),
    );
    const result = postPreview({ branch: 'editlet/x', sha: SHA, token: 'tok_1', fetch });
    expect(timeout).toHaveBeenCalledWith(10_000);
    timer.abort();
    expect(await result).toBe(false);
  });

  it('postPreview returns false on 403', async () => {
    const fetch = vi.fn(async () => new Response('No push access', { status: 403 }));
    expect(await postPreview({ branch: 'editlet/x', sha: SHA, token: 'tok_1', fetch })).toBe(false);
  });

  it('postPreview returns false when the route cannot be reached', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(await postPreview({ branch: 'editlet/x', sha: SHA, token: 'tok_1', fetch })).toBe(false);
  });
});

describe('deletePreview', () => {
  it('sends DELETE with the same-origin cookie', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await deletePreview(fetch);
    expect(fetch).toHaveBeenCalledWith(PREVIEW_ROUTE, {
      method: 'DELETE',
      credentials: 'same-origin',
      signal: expect.any(AbortSignal),
    });
  });

  it('ignores errors', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(deletePreview(fetch)).resolves.toBeUndefined();
  });
});
