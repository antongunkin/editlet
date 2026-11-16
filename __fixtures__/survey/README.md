# Survey fixture

A small site (`cms/schema.json` + `cms/content/`) with references four levels deep: `survey → section → question →
option`, a singleton target (`brand/index`), a cycle (`question/age → option/age-adult → question/age`), a shared
subtree (`section/feedback` is in both surveys) and a draft (`option/age-draft`). Field types on the way: string,
select, number, boolean, color, image, markdown and references (single and `multiple`).

The `page` collection holds the P22 nested fields: an `object` (`seo`), and `blocks` (`content`) with a hero (image
and a nested `object`), a features block (a list of objects with images), a prose block (a Markdown string with an
image), a survey block (a reference into the survey tree) and a quote (a nested `object` with a select).
`question/rating` has a `scale` object with an object inside (`labels`).

Used by the core, Next, Astro and admin tests (`references*.test.ts*`). Copy it to a temp folder before writing to it.
Tests that need a broken reference edit their copy.
