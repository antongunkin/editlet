import { useId, useState } from 'react';

import { defaultBranchName, normalizeBranchInput, routeFromBranch } from './branchName';
import { useBranches, useWorkspace } from './workspace';

import { DEFAULT_BRANCH_PREFIX, isEditletBranchName } from '../../../core/gitStyle';
import { Icon } from '../ui/primitives/icon';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

export type NewBranch = {
  /** The base branch is active: a save or delete must go to a new `<prefix>*` branch. */
  needed: boolean;
  /** The typed name after the prefix (the suggested one until the editor types). */
  value: string;
  setValue(value: string): void;
  /** `<prefix><value>`, normalised, when needed and usable; else `undefined`. */
  branch: string | undefined;
  error: string | null;
  /** The branch prefix (`editlet/`) and the base branch (`main`), for the field's prefix and hint. */
  prefix: string;
  base: string;
};

/**
 * The new-branch name for a save or delete of `<collection>/<slug>` while the base branch is active. Suggests
 * `<prefix><collection>-<slug>` (`<prefix><collection>` for a singleton), made unique over the listed branches; no
 * `branch` until the listing has loaded (or failed: GitHub then reports a taken name).
 */
export function useNewBranch(collection: string, slug: string, singleton: boolean): NewBranch {
  const workspace = useWorkspace();
  const branches = useBranches();
  const [typed, setTyped] = useState<string | null>(null);
  const needed = workspace?.onBase === true;
  const prefix = workspace?.prefix ?? DEFAULT_BRANCH_PREFIX;
  const listed = branches.data?.map((b) => b.name) ?? [];
  const value = typed ?? routeFromBranch(defaultBranchName(prefix, collection, slug, singleton, listed), prefix);
  const name = `${prefix}${normalizeBranchInput(value, prefix)}`;

  let error: string | null = null;
  if (!isEditletBranchName(name, prefix)) error = 'Use letters, digits and dashes';
  else if (listed.includes(name)) error = 'A branch with this name already exists';
  const known = branches.data !== undefined || branches.error !== null;
  const branch = needed && error === null && known ? name : undefined;
  const base = workspace?.base ?? 'main';
  return { needed, value, setValue: setTyped, branch, error: needed ? error : null, prefix, base };
}

/**
 * The *New branch* field (FigCraft *Save to · new branch*): the label, the name after the fixed prefix, and under it why
 * (the base branch is the live site) or what is wrong with the name. For the save, delete, rename and upload modals;
 * nothing when not `needed`.
 */
export function NewBranchField({ needed, value, setValue, error, prefix, base }: NewBranch) {
  const id = useId();
  if (!needed) return null;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="px-1 text-sm font-medium text-tray-muted-foreground">
        New branch
      </label>
      <InputGroup prefix={prefix}>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
        />
      </InputGroup>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="m-0 flex items-center gap-1.5 px-1 text-sm font-medium text-tint-danger-foreground"
        >
          <Icon name="alert" size={16} className="shrink-0 text-destructive" />
          {error}
        </p>
      ) : null}
      <p id={`${id}-hint`} className="m-0 px-1 text-sm text-tray-muted-foreground">
        {base} is the live site, so this change goes to a new branch.
      </p>
    </div>
  );
}
