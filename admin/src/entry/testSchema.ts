import { loadSchema } from '../../../core/schema';

/** Test-only schema covering every field type. */
export const schema = loadSchema({
  contentDir: 'cms/content',
  git: { baseBranch: 'main' },
  collections: {
    post: {
      label: 'Post',
      titleField: 'title',
      fields: {
        title: { type: 'string', label: 'Title', required: true },
        summary: { type: 'text', label: 'Summary' },
        tags: { type: 'string', label: 'Tags', list: true },
        published: { type: 'boolean', label: 'Published' },
        category: { type: 'select', label: 'Category', options: [{ label: 'News', value: 'news' }] },
        kinds: {
          type: 'select',
          label: 'Kinds',
          multiple: true,
          options: [
            { label: 'A', value: 'a' },
            { label: 'B', value: 'b' },
          ],
        },
        rating: { type: 'number', label: 'Rating' },
        publishedAt: { type: 'datetime', label: 'Published at' },
        meta: { type: 'json', label: 'Meta' },
        link: { type: 'url', label: 'Link' },
        accent: { type: 'color', label: 'Accent' },
        cover: { type: 'image', label: 'Cover' },
        author: { type: 'reference', label: 'Author', collections: ['author'] },
        related: { type: 'reference', label: 'Related', collections: ['post'], multiple: true },
        body: { type: 'markdown', label: 'Body' },
      },
    },
    author: {
      label: 'Author',
      fields: { name: { type: 'string', label: 'Name', required: true } },
    },
  },
});

export const post = schema.collections.post;
export const author = schema.collections.author;
