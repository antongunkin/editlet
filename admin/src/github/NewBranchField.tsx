import { useId, useState } from 'react';

import { defaultBranchName, normalizeBranchInput, routeFromBranch } from './branchName';
import { useBranches, useWorkspace } from './workspace';

import { DEFAULT_BRANCH_PREFIX, isEditletBranchName } from '../../../core/gitStyle';
import { Field, fieldDescribedBy } from '../ui/Field';
import { PrefixedInput } from '../ui/Input';

export type NewBranch = {
  /** The base branch is active: a save or delete must go to a new `<prefix>*` branch. */
  needed: boolean;
  /** The typed name after the prefix (the suggested one until the editor types). */
  value: string;
  setValue(value: string): void;
  /** `<prefix><value>`, normalised, when needed and usable; else `undefined`. */
  branch: string | undefined;
  error: string | null;
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
  return { needed, value, setValue: setTyped, branch, error: needed ? error : null };
}

/** "New branch" input with the fixed branch prefix, for the save and delete dialogs. Nothing when not `needed`. */
export function NewBranchField({ needed, value, setValue, error }: NewBranch) {
  const workspace = useWorkspace();
  const id = useId();
  if (!needed || !workspace) return null;
  return (
    <Field
      label="New branch"
      htmlFor={id}
      error={error}
      hint={`${workspace.base} is the live site. This change goes to a new branch; create a pull request from the branch screen.`}
    >
      <PrefixedInput
        id={id}
        prefix={workspace.prefix}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={fieldDescribedBy(id, true, error)}
      />
    </Field>
  );
}
