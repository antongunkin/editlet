import { useId, useMemo, useState, type KeyboardEvent } from 'react';

import { FIELD_INPUT_CLASS } from '../ui';

export interface ComboboxOption {
  value: string;
  label: string;
  /** Second line, muted (the `collection/slug` of an entry). */
  hint?: string;
}

export interface ComboboxProps {
  id: string;
  options: ComboboxOption[];
  /** Text shown while the input is not being typed in (the chosen entry's title; `''` for none). */
  display: string;
  onSelect(value: string): void;
  onBlur?(): void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: true;
  describedBy?: string;
  /** The field's label: the input's and the list's accessible name, also for tools that do not follow `<label for>`. */
  label?: string;
  required?: boolean;
}

/** Options whose label or hint contains every word of `query` (case-insensitive), in their order. */
export function filterOptions(options: ComboboxOption[], query: string): ComboboxOption[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return options;
  return options.filter((o) => {
    const text = `${o.label} ${o.hint ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/**
 * An input with a filtered list of options (ARIA combobox + listbox). Focus opens the list; typing filters it by
 * title and hint; arrows move, Enter picks, Escape closes. The input shows `display` while not typing.
 */
export function Combobox({
  id,
  options,
  display,
  onSelect,
  onBlur,
  placeholder,
  disabled,
  invalid,
  describedBy,
  label,
  required,
}: ComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const shown = useMemo(() => filterOptions(options, query ?? ''), [options, query]);
  const current = Math.min(active, shown.length - 1);
  const optionId = (i: number) => `${listId}-${i}`;

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(0);
  };
  const pick = (option: ComboboxOption | undefined) => {
    if (!option) return;
    onSelect(option.value);
    close();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((Math.max(current, 0) + step + shown.length) % Math.max(shown.length, 1));
    } else if (e.key === 'Enter') {
      if (!open) return;
      e.preventDefault();
      pick(shown[current]);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="editlet-ff-combobox">
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        className={FIELD_INPUT_CLASS}
        value={query ?? display}
        placeholder={placeholder}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && current >= 0 ? optionId(current) : undefined}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        aria-label={label}
        aria-required={required || undefined}
        onFocus={(e) => {
          e.currentTarget.select();
          setOpen(true);
        }}
        onClick={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          close();
          onBlur?.();
        }}
      />
      <div id={listId} role="listbox" aria-label={label} className="editlet-ff-combobox__list" hidden={!open}>
        {shown.map((o, i) => (
          <div
            key={o.value}
            id={optionId(i)}
            role="option"
            aria-selected={i === current}
            className={`editlet-ff-combobox__option${i === current ? ' editlet-ff-combobox__option--active' : ''}`}
            // Keep the focus in the input: the click picks before the blur closes the list.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(o)}
            onMouseEnter={() => setActive(i)}
          >
            <span className="editlet-ff-combobox__label">{o.label}</span>
            {o.hint ? <span className="editlet-ff-combobox__hint">{o.hint}</span> : null}
          </div>
        ))}
        {shown.length === 0 ? <p className="editlet-ff-combobox__empty">No matching entries</p> : null}
      </div>
    </div>
  );
}
