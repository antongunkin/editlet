import { AuthError } from '../auth/client.ts';

export interface GitHubClientOptions {
  /** Token or getter (called per request, so a refreshed token is picked up). */
  token: string | (() => string | Promise<string>);
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface RestInit {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  accept?: string;
  raw?: boolean;
  fresh?: boolean;
}

export interface GitHubClient {
  rest<T>(method: string, path: string, init?: RestInit): Promise<T>;
  graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  readonly sleep: (ms: number) => Promise<void>;
}

export type GitHubErrorCode =
  | 'not_found'
  | 'rate_limited'
  | 'network_error'
  | 'branch_exists'
  | 'no_changes'
  | 'invalid_branch'
  | 'graphql_error'
  | 'http_error';

export interface GraphQLErrorItem {
  type?: string;
  message: string;
}

export class GitHubError extends Error {
  code: GitHubErrorCode;
  status?: number;
  retryAt?: number;
  graphqlErrors?: GraphQLErrorItem[];

  constructor(
    code: GitHubErrorCode,
    message: string,
    extra?: { status?: number; retryAt?: number; graphqlErrors?: GraphQLErrorItem[] },
  ) {
    super(message);
    this.name = 'GitHubError';
    this.code = code;
    this.status = extra?.status;
    this.retryAt = extra?.retryAt;
    this.graphqlErrors = extra?.graphqlErrors;
  }
}

/** Encodes each segment of a ref/branch name, keeping `/`. */
export function encodeRef(name: string): string {
  return name.split('/').map(encodeURIComponent).join('/');
}

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_ATTEMPTS = 3;
const MAX_WAIT_MS = 60_000;
const READ_CONCURRENCY = 6;
const WRITE_WINDOWS: [number, number][] = [
  [60_000, 80],
  [3_600_000, 500],
];

class Semaphore {
  private active = 0;
  private waiters: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) next(); // hand the slot over
    else this.active--;
  }
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

function parseJson(body: Uint8Array): unknown {
  if (body.length === 0) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return undefined;
  }
}

function messageOf(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === 'object' && typeof (parsed as { message?: unknown }).message === 'string') {
    // Validation failures (422) carry the useful text in `errors[]`.
    const details = errorsOf(parsed)
      .map((e) => (typeof e === 'string' ? e : e?.message))
      .filter((m): m is string => typeof m === 'string' && m !== '');
    const message = (parsed as { message: string }).message;
    return details.length > 0 ? `${message}: ${details.join('; ')}` : message;
  }
  return `GitHub request failed with status ${status}`;
}

function errorsOf(parsed: unknown): GraphQLErrorItem[] {
  const errs = (parsed as { errors?: GraphQLErrorItem[] } | undefined)?.errors;
  return Array.isArray(errs) ? errs : [];
}

function mapError(res: RawResponse, parsed: unknown): Error {
  const message = messageOf(parsed, res.status);
  if (res.status === 401) return new AuthError('unauthorized', message);
  if (res.status === 403) return new AuthError('forbidden', message);
  if (res.status === 404) return new GitHubError('not_found', message, { status: 404 });
  return new GitHubError('http_error', message, { status: res.status });
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  const doFetch: typeof fetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  const readSlots = new Semaphore(READ_CONCURRENCY);
  const writeSlots = new Semaphore(1); // FIFO, one in flight
  const writeStarts: number[] = [];

  async function waitForWriteSlot(): Promise<void> {
    // One sleep to the moment the slot frees; writes are serialized, so nothing else claims it meanwhile.
    const t = now();
    let wait = 0;
    for (const [windowMs, max] of WRITE_WINDOWS) {
      const recent = writeStarts.filter((s) => t - s < windowMs);
      if (recent.length >= max) {
        // the slot frees when the (len - max + 1)-th newest-to-oldest start leaves the window
        wait = Math.max(wait, recent[recent.length - max]! + windowMs - t);
      }
    }
    if (wait > 0) await sleep(wait);
    const start = now();
    writeStarts.push(start);
    const cutoff = start - WRITE_WINDOWS[1]![0];
    while (writeStarts.length > 0 && writeStarts[0]! < cutoff) writeStarts.shift();
  }

  async function withGate<T>(isWrite: boolean, fn: () => Promise<T>): Promise<T> {
    if (!isWrite) {
      await readSlots.acquire();
      try {
        return await fn();
      } finally {
        readSlots.release();
      }
    }
    await writeSlots.acquire();
    try {
      await waitForWriteSlot();
      return await fn();
    } finally {
      writeSlots.release();
    }
  }

  async function send(url: string, init: RequestInit): Promise<RawResponse> {
    const token = typeof options.token === 'function' ? await options.token() : options.token;
    const headers = { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` };
    try {
      const res = await doFetch(url, { ...init, headers });
      const body = new Uint8Array(await res.arrayBuffer()); // a dropped body rejects here
      return { status: res.status, headers: res.headers, body };
    } catch (e) {
      throw new GitHubError('network_error', e instanceof Error ? e.message : 'Network request failed');
    }
  }

  /** Wait in ms when the response is a rate limit, else null. */
  function rateLimitWait(res: RawResponse, parsed: unknown): number | null {
    if (res.status !== 403 && res.status !== 429) return null;
    const retryAfter = res.headers.get('retry-after');
    const message = parsed && typeof parsed === 'object' ? (parsed as { message?: unknown }).message : undefined;
    const limited =
      res.headers.get('x-ratelimit-remaining') === '0' ||
      retryAfter !== null ||
      (typeof message === 'string' && /rate limit/i.test(message));
    if (!limited) return null;
    return waitMs(res.headers);
  }

  function waitMs(headers: Headers): number {
    const retryAfter = headers.get('retry-after');
    if (retryAfter !== null && retryAfter !== '' && Number.isFinite(Number(retryAfter))) {
      return Number(retryAfter) * 1000;
    }
    const reset = headers.get('x-ratelimit-reset');
    if (reset !== null && reset !== '' && Number.isFinite(Number(reset))) {
      return Math.max(0, Number(reset) * 1000 - now());
    }
    return MAX_WAIT_MS;
  }

  /** Sends with rate-limit retry; resolves with a 2xx response, or throws. Gate is held by the caller. */
  async function execute(
    url: string,
    init: RequestInit,
    graphqlRetryable?: (parsed: unknown) => number | null,
  ): Promise<{ res: RawResponse; parsed: unknown }> {
    for (let attempt = 1; ; attempt++) {
      const res = await send(url, init);
      const parsed = res.status === 204 ? undefined : parseJson(res.body);
      let wait: number | null = null;
      if (res.status >= 200 && res.status < 300) {
        wait = graphqlRetryable ? graphqlRetryable(parsed) : null;
        if (wait === null) return { res, parsed };
      } else {
        wait = rateLimitWait(res, parsed);
        if (wait === null) throw mapError(res, parsed);
      }
      if (wait > MAX_WAIT_MS || attempt >= MAX_ATTEMPTS) {
        throw new GitHubError('rate_limited', 'GitHub rate limit exceeded', {
          status: res.status,
          retryAt: now() + wait,
        });
      }
      await sleep(wait);
    }
  }

  async function rest<T>(method: string, path: string, init: RestInit = {}): Promise<T> {
    const verb = method.toUpperCase();
    let url = `${API}${path}`;
    if (init.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.query)) if (v !== undefined) params.set(k, String(v));
      const qs = params.toString();
      if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`;
    }
    const headers: Record<string, string> = {
      Accept: init.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
    };
    const req: RequestInit = { method: verb, headers };
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      req.body = JSON.stringify(init.body);
    }
    if (init.fresh) req.cache = 'no-cache';
    const isWrite = verb !== 'GET' && verb !== 'HEAD';
    const { res, parsed } = await withGate(isWrite, () => execute(url, req));
    if (res.status === 204) return undefined as T;
    if (init.raw) return res.body as T;
    return parsed as T;
  }

  async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const req: RequestInit = {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    };
    const isMutation = /^\s*mutation/.test(query);
    const retryable = (parsed: unknown): number | null => {
      const errs = errorsOf(parsed);
      if (errs.length > 0 && errs.every((e) => e.type === 'RATE_LIMITED')) return MAX_WAIT_MS;
      return null;
    };
    const { parsed } = await withGate(isMutation, () => execute(`${API}/graphql`, req, retryable));
    const errs = errorsOf(parsed);
    // GitHub reports a missing permission as HTTP 200 with a FORBIDDEN error
    const forbidden = errs.find((e) => e.type === 'FORBIDDEN');
    if (forbidden) throw new AuthError('forbidden', errs.map((e) => e.message).join('; '));
    if (errs.length > 0) {
      throw new GitHubError('graphql_error', errs.map((e) => e.message).join('; '), { graphqlErrors: errs });
    }
    return (parsed as { data: T }).data;
  }

  return { rest, graphql, sleep };
}
