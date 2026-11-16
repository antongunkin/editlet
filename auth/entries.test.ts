// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import server from './server.ts';
import worker from './worker.ts';

const origin = encodeURIComponent('https://site.example');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('entry points', () => {
  it('Cloudflare entry reads configuration from the env bindings', async () => {
    const res = await worker.fetch(new Request(`https://auth.example/auth?origin=${origin}`), {
      GITHUB_CLIENT_ID: 'cid',
      GITHUB_CLIENT_SECRET: 'csecret',
      ALLOWED_ORIGINS: 'https://site.example',
    });
    expect(res.status).toBe(302);
  });

  it('server entry (Node, Bun, Deno) reads configuration from process.env', async () => {
    vi.stubEnv('GITHUB_CLIENT_ID', 'cid');
    vi.stubEnv('GITHUB_CLIENT_SECRET', 'csecret');
    vi.stubEnv('ALLOWED_ORIGINS', 'https://site.example');
    vi.stubEnv('PUBLIC_URL', 'https://auth.example.com');
    const res = await server.fetch(new Request(`http://0.0.0.0:3000/auth?origin=${origin}`));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('redirect_uri')).toBe(
      'https://auth.example.com/callback',
    );
  });
});
