import { HomeView } from './HomeView';
import { RouteRow, StaticRow } from './RouteRow';

import { useBufferScopes } from '../changes/scopes';
import { useBuffer, useOpenChanges } from '../changes/trayContext';
import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { routeFromBranch } from '../github/branchName';
import { useWorkspace } from '../github/workspace';
import { RouteLink } from '../RouteLink';
import { SearchButton } from '../search/SearchProvider';
import { Banner, Button, buttonVariants, Icon } from '../ui';
import { Row } from '../ui/parts/rows';
import { Badge } from '../ui/primitives/badge';
import { AccountButton } from '../window/AccountButton';
import { useBranchChanges } from '../window/branchChanges';
import { useScreenChrome } from '../window/chrome';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Home: *Unsaved* (the entries edited in this browser: opens *Your changes*), *Your changes* (a branch with changes opens its review) and *All content*, with the account (or, in dev mode,
 * Appearance) in the header. *On this page* is not listed: the page's entries need a map from the page to its
 * entries that the loader does not send yet, so the screen is *Home* and not *This page* (docs/admin/home.md).
 */
export function Home({ schema }: { schema: SchemaData }) {
  const chrome = useScreenChrome();
  const files = useFiles();
  const workspace = useWorkspace();
  const changes = useBranchChanges();
  const buffer = useBuffer();
  const openChanges = useOpenChanges();
  const unsaved = buffer.entries.length;
  const scopes = useBufferScopes();

  const entries = files.data
    ? Object.keys(schema.schema.collections).reduce((n, key) => n + entryRefs(schema.schema, files.data, key).length, 0)
    : undefined;
  const review = workspace && !workspace.onBase ? routeFromBranch(workspace.active, workspace.prefix) : null;

  const rows = (
    <>
      {unsaved > 0 ? (
        <li>
          <Row
            lead="file"
            title="Unsaved"
            sub={`${plural(unsaved, 'entry', 'entries')}, not saved yet`}
            trail={<Badge tone="unsaved">{buffer.count}</Badge>}
            aria-haspopup="dialog"
            onClick={openChanges}
          />
        </li>
      ) : null}
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
      banners={
        <>
          {chrome.banners}
          {scopes.gone.map((g) => (
            <Banner
              key={g.branch}
              tone="branch"
              action={
                <div className="flex gap-2">
                  <Button size="md" onClick={() => void scopes.moveToBase(g.branch)}>
                    Move to {workspace?.base}
                  </Button>
                  <Button size="md" variant="ghost" onClick={() => void scopes.discard(g.branch)}>
                    Discard
                  </Button>
                </div>
              }
            >
              {plural(g.entries, 'unsaved entry', 'unsaved entries')} {g.entries === 1 ? 'was' : 'were'} on {g.branch},
              which no longer exists.
            </Banner>
          ))}
        </>
      }
      rows={rows}
      status={chrome.status}
      cta={
        unsaved > 0 ? (
          <Button variant="primary" size="lg" full aria-haspopup="dialog" onClick={openChanges}>
            Review & save
          </Button>
        ) : review !== null ? (
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
