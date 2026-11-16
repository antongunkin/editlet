import { Combobox, type ComboboxOption } from './Combobox';
import { describedBy, fieldProps, invalid } from './shared';
import type { WidgetProps } from './types';

import { Button, buttonVariants, Field, Icon } from '../ui';

const notFound = (ref: string) => `Referenced entry not found: ${ref}`;

function targetsOf(props: WidgetProps<unknown>) {
  return props.field.type === 'reference' ? props.ctx.entries(props.field.collections) : [];
}

const toOption = (e: { ref: string; title: string }): ComboboxOption => ({ value: e.ref, label: e.title, hint: e.ref });

/** The widget's errors plus one per reference that is not among the listed entries (once they are loaded). */
function withMissing(props: WidgetProps<unknown>, missing: string[]): string[] | undefined {
  if (props.ctx.entriesPending || missing.length === 0) return props.error;
  return [...new Set([...(props.error ?? []), ...missing.map(notFound)])];
}

/**
 * Single reference: a combobox that searches the entries of the allowed collections by title and `collection/slug`,
 * a Clear button, and a link that opens the chosen entry.
 */
export function ReferenceField(props: WidgetProps<string>) {
  const { name, field, value, onChange, onBlur } = props;
  const entries = targetsOf(props);
  const chosen = entries.find((e) => e.ref === value);
  const unknown = value !== '' && chosen === undefined;
  const error = withMissing(props, unknown ? [value] : []);
  const { EntryLink } = props.ctx;
  const display = chosen?.title ?? (unknown && !props.ctx.entriesPending ? `Not found: ${value}` : value);
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      <div className="editlet-ff-reference__row">
        <Combobox
          id={name}
          options={entries.map(toOption)}
          display={display}
          onSelect={onChange}
          onBlur={onBlur}
          placeholder="Search entries…"
          invalid={invalid(error)}
          describedBy={describedBy(name, field, error)}
          label={field.label}
          required={field.required}
        />
        {value !== '' ? (
          <Button
            variant="ghost"
            iconOnly
            className="editlet-ff-reference__clear"
            aria-label={`Clear ${field.label}`}
            title="Clear"
            onClick={() => onChange('')}
          >
            <Icon.X size={14} />
          </Button>
        ) : null}
        {chosen && EntryLink ? (
          <EntryLink
            to={chosen.ref}
            className={buttonVariants({ variant: 'outline', className: 'editlet-ff-reference__open' })}
            aria-label={`Open ${chosen.title}`}
            title={`Open ${chosen.ref}`}
          >
            Open
            <Icon.ChevronRight size={14} />
          </EntryLink>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * `multiple: true` reference: chips (the title opens the entry, × removes it) plus a combobox that searches the
 * entries not chosen yet and appends the picked one. A chip whose entry does not exist says so.
 */
export function MultiReferenceField(props: WidgetProps<string[]>) {
  const { name, field, value, onChange, onBlur } = props;
  const entries = targetsOf(props);
  const titles = new Map(entries.map((e) => [e.ref, e.title]));
  const available = entries.filter((e) => !value.includes(e.ref));
  const max = field.type === 'reference' ? field.max : undefined;
  const full = max !== undefined && value.length >= max;
  const missing = props.ctx.entriesPending ? [] : value.filter((ref) => !titles.has(ref));
  const error = withMissing(props, missing);
  const { EntryLink } = props.ctx;
  return (
    <Field {...fieldProps(field, error, name)} htmlFor={name}>
      {value.length > 0 ? (
        <ul className="editlet-ff-reference__chips" aria-label={`${field.label} selected`}>
          {value.map((ref, i) => {
            const title = titles.get(ref);
            const broken = missing.includes(ref);
            return (
              // oxlint-disable-next-line no-array-index-key -- a hand-written list may repeat a reference (validation reports it)
              <li
                key={i}
                className={`editlet-ff-reference__chip${broken ? ' editlet-ff-reference__chip--broken' : ''}`}
              >
                {title === undefined || !EntryLink ? (
                  <span className="editlet-ff-reference__chip-label" title={ref}>
                    {broken ? `Not found: ${ref}` : (title ?? ref)}
                  </span>
                ) : (
                  <EntryLink to={ref} className="editlet-ff-reference__chip-label" title={`Open ${ref}`}>
                    {title}
                  </EntryLink>
                )}
                <button
                  type="button"
                  className="editlet-ff-reference__chip-remove"
                  onClick={() => onChange(value.filter((_, j) => j !== i))}
                  aria-label={`Remove ${title ?? ref}`}
                >
                  <Icon.X size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Combobox
        id={name}
        options={available.map(toOption)}
        display=""
        onSelect={(ref) => onChange([...value, ref])}
        onBlur={onBlur}
        placeholder={full ? 'Maximum reached' : 'Add… (type to search)'}
        disabled={full}
        invalid={invalid(error)}
        describedBy={describedBy(name, field, error)}
        label={field.label}
        required={field.required}
      />
    </Field>
  );
}
