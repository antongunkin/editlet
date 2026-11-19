import { HomeView } from './HomeView';
import { RouteRow, StaticRow } from './RouteRow';

import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { routeFromBranch } from '../github/branchName';
import { useWorkspace } from '../github/workspace';
import { RouteLink } from '../RouteLink';
import { SearchButton } from '../search/SearchProvider';
import { buttonVariants, Icon } from '../ui';
import { Badge } from '../ui/primitives/badge';
import { AccountButton } from '../window/AccountButton';
import { useBranchChanges } from '../window/branchChanges';
import { useScreenChrome } from '../window/chrome';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Home: *Your changes* (a branch with changes opens its review) and *All content*, with the account (or, in dev mode,
 * Appearance) in the header. *On this page* is not listed: the page's entries need a map from the page to its
 * entries that the loader does not send yet, so the screen is *Home* and not *This page* (docs/admin/home.md).
 */
export function Home({ schema }: { schema: SchemaData }) {
  const chrome = useScreenChrome();
  const files = useFiles();
  const workspace = useWorkspace();
  const changes = useBranchChanges();

  const entries = files.data
    ? Object.keys(schema.schema.collections).reduce((n, key) => n + entryRefs(schema.schema, files.data, key).length, 0)
    : undefined;
  const review = workspace && !workspace.onBase ? routeFromBranch(workspace.active, workspace.prefix) : null;

  const rows = (
    <>
      {review !== null ? (
        <li>
          <RouteRow
            to={{ kind: 'branch', name: review }}
            lead="inbox"
            title="Your changes"
            sub={`${changes === null ? 'Changes' : plural(changes, 'file', 'files')} · ${workspace!.active}`}
            trail={changes ? <Badge tone="unsaved">{changes}</Badge> : undefined}
          />
        </li>
      ) : workspace ? (
        <li>
          <StaticRow lead="inbox" title="Your changes" sub="Nothing waiting" />
        </li>
      ) : null}
      <li>
        <RouteRow
          to={{ kind: 'content' }}
          lead="table"
          title="All content"
          sub={
            entries === undefined ? 'Entries · media · model' : `${plural(entries, 'entry', 'entries')} · media · model`
          }
        />
      </li>
    </>
  );

  return (
    <HomeView
      title="Home"
      actions={
        <>
          <SearchButton />
          <AccountButton />
          {chrome.windowActions}
        </>
      }
      banners={chrome.banners}
      rows={rows}
      status={chrome.status}
      cta={
        review !== null ? (
          <RouteLink
            to={{ kind: 'branch', name: review }}
            className={buttonVariants({ variant: 'primary', size: 'lg', full: true })}
          >
            <Icon name="eye" size={20} />
            Review changes
          </RouteLink>
        ) : null
      }
    />
  );
}
