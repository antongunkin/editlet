import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { ContentModelView } from './ContentModelView';
import {
  collectionPrompts,
  fieldRows,
  globalPrompts,
  incoming,
  outgoing,
  referenceEdges,
  type ChatPrompt,
} from './model';
import { AskSheet, CollectionRow, CollectionSheet, collectionLine, ProblemsCard } from './ModelSections';
import { useCopy } from './useCopy';
import { useEntryProblems, useGithubPoll, useSchemaChanges } from './useModelData';

import { EditletError, type Issue } from '../../../core/issues';
import { entryRefs, invalidateFiles, useFiles, useSchema, type SchemaData } from '../data/queries';
import { RouteLink } from '../RouteLink';
import { BackLink } from '../screens/BackLink';
import { cn } from '../ui/cn';
import { ActionSheet } from '../ui/parts/action-sheet';
import { BottomBar } from '../ui/parts/bottom-bar';
import { ActionRow } from '../ui/parts/rows';
import { Badge } from '../ui/primitives/badge';
import { Banner } from '../ui/primitives/banner';
import { Button, buttonVariants } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { IconButton } from '../ui/primitives/icon-button';
import { toastManager } from '../ui/primitives/toast';
import { useScreenChrome } from '../window/chrome';

/** Which prompts the *Ask Claude Code* sheet shows: the whole model's, or one collection's. */
type Ask = { kind: 'model' } | { kind: 'collection'; key: string };

/**
 * The content model, as a guide to changing it with a coding agent: what is wrong (only when something is), the
 * collections as rows (each opens its fields in a sheet), and *Ask Claude Code* with prompts to copy for the whole
 * model and for one collection. Read-only: the schema file is the only way to change it.
 */
export function ContentModel({ schema: data }: { schema: SchemaData }) {
  useGithubPoll();
  const client = useQueryClient();
  const chrome = useScreenChrome();
  const files = useFiles();
  const { refreshError } = useSchema();
  const { problems, pending } = useEntryProblems(data);
  const { changes, updatedAt } = useSchemaChanges(data.schema);
  const { copied, copy } = useCopy();
  const { schema, schemaPath } = data;

  // The sheets stay mounted after closing, so they can animate out: `open` says whether, the key what they show.
  const [shown, setShown] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const more = useRef<HTMLButtonElement>(null);

  const schemaIssues: Issue[] | null = refreshError
    ? refreshError instanceof EditletError
      ? refreshError.issues
      : [{ path: '', message: refreshError.message }]
    : null;
  const issueCount = problems.reduce((n, p) => n + p.issues.length, 0) + (schemaIssues?.length ?? 0);
  const hasProblems = issueCount > 0;
  const edges = referenceEdges(schema);
  const keys = Object.keys(schema.collections);
  const removed = changes?.removed ?? [];
  const label = (key: string) => schema.collections[key]?.label ?? key;
  const countOf = (key: string) => (files.data ? entryRefs(schema, files.data, key).length : undefined);

  const showCollection = (key: string) => {
    setShown(key);
    setOpen(true);
  };
  const askAbout = (next: Ask) => {
    setAsk(next);
    setAskOpen(true);
  };
  const prompts: ChatPrompt[] =
    ask?.kind === 'collection'
      ? collectionPrompts(schema, schemaPath, ask.key)
      : globalPrompts(schema, schemaPath, { hasProblems });

  const copyPrompt = (p: ChatPrompt) =>
    void copy(p.text, p.id).then((ok) => {
      if (!ok) toastManager.add({ title: 'Copy failed', type: 'error' });
    });

  const current = shown !== null && Object.hasOwn(schema.collections, shown) ? schema.collections[shown]! : null;
  const entries = shown !== null ? countOf(shown) : undefined;
  const mark = shown !== null ? changes?.collections.get(shown) : undefined;
  const time = updatedAt?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <ContentModelView
      back={<BackLink />}
      actions={
        <>
          <IconButton
            label="Refresh"
            icon={<Icon name="refresh" size={20} />}
            onClick={() => void invalidateFiles(client)}
          />
          <IconButton
            ref={more}
            label="More actions"
            aria-haspopup="dialog"
            icon={<Icon name="more" size={20} />}
            onClick={() => setMoreOpen(true)}
          />
          {chrome.windowActions}
        </>
      }
      badge={
        hasProblems ? (
          <Badge tone="danger">{issueCount === 1 ? '1 problem' : `${issueCount} problems`}</Badge>
        ) : pending ? null : (
          <Badge tone="success" dot>
            No problems
          </Badge>
        )
      }
      meta={
        <>
          <span>{schemaPath}</span>
          {time ? <span>· Updated {time}</span> : null}
          {/* Also while problems are listed: more entries may still be read. */}
          <output>{pending ? 'Checking entries…' : ''}</output>
        </>
      }
      banners={
        <>
          {chrome.banners}
          {removed.length > 0 ? <Banner tone="unsaved">Removed: {removed.join(', ')}</Banner> : null}
        </>
      }
      problems={hasProblems ? <ProblemsCard schemaIssues={schemaIssues} problems={problems} /> : undefined}
      collectionsLabel={`Collections · ${keys.length}`}
      rows={keys.map((key) => {
        const collection = schema.collections[key]!;
        return (
          <li key={key}>
            <CollectionRow
              label={collection.label}
              line={collectionLine(key, collection.singleton === true, countOf(key), fieldRows(collection).length)}
              singleton={collection.singleton === true}
              mark={changes?.collections.get(key)}
              onOpen={() => showCollection(key)}
            />
          </li>
        );
      })}
      empty={
        keys.length === 0 ? <p className="m-0 px-4 text-base text-tray-muted-foreground">No collections</p> : undefined
      }
      status={chrome.status}
      cta={
        <Button variant="primary" size="lg" full icon={<Icon name="zap" />} onClick={() => askAbout({ kind: 'model' })}>
          {hasProblems ? 'Fix with Claude Code' : 'Ask Claude Code'}
        </Button>
      }
    >
      {current && shown ? (
        <CollectionSheet
          open={open}
          onOpenChange={setOpen}
          title={current.label}
          sub={`${shown} · ${schema.contentDir}/${shown}/${mark && time ? ` · Updated ${time}` : ''}`}
          rows={fieldRows(current)}
          marks={changes?.fields.get(shown)}
          page={current.url ?? null}
          references={outgoing(edges, shown).map((e) => ({
            from: e.to,
            label: label(e.to),
            field: e.field,
            many: e.many,
          }))}
          referencedBy={incoming(edges, shown).map((e) => ({
            from: e.from,
            label: label(e.from),
            field: e.field,
            many: e.many,
          }))}
          onOpenOther={showCollection}
          askLabel={`Change ${current.label} with Claude Code`}
          onAsk={() => askAbout({ kind: 'collection', key: shown })}
          bar={
            <BottomBar className="shrink-0">
              <RouteLink
                to={{ kind: 'collection', collection: shown }}
                className={cn(buttonVariants({ variant: 'primary', size: 'lg', full: true }), 'no-underline')}
              >
                {current.singleton
                  ? 'Open entry'
                  : entries === undefined
                    ? 'Open entries'
                    : `Open ${entries} ${entries === 1 ? 'entry' : 'entries'}`}
              </RouteLink>
            </BottomBar>
          }
        >
          {ask?.kind === 'collection' ? (
            <AskSheet
              open={askOpen}
              onOpenChange={setAskOpen}
              sub={`Change ${current.label}: copy a prompt and paste it in Claude Code`}
              prompts={prompts}
              copied={copied}
              onCopy={copyPrompt}
            />
          ) : null}
        </CollectionSheet>
      ) : null}
      {ask?.kind === 'model' ? (
        <AskSheet open={askOpen} onOpenChange={setAskOpen} prompts={prompts} copied={copied} onCopy={copyPrompt} />
      ) : null}
      <ActionSheet open={moreOpen} onOpenChange={setMoreOpen} title="Content model" finalFocus={more}>
        <ActionRow
          icon="copy"
          onClick={() => {
            setMoreOpen(false);
            void copy(JSON.stringify(schema, null, 2), 'schema').then((ok) =>
              toastManager.add(ok ? { title: 'Schema copied', type: 'copy' } : { title: 'Copy failed', type: 'error' }),
            );
          }}
        >
          Copy schema
        </ActionRow>
      </ActionSheet>
    </ContentModelView>
  );
}
