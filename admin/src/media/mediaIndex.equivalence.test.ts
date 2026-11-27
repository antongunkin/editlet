// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { entryEdits } from './edits';
import { buildFullFileIndex, type FullFileIndex } from './fullFileIndex.test-helper';
import { allEntryRefs, buildMediaIndex, filterCounts, type MediaIndex } from './mediaIndex';

import { parseEntryFile } from '../../../core/entryFile';
import { parseSchemaText } from '../../../core/schema';
import { gitBlobSha } from '../../../core/sha';
import type { FileRef } from '../../../core/source';
import { summarizeEntry, type EntrySummary } from '../../../core/summary';
import type { EntryFileData } from '../data/queries';

// The index from summaries equals the index from full files (phase 1) on real content.

const REPO = join(import.meta.dirname, '../../../../..');

async function site(root: string) {
  const bytes = new Map<string, Uint8Array>();
  for (const entry of readdirSync(join(root, 'cms'), { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const abs = join(entry.parentPath, entry.name);
    bytes.set(relative(root, abs).split(sep).join('/'), new Uint8Array(readFileSync(abs)));
  }
  const files: FileRef[] = await Promise.all(
    [...bytes].map(async ([path, content]) => ({ path, sha: await gitBlobSha(content) })),
  );
  const schema = parseSchemaText(readFileSync(join(root, 'cms/schema.json'), 'utf8'), 'cms/schema.json');
  const read = new Map<string, EntryFileData>();
  const summaries = new Map<string, EntrySummary>();
  for (const ref of allEntryRefs(schema, files)) {
    const file = parseEntryFile(new TextDecoder().decode(bytes.get(ref.path)));
    read.set(ref.path, { file, sha: ref.sha, keyOrder: Object.keys(file.data) });
    summaries.set(ref.path, summarizeEntry(schema, ref.collection, file));
  }
  return { schema, files, read, summaries };
}

/** The parts both indexes have: the full-file uses without their body ranges. */
const facts = (index: MediaIndex | FullFileIndex) => ({
  images: index.images.map((image) => ({
    ...image,
    uses: image.uses.map((use) => Object.fromEntries(Object.entries(use).filter(([key]) => key !== 'body'))),
  })),
  folders: index.folders,
  counts: filterCounts(index.images as MediaIndex['images']),
  incomplete: index.incomplete,
});

describe.each([
  ['the survey fixture', join(REPO, 'packages/editlet/__fixtures__/survey')],
  ['the demo cms/', REPO],
])('the media index from summaries: %s', (_, root) => {
  it('has the images, uses, alt texts, folders and filter counts of the full-file index', async () => {
    const { schema, files, read, summaries } = await site(root);
    const index = buildMediaIndex(schema, files, summaries);
    const full = buildFullFileIndex(schema, files, read);
    expect(index.images.flatMap((i) => i.uses).length).toBeGreaterThan(0);
    expect(facts(index)).toEqual(facts(full));
    expect(index.incomplete).toBe(false);
  });

  it('is incomplete alike while an entry is missing', async () => {
    const { schema, files, read, summaries } = await site(root);
    const missing = allEntryRefs(schema, files)[0]!.path;
    read.delete(missing);
    summaries.delete(missing);
    const index = buildMediaIndex(schema, files, summaries);
    expect(index.incomplete).toBe(true);
    expect(facts(index)).toEqual(facts(buildFullFileIndex(schema, files, read)));
  });

  it('rewrites every use from the index as from the full file: an unchanged alt keeps the bytes', async () => {
    const { schema, files, read, summaries } = await site(root);
    const index = buildMediaIndex(schema, files, summaries);
    const uses = index.images.flatMap((i) => i.uses);
    const changes = entryEdits(
      schema,
      index,
      uses.map((use) => ({ use, alt: `${use.alt} (new)` })),
      read,
    );
    expect(changes.map((c) => c.path).toSorted()).toEqual([...new Set(uses.map((u) => u.entryPath))].toSorted());
    for (const change of changes) {
      const text = change.content as string;
      expect(text).toContain('(new)');
      expect(change.sha).toBe(read.get(change.path)!.sha);
    }
  });
});
