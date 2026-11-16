import { useId, useState, type FormEvent } from 'react';

import { normalizeBranchInput, routeFromBranch } from './branchName';
import { errorText } from './errors';
import { relativeTime } from './relativeTime';
import { useBranches, useWorkspace, type Workspace } from './workspace';

import { isEditletBranchName } from '../../../core/gitStyle';
import { GitHubError, type CmsBranch } from '../../../github';
import { RouteLink } from '../RouteLink';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Icon } from '../ui/Icon';
import { PrefixedInput } from '../ui/Input';
import { useBridge } from '../useRoute';

export type BranchDialogProps = { open: boolean; onOpenChange(open: boolean): void };

function pullRequestText(branch: CmsBranch): string {
  const pr = branch.pullRequest;
  if (!pr) return 'No pull request';
  return pr.isDraft ? `Draft PR #${pr.number}` : `PR #${pr.number}`;
}

function BranchRow({
  name,
  details,
  active,
  onChoose,
  review,
}: {
  name: string;
  details: string[];
  active: boolean;
  onChoose(): void;
  review?: { name: string; onClick(): void };
}) {
  return (
    <li className="editlet-branch-list__item">
      <button
        type="button"
        className="editlet-branch-list__choose"
        aria-current={active ? 'true' : undefined}
        onClick={onChoose}
      >
        <span className="editlet-branch-list__icon">
          {active ? <Icon.Check size={14} /> : <Icon.GitBranch size={14} />}
        </span>
        <span className="editlet-branch-list__text">
          <span className="editlet-branch-list__name">{name}</span>{' '}
          <span className="editlet-branch-list__details">
            {details.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </span>
        </span>
      </button>
      {review ? (
        <RouteLink
          to={{ kind: 'branch', name: review.name }}
          className="editlet-link editlet-branch-list__review"
          onClick={review.onClick}
        >
          Review
        </RouteLink>
      ) : null}
    </li>
  );
}

function CreateBranch({ workspace, name, onCreated }: { workspace: Workspace; name: string; onCreated(): void }) {
  const { canLeave } = useBridge();
  const hintId = useId();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isEditletBranchName(name, workspace.prefix);
  const repo = `${workspace.config.owner}/${workspace.config.repo}`;

  const create = async () => {
    if (!valid || creating || !canLeave()) return;
    setCreating(true);
    setError(null);
    try {
      await workspace.createBranch(name);
      onCreated();
    } catch (e) {
      setCreating(false);
      setError(
        e instanceof GitHubError && e.code === 'branch_exists'
          ? 'A branch with this name already exists'
          : errorText(e, { repo }),
      );
    }
  };

  return (
    <div className="editlet-branch-dialog__create">
      {/* The form's submit button, so Enter in the input creates; the click handler does the work. */}
      <Button
        type="submit"
        variant="primary"
        icon={<Icon.Plus />}
        disabled={!valid || creating}
        aria-describedby={valid ? undefined : hintId}
        onClick={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        Create {name} from {workspace.base}
      </Button>
      {valid ? null : (
        <span id={hintId} className="editlet-branch-dialog__hint">
          Use letters, digits and dashes
        </span>
      )}
      {error ? (
        <span className="editlet-branch-dialog__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function BranchPicker({ workspace, onClose }: { workspace: Workspace; onClose(): void }) {
  const id = useId();
  const branches = useBranches();
  const { canLeave } = useBridge();
  const [input, setInput] = useState('');
  const { prefix } = workspace;
  const query = normalizeBranchInput(input, prefix);
  const wanted = query === '' ? null : `${prefix}${query}`;
  const listed = branches.data ?? [];
  const rows = listed.filter((b) => routeFromBranch(b.name, prefix).includes(query));
  const offerCreate = wanted !== null && branches.data !== undefined && !listed.some((b) => b.name === wanted);

  const choose = (name: string) => {
    if (name !== workspace.active) {
      if (!canLeave()) return;
      workspace.switchTo(name);
    }
    onClose();
  };

  return (
    <form className="editlet-branch-dialog" onSubmit={(e: FormEvent) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Branches</DialogTitle>
        <DialogDescription>
          Edits are saved on a branch; its pull request takes them to the live site.
        </DialogDescription>
      </DialogHeader>
      <div className="editlet-u-stack editlet-u-gap-2">
        <label htmlFor={`${id}-find`} className="editlet-field__label">
          Find or create a branch
        </label>
        <PrefixedInput
          id={`${id}-find`}
          prefix={prefix}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the only field of a modal dialog
          autoFocus
        />
        {offerCreate ? <CreateBranch key={wanted} workspace={workspace} name={wanted} onCreated={onClose} /> : null}
      </div>
      <ul className="editlet-branch-list" aria-label="Branches">
        <BranchRow
          name={workspace.base}
          details={['Live site · edits here start a new branch']}
          active={workspace.onBase}
          onChoose={() => choose(workspace.base)}
        />
        {rows.map((b) => (
          <BranchRow
            key={b.name}
            name={b.name}
            details={[pullRequestText(b), ...(b.committedAt ? [relativeTime(b.committedAt)] : [])]}
            active={b.name === workspace.active}
            onChoose={() => choose(b.name)}
            review={{ name: routeFromBranch(b.name, prefix), onClick: onClose }}
          />
        ))}
      </ul>
      {branches.error ? (
        <p className="editlet-branch-dialog__error" role="alert">
          {errorText(branches.error, { repo: `${workspace.config.owner}/${workspace.config.repo}` })}
        </p>
      ) : branches.isPending ? (
        <p className="editlet-u-text-muted" role="status">
          Loading branches…
        </p>
      ) : null}
    </form>
  );
}

/** Branch picker: find or create a `<prefix>*` branch, switch to one (asking the unsaved-changes guard), or review one. */
export function BranchDialog({ open, onOpenChange }: BranchDialogProps) {
  const workspace = useWorkspace();
  if (!workspace) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="editlet-branch-dialog__content">
        {open ? <BranchPicker workspace={workspace} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}
