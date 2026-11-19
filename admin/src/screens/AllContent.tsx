import { AllContentView } from './AllContentView';
import { RouteRow } from './RouteRow';

import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { SearchButton } from '../search/SearchProvider';
import { buttonVariants, cn, Icon } from '../ui';
import { useScreenChrome } from '../window/chrome';

/** *All content*: every collection, then Media and the Content model; the list that replaced the navigation menu. */
export function AllContent({ schema }: { schema: SchemaData }) {
  const chrome = useScreenChrome();
  const files = useFiles();
  const collections = Object.entries(schema.schema.collections);
  return (
    <AllContentView
      back={
        <RouteLink
          to={{ kind: 'home' }}
          className={cn(buttonVariants({ variant: 'ghost' }), 'size-11 px-0')}
          aria-label="Back"
          title="Back to Home"
        >
          <Icon name="chevron-left" size={20} />
        </RouteLink>
      }
      actions={
        <>
          <SearchButton />
          {chrome.windowActions}
        </>
      }
      banners={chrome.banners}
      collections={collections.map(([key, collection]) => {
        const count = files.data ? entryRefs(schema.schema, files.data, key).length : undefined;
        return (
          <li key={key}>
            <RouteRow
              to={{ kind: 'collection', collection: key }}
              lead={collection.singleton ? 'file' : 'folder'}
              title={collection.label}
              sub={
                collection.singleton
                  ? 'Single page'
                  : count === undefined
                    ? 'Entries'
                    : `${count} ${count === 1 ? 'entry' : 'entries'}`
              }
            />
          </li>
        );
      })}
      more={
        <>
          <li>
            <RouteRow to={{ kind: 'media' }} lead="image" title="Media" sub="Every image and where it is used" />
          </li>
          <li>
            <RouteRow
              to={{ kind: 'schema' }}
              lead="blocks"
              title="Content model"
              sub={`${collections.length} ${collections.length === 1 ? 'collection' : 'collections'}`}
            />
          </li>
        </>
      }
      status={chrome.status}
    />
  );
}
