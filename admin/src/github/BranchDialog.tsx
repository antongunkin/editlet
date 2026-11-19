import { useState } from 'react';

import { BranchesSheet, NewBranchSheet, type BranchItem } from './BranchesSheet';
import { normalizeBranchInput, routeFromBranch } from './branchName';
import { errorText } from './errors';
import { relativeTime } from './relativeTime';
import { useBranches, useWorkspace, type Workspace } from './workspace';

import { isEditletBranchName } from '../../../core/gitStyle';
import { GitHubError, type CmsBranch } from '../../../github';
import { RouteLink } from '../RouteLink';
import { cn } from '../ui/cn';
import { Badge } from '../ui/primitives/badge';
import { buttonVariants } from '../ui/primitives/button';
import { useBridge } from '../useRoute';

export type BranchDialogProps = { open: boolean; onOpenChange(open: boolean): void };

function pullRequestText(branch: CmsBranch): string {
  const pr = branch.pullRequest;
  const text = !pr ? 'No pull request' : pr.isDraft ? `Draft pull request #${pr.number}` : `Pull request #${pr.number}`;
  return branch.committedAt ? `${text} · ${relativeTime(branch.committedAt)}` : text;
}

function pullRequestBadge(branch: CmsBranch) {
  const pr = branch.pullRequest;
  if (!pr) return undefined;
  return pr.isDraft ? <Badge tone="neutral">Draft</Badge> : <Badge tone="review">In review</Badge>;
}

/** *Review*: the branch screen of `name`, a 44 px link after the row. */
function ReviewLink({ name, route, onClick }: { name: string; route: string; onClick(): void }) {
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- RouteLink renders an <a href>; Enter follows it
    <RouteLink
      to={{ kind: 'branch', name: route }}
      className={cn(buttonVariants({ variant: 'ghost' }), 'mr-2 shrink-0')}
      onClick={onClick}
    >
      Review<span className="sr-only"> {name}</span>
    </RouteLink>
  );
}

function BranchPicker({ workspace, open, onOpenChange }: { workspace: Workspace } & BranchDialogProps) {
  const branches = useBranches();
  const { canLeave } = useBridge();
  const [input, setInput] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { prefix, base } = workspace;
  const repo = `${workspace.config.owner}/${workspace.config.repo}`;
  const close = () => onOpenChange(false);

  const query = normalizeBranchInput(input, prefix);
  const wanted = query === '' ? null : `${prefix}${query}`;
  const listed = branches.data ?? [];
  const offerCreate = wanted !== null && branches.data !== undefined && !listed.some((b) => b.name === wanted);

  const choose = (name: string) => {
    if (name !== workspace.active) {
      if (!canLeave()) return;
      workspace.switchTo(name);
    }
    close();
  };

  const newName = naming === null ? null : `${prefix}${normalizeBranchInput(naming, prefix)}`;
  // A name the listing already has is taken before any request (the find field offers no Create row for one, but the
  // name can be edited here).
  const taken = newName !== null && listed.some((b) => b.name === newName);
  const valid = newName !== null && isEditletBranchName(newName, prefix) && !taken;
  const create = async () => {
    if (!valid || creating || !canLeave()) return;
    setCreating(true);
    setError(null);
    try {
      await workspace.createBranch(newName);
      setNaming(null);
      setInput('');
      close();
    } catch (e) {
      setError(
        e instanceof GitHubError && e.code === 'branch_exists'
          ? 'A branch with this name already exists'
          : errorText(e, { repo }),
      );
    } finally {
      setCreating(false);
    }
  };

  const rows: BranchItem[] = [
    {
      name: base,
      sub: 'Live site · edits here start a new branch',
      active: workspace.onBase,
      onChoose: () => choose(base),
    },
    ...listed
      .filter((b) => routeFromBranch(b.name, prefix).includes(query))
      .map((b) => ({
        name: b.name,
        sub: pullRequestText(b),
        active: b.name === workspace.active,
        badge: pullRequestBadge(b),
        review: <ReviewLink name={b.name} route={routeFromBranch(b.name, prefix)} onClick={close} />,
        onChoose: () => choose(b.name),
      })),
  ];

  return (
    <BranchesSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setNaming(null);
          setInput('');
        }
        onOpenChange(next);
      }}
      query={input}
      onQuery={setInput}
      branches={rows}
      create={
        offerCreate
          ? {
              name: wanted,
              base,
              onOpen: () => {
                setError(null);
                setNaming(input);
              },
            }
          : undefined
      }
      note={
        branches.error ? (
          <p role="alert" className="m-0 px-1 text-sm font-medium text-tint-danger-foreground">
            {errorText(branches.error, { repo })}
          </p>
        ) : branches.isPending ? (
          <output className="m-0 block px-1 text-sm text-tray-muted-foreground">Loading branches…</output>
        ) : null
      }
    >
      <NewBranchSheet
        open={naming !== null}
        onOpenChange={(next) => (next ? undefined : setNaming(null))}
        prefix={prefix}
        value={naming ?? ''}
        onChange={(value) => {
          setError(null);
          setNaming(value);
        }}
        hint={
          valid
            ? `Creates ${newName} from ${base}.`
            : taken
              ? `${newName} is listed above.`
              : 'Use letters, digits and dashes'
        }
        invalid={!valid}
        error={error ?? (taken ? 'A branch with this name already exists' : null)}
        creating={creating}
        onCreate={() => void create()}
      />
    </BranchesSheet>
  );
}

/** Branch picker: find or create a `<prefix>*` branch, switch to one (asking the unsaved-changes guard), or review one. */
export function BranchDialog({ open, onOpenChange }: BranchDialogProps) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  return <BranchPicker workspace={workspace} open={open} onOpenChange={onOpenChange} />;
}
