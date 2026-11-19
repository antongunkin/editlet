import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import { HistorySheet, OlderVersions, VersionSheet, type HistoryItem } from './HistoryView';

import { decodeUtf8, parseEntryFile } from '../../../core/entryFile';
import { EditletError } from '../../../core/issues';
import type { Collection } from '../../../core/schema';
import { DEFAULT_FILE_VERSIONS, type ContentSource, type FileVersion } from '../../../core/source';
import { entryDiff } from '../entry/diff';
import { entryToForm, formToEntry, type DataBody, type FormValues } from '../entry/values';
import { relativeTime } from '../github/relativeTime';
import { shortName } from '../screens/EntryMeta';
import { sourceKey, useSource } from '../source/context';
import { Banner } from '../ui/primitives/banner';
import { Button } from '../ui/primitives/button';

/** The source can list versions: History is offered (dev mode with git, GitHub mode). */
export const hasHistory = (source: ContentSource): boolean =>
  typeof source.listVersions === 'function' && typeof source.readVersion === 'function';

/** *5 days ago*, *2 hours ago*, *yesterday*; after a week the date (*Nov 10, 2026*). The version sheet's title. */
export function versionWhen(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'Version';
  const ago = Math.max(0, now - at);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const minutes = Math.floor(ago / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 7) {
    const text = rtf.format(-days, 'day');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }
  return relativeTime(iso, now);
}

/**
 * The list's rows: newest first; the first version whose blob is the loaded file is *current*. In dev mode a file on
 * disk that no commit has (`sha` not among them) gets a first row of its own, *Not committed*.
 */
export function historyItems(
  versions: FileVersion[],
  sha: string | null,
  kind: ContentSource['kind'],
  now = Date.now(),
): HistoryItem[] {
  const current = versions.findIndex((v) => v.sha !== null && v.sha === sha);
  const items: HistoryItem[] = versions.map((v, i) => {
    const who = `${shortName(v.actor)} · ${relativeTime(v.date, now)}`;
    return {
      key: v.commit,
      title: v.message || v.commit.slice(0, 7),
      sub: v.sha === null ? `${who} · deleted` : i === current ? `${who} · current` : who,
      author: { name: v.actor.login ?? v.actor.name, avatarUrl: v.actor.avatarUrl },
      current: i === current,
      deleted: v.sha === null,
    };
  });
  if (kind === 'local' && current === -1 && sha !== null && versions.length > 0) {
    items.unshift({ key: 'disk', title: 'Not committed', sub: 'On disk · current', current: true });
  }
  return items;
}

/** A version's text (a commit never changes, so it is cached for good); not UTF-8 is an `EditletError`. */
export async function readVersionText(source: ContentSource, path: string, commit: string): Promise<string> {
  const decoded = decodeUtf8(await source.readVersion!(path, commit), path);
  if ('issue' in decoded) throw new EditletError([decoded.issue]);
  return decoded.text;
}

/** The form values of a version's text, read with today's schema (`def`), or the reason it does not parse. */
export function versionValues(def: Collection, text: string): { values: FormValues } | { error: unknown } {
  try {
    return { values: entryToForm(def, parseEntryFile(text)) };
  } catch (error) {
    return { error };
  }
}

const errorMessage = (error: unknown) =>
  error instanceof EditletError
    ? error.issues.map((i) => i.message).join('; ')
    : error instanceof Error
      ? error.message
      : String(error);

export interface EntryHistoryProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  path: string;
  /** The sha of the file the entry loaded: its version is *current*. */
  sha: string | null;
  entryTitle: string;
  def: Collection;
  /** The entry as the form has it now (unsaved edits included): what the diff and Restore compare with. */
  current: DataBody;
  /** The form has unsaved edits. */
  dirty: boolean;
  /** The file's commits on GitHub (GitHub mode): linked when the list is full. */
  historyUrl: string | null;
  /** Puts the version's values into the form (an unsaved edit). */
  onRestore(values: FormValues): void;
}

/**
 * History of one entry (docs/admin/history.md): the list (`listVersions`) on the first level, a version's diff
 * (`readVersion`) on the second, and Restore, which hands the version's values to the form and closes both.
 */
export function EntryHistory({
  open,
  onOpenChange,
  path,
  sha,
  entryTitle,
  def,
  current,
  dirty,
  historyUrl,
  onRestore,
}: EntryHistoryProps) {
  const source = useSource();
  const key = sourceKey(source);
  // The version shown stays while its sheet slides away (`versionOpen` false): no blank title or *Loading…* on the way out.
  const [opened, setOpened] = useState<FileVersion | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);

  const versions = useQuery({
    queryKey: ['file-versions', key, path, sha] as const,
    enabled: open && hasHistory(source),
    retry: false,
    queryFn: () => source.listVersions!(path),
  });
  const version = useQuery({
    queryKey: ['file-version', key, path, opened?.commit ?? ''] as const,
    enabled: opened !== null,
    retry: false,
    staleTime: Infinity,
    queryFn: () => readVersionText(source, path, opened!.commit),
  });
  // Parsed here, not in the query: the cache holds the text, and a schema change reads it again with the new schema.
  const parsed = useMemo(
    () => (version.data === undefined ? undefined : versionValues(def, version.data)),
    [def, version.data],
  );
  const values = parsed && 'values' in parsed ? parsed.values : undefined;
  const versionError = version.error ?? (parsed && 'error' in parsed ? parsed.error : null);

  const items = useMemo(
    () => (versions.data ? historyItems(versions.data, sha, source.kind) : undefined),
    [versions.data, sha, source.kind],
  );
  const rows = useMemo(
    () => (values ? entryDiff(def, formToEntry(def, values), current) : undefined),
    [values, def, current],
  );

  const full = (versions.data?.length ?? 0) >= DEFAULT_FILE_VERSIONS;
  const close = (next: boolean) => {
    if (!next) setVersionOpen(false);
    onOpenChange(next);
  };

  return (
    <HistorySheet
      open={open}
      onOpenChange={close}
      entryTitle={entryTitle}
      items={items}
      error={
        versions.error ? (
          <Banner
            tone="danger"
            action={
              <Button size="md" onClick={() => void versions.refetch()}>
                Retry
              </Button>
            }
          >
            The versions did not load: {errorMessage(versions.error)}
          </Banner>
        ) : undefined
      }
      footer={
        full ? (
          historyUrl ? (
            <OlderVersions href={historyUrl} />
          ) : (
            <p className="m-0 px-1 text-sm text-tray-muted-foreground">The newest {DEFAULT_FILE_VERSIONS} versions.</p>
          )
        ) : undefined
      }
      onOpenVersion={(commit) => {
        const found = versions.data?.find((v) => v.commit === commit);
        if (!found) return;
        setOpened(found);
        setVersionOpen(true);
      }}
    >
      <VersionSheet
        open={versionOpen}
        onOpenChange={(next) => (next ? undefined : setVersionOpen(false))}
        title={opened ? versionWhen(opened.date) : 'Version'}
        sub={opened ? `${opened.message || opened.commit.slice(0, 7)} · ${shortName(opened.actor)}` : undefined}
        rows={rows}
        error={
          versionError ? (
            <Banner
              tone="danger"
              action={
                version.error ? (
                  <Button size="md" onClick={() => void version.refetch()}>
                    Retry
                  </Button>
                ) : undefined
              }
            >
              This version can't be read: {errorMessage(versionError)}
            </Banner>
          ) : undefined
        }
        replacesEdits={dirty}
        onRestore={() => {
          if (!values) return;
          onRestore(structuredClone(values));
          close(false);
        }}
      />
    </HistorySheet>
  );
}
