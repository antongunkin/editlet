import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditletLoader } from './EditletLoader';

const refresh = vi.fn();
const push = vi.fn();
let search = new URLSearchParams();
const sync = vi.fn();
const mountEditletLoader = vi.fn((_options?: unknown) => ({ sync, close: vi.fn(), destroy: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => '/',
  useSearchParams: () => search,
}));
vi.mock('../loader', () => ({ mountEditletLoader: (o?: unknown) => mountEditletLoader(o) }));

type Opts = {
  adminUrl: string;
  param?: string;
  onRefresh: () => void;
  replaceUrl: (url: string) => void;
  onOpen: (url: string) => void;
};
const lastOpts = () => mountEditletLoader.mock.calls.at(-1)![0] as Opts;

beforeEach(() => {
  vi.clearAllMocks();
  search = new URLSearchParams();
});

describe('EditletLoader', () => {
  it('mounts the loader with the default admin url and syncs', () => {
    render(<EditletLoader />);
    expect(lastOpts().adminUrl).toBe('/editlet/index.html');
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('passes a custom adminUrl', () => {
    render(<EditletLoader adminUrl="/x/admin.html" />);
    expect(lastOpts().adminUrl).toBe('/x/admin.html');
  });

  it('passes the EDITLET_PARAM that withEditlet injects', () => {
    vi.stubEnv('EDITLET_PARAM', 'cms');
    render(<EditletLoader />);
    expect(lastOpts().param).toBe('cms');
    vi.unstubAllEnvs();
  });

  it('replaceUrl writes null history state', () => {
    const spy = vi.spyOn(history, 'replaceState');
    render(<EditletLoader />);
    lastOpts().replaceUrl('/x?editlet=a');
    expect(spy).toHaveBeenCalledWith(null, '', '/x?editlet=a');
    spy.mockRestore();
  });

  it('onRefresh calls router.refresh', () => {
    render(<EditletLoader />);
    lastOpts().onRefresh();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('onOpen pushes the URL with the router', () => {
    render(<EditletLoader />);
    lastOpts().onOpen('http://localhost:3000/posts/a?editlet=post/a');
    expect(push).toHaveBeenCalledExactlyOnceWith('http://localhost:3000/posts/a?editlet=post/a');
  });

  it('syncs again when search params change', () => {
    const { rerender } = render(<EditletLoader />);
    search = new URLSearchParams('editlet=a');
    rerender(<EditletLoader />);
    expect(sync).toHaveBeenCalledTimes(2);
  });
});
