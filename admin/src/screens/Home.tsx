import { PageTop } from './PageTop';

import { entryRefs, useFiles, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { Icon } from '../ui/Icon';

/** Collections as tiles: the name, then the entry count in large type (singletons say so instead). */
export function Home({ schema }: { schema: SchemaData }) {
  const files = useFiles();
  const collections = Object.entries(schema.schema.collections);
  return (
    <section className="editlet-screen">
      <PageTop title="Content" />
      <ul className="editlet-collection-list">
        {collections.map(([key, collection]) => {
          const count = files.data ? entryRefs(schema.schema, files.data, key).length : undefined;
          return (
            <li key={key}>
              <RouteLink
                to={{ kind: 'collection', collection: key }}
                className="editlet-collection-list__item"
                // The tile reads as one name, "Post (22)" or "Home page": its parts are only visual.
                aria-label={
                  !collection.singleton && count !== undefined ? `${collection.label} (${count})` : collection.label
                }
              >
                <span className="editlet-collection-list__head">
                  <span className="editlet-collection-list__label">{collection.label}</span>
                  <span className="editlet-collection-list__icon">
                    {collection.singleton ? <Icon.File size={16} /> : <Icon.Folder size={16} />}
                  </span>
                </span>
                {collection.singleton ? (
                  <span className="editlet-collection-list__kind">Single page</span>
                ) : (
                  <span className="editlet-collection-list__count">{count ?? '–'}</span>
                )}
              </RouteLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
