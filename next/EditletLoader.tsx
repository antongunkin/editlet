'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { mountEditletLoader } from '../loader';

export interface EditletLoaderProps {
  /** Admin page URL. Default `/editlet/index.html`. */
  adminUrl?: string;
}

const DEFAULT_ADMIN_URL = '/editlet/index.html';

function EditletLoaderInner({ adminUrl = DEFAULT_ADMIN_URL }: EditletLoaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // pathname/searchParams are intentional triggers: re-read the query parameter after each navigation
  useEffect(() => {
    const loader = mountEditletLoader({
      adminUrl,
      // Set by withEditlet (`admin.param` or the `EDITLET_PARAM` env var); empty → the default `editlet`.
      param: process.env.EDITLET_PARAM,
      onRefresh: () => router.refresh(),
      // null state so the Next.js App Router does not treat the entry as its own and re-sync
      replaceUrl: (url) => history.replaceState(null, '', url),
    });
    loader.sync();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [pathname, searchParams, router, adminUrl]);

  return null;
}

export function EditletLoader(props: EditletLoaderProps) {
  return (
    <Suspense fallback={null}>
      <EditletLoaderInner {...props} />
    </Suspense>
  );
}
