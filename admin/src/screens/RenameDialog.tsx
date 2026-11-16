import { useId, useMemo, useState, type ReactNode } from 'react';

import { EditletError } from '../../../core/issues';
import { planRename, type RenamePlan } from '../../../core/rename';
import type { Schema } from '../../../core/schema';
import type { PlanFile, ReferrerItem } from '../data/queries';
import { AlertDialog, Field, FIELD_INPUT_CLASS } from '../ui';

type Props = {
  open: boolean;
  onOpenChange(open: boolean): void;
  schema: Schema;
  /** The saved entry being renamed. */
  self: PlanFile;
  /** Entries that reference it (their references are rewritten). */
  referrers: ReferrerItem[];
  /** Every listed repository path: the entry's folder and the new slug's freedom are read from it. */
  files: string[];
  pending: boolean;
  /** No commit possible yet (GitHub: a new branch name is needed). */
  blocked: boolean;
  onConfirm(plan: RenamePlan<PlanFile>): void;
  /** The new-branch field (GitHub on the base branch). */
  children?: ReactNode;
};

/** The plan for `slug`, or why it cannot be renamed to it. */
function tryPlan(props: Props, slug: string): { plan: RenamePlan<PlanFile> } | { error: string } {
  const { schema, self, referrers, files } = props;
  try {
    const entries = [self, ...referrers.map((r) => r.entry).filter((e) => e.path !== self.path)];
    return { plan: planRename(schema, entries, files, `${self.collection}/${self.slug}`, slug) };
  } catch (error) {
    if (error instanceof EditletError) return { error: error.issues[0]?.message ?? error.message };
    throw error;
  }
}

/**
 * Rename…: a new slug, and the plan of one commit (`planRename`): the entry moves to `<new>.md`, its folder to
 * `<new>/`, and the entries that reference it point at the new ref.
 */
export function RenameDialog(props: Props) {
  const { open, onOpenChange, self, pending, blocked, onConfirm, children } = props;
  const inputId = useId();
  const [slug, setSlug] = useState(self.slug);
  const result = useMemo(() => (slug === self.slug ? null : tryPlan(props, slug)), [props, slug, self.slug]);
  const plan = result && 'plan' in result ? result.plan : null;
  const error = result && 'error' in result ? result.error : undefined;
  const others = plan ? plan.write.filter((w) => w.entry.path !== self.path) : [];
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSlug(self.slug);
        onOpenChange(next);
      }}
      title={`Rename ${self.collection}/${self.slug}`}
      description="The slug is the file name and the page URL. Links to the old URL on the site or elsewhere stop working."
      confirmLabel="Rename"
      pending={pending}
      confirmDisabled={blocked || plan === null}
      onConfirm={() => plan && onConfirm(plan)}
    >
      <Field label="New slug" htmlFor={inputId} error={error} describedById={inputId}>
        <input
          id={inputId}
          className={FIELD_INPUT_CLASS}
          value={slug}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onChange={(e) => setSlug(e.target.value.trim())}
        />
      </Field>
      {plan ? (
        <ul className="editlet-rename__plan" aria-label="Rename plan">
          <li>
            {self.path} → {plan.write[0]!.path}
          </li>
          {plan.move.length > 0 ? (
            <li>
              Moves {plan.move.length} {plan.move.length === 1 ? 'file' : 'files'} to{' '}
              {plan.move[0]!.to.slice(0, plan.move[0]!.to.lastIndexOf('/') + 1)}
            </li>
          ) : null}
          {others.map((w) => (
            <li key={w.path}>
              Updates {w.entry.collection}/{w.entry.slug} ({w.reasons.join(', ')})
            </li>
          ))}
        </ul>
      ) : null}
      {children}
    </AlertDialog>
  );
}
