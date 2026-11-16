import { useId, useState, type ReactNode } from 'react';

import { FieldWidget } from './FormFields';
import { errorText } from './shared';
import type { FieldContext, WidgetProps } from './types';

import { BLOCK_KEY, type Field } from '../../../core/schema';
import { ITEM_KEY, newItem } from '../entry/values';
import { Button, Icon } from '../ui';

type Fields = Record<string, Field>;
type Item = Record<string, unknown>;

/**
 * Splits the messages of a container (`issuesByField` gives `title: Required`, `2.title: Required`) by their first
 * path segment: `{ title: ['Required'], '2': ['title: Required'], '': [own messages] }`.
 */
export function splitErrors(error: string[] | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const message of error ?? []) {
    const m = /^([A-Za-z0-9]+)(?:\.([^\s:]+))?: ([^]*)$/.exec(message);
    const key = m ? m[1]! : '';
    const text = !m ? message : m[2] ? `${m[2]}: ${m[3]}` : m[3]!;
    (out[key] ??= []).push(text);
  }
  return out;
}

/** Nested widgets get no select-to-edit target: only the body takes part in it. */
const nestedCtx = (ctx: FieldContext): FieldContext => ({ ...ctx, selectTarget: undefined });

/** The widgets of `fields` over one object value, named `<name>.<key>`. */
function NestedFields(props: {
  name: string;
  fields: Fields;
  value: Item;
  onChange(v: Item): void;
  errors: Record<string, string[]>;
  ctx: FieldContext;
}) {
  const { name, fields, value, onChange, errors, ctx } = props;
  return (
    <div className="editlet-ff-object__fields">
      {Object.entries(fields).map(([key, field]) => (
        <FieldWidget
          key={key}
          name={`${name}.${key}`}
          field={field}
          value={value[key]}
          onChange={(v) => onChange({ ...value, [key]: v })}
          error={errors[key]}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

/** The frame of a container: a fieldset with the label (and `*`), the hint and the container's own errors. */
function Group(props: {
  name: string;
  field: Field;
  own: string[] | undefined;
  children: ReactNode;
  actions?: ReactNode;
}) {
  const { name, field, own, children, actions } = props;
  const error = errorText(own);
  return (
    <fieldset className="editlet-field editlet-ff-object" aria-describedby={error ? `${name}-error` : undefined}>
      <legend className="editlet-ff-object__legend">
        <span className="editlet-field__label">
          {field.label}
          {field.required ? <span className="editlet-field__required">*</span> : null}
        </span>
        {field.hint ? <span className="editlet-field__hint">{field.hint}</span> : null}
      </legend>
      {children}
      {actions}
      {error ? (
        <div id={`${name}-error`} className="editlet-field__error" role="alert">
          <Icon.X size={11} />
          {error}
        </div>
      ) : null}
    </fieldset>
  );
}

const asItem = (v: unknown): Item => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Item) : {});

/** `object`: its fields in a group. */
export function ObjectField({ name, field, value, onChange, error, ctx }: WidgetProps<Item>) {
  if (field.type !== 'object') return null;
  const errors = splitErrors(error);
  return (
    <Group name={name} field={field} own={errors['']}>
      <NestedFields
        name={name}
        fields={field.fields}
        value={value}
        onChange={onChange}
        errors={errors}
        ctx={nestedCtx(ctx)}
      />
    </Group>
  );
}

/** The first non-empty string child: names an item in its header. */
function itemTitle(fields: Fields, item: Item): string | undefined {
  for (const [key, f] of Object.entries(fields)) {
    const v = item[key];
    if ((f.type === 'string' || f.type === 'text') && typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

/**
 * The cards of a list (`object` with `list`, or `blocks`): each item's fields, Move up, Move down and Remove; `add`
 * renders the control that appends an item.
 */
function ItemList(
  props: WidgetProps<unknown[]> & { kindOf(item: Item): { label: string; fields: Fields } | undefined; add: ReactNode },
) {
  const { name, field, value, onChange, error, ctx, kindOf, add } = props;
  const errors = splitErrors(error);
  const move = (from: number, to: number) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <Group name={name} field={field} own={errors['']} actions={add}>
      {value.length > 0 ? (
        <ol className="editlet-ff-items" aria-label={`${field.label} items`}>
          {value.map((raw, i) => {
            const item = asItem(raw);
            const kind = kindOf(item);
            const title = kind ? itemTitle(kind.fields, item) : undefined;
            const heading = [kind?.label ?? `Unknown ${String(item[BLOCK_KEY] ?? 'item')}`, title]
              .filter(Boolean)
              .join(' · ');
            const key = typeof item[ITEM_KEY] === 'string' ? (item[ITEM_KEY] as string) : `at-${i}`;
            const itemErrors = splitErrors(errors[String(i)]);
            return (
              <li key={key} className="editlet-ff-items__item" aria-label={`${i + 1}. ${heading}`}>
                <div className="editlet-ff-items__head">
                  <span className="editlet-ff-items__title">
                    <span className="editlet-ff-items__index">{i + 1}</span>
                    {heading}
                  </span>
                  <span className="editlet-ff-items__actions">
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Move ${heading} up`}
                      title="Move up"
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      <Icon.ChevronDown size={14} className="editlet-ff-items__up" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Move ${heading} down`}
                      title="Move down"
                      disabled={i === value.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      <Icon.ChevronDown size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconOnly
                      aria-label={`Remove ${heading}`}
                      title="Remove"
                      onClick={() => onChange(value.filter((_, j) => j !== i))}
                    >
                      <Icon.Trash size={14} />
                    </Button>
                  </span>
                </div>
                {itemErrors[''] ? (
                  <div className="editlet-field__error" role="alert">
                    <Icon.X size={11} />
                    {errorText(itemErrors[''])}
                  </div>
                ) : null}
                {kind ? (
                  <NestedFields
                    name={`${name}.${i}`}
                    fields={kind.fields}
                    value={item}
                    onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))}
                    errors={itemErrors}
                    ctx={nestedCtx(ctx)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
    </Group>
  );
}

const full = (field: Field, count: number) =>
  (field.type === 'object' || field.type === 'blocks') && field.max !== undefined && count >= field.max;

/** `object` with `list: true`: a card per item, and Add item. */
export function ObjectListField(props: WidgetProps<unknown[]>) {
  const { field, value, onChange } = props;
  if (field.type !== 'object') return null;
  const add = (
    <Button
      variant="outline"
      size="sm"
      icon={<Icon.Plus size={14} />}
      disabled={full(field, value.length)}
      onClick={() => onChange([...value, newItem(field)])}
    >
      Add {field.label.toLowerCase()} item
    </Button>
  );
  return <ItemList {...props} kindOf={() => ({ label: 'Item', fields: field.fields })} add={add} />;
}

/** `blocks`: a card per block, and Add block, which opens the list of block kinds. */
export function BlocksField(props: WidgetProps<unknown[]>) {
  const { field, value, onChange } = props;
  const kindsId = useId();
  const [open, setOpen] = useState(false);
  if (field.type !== 'blocks') return null;
  const disabled = full(field, value.length);
  const add = (
    <div className="editlet-ff-blocks__add">
      <Button
        variant="outline"
        size="sm"
        icon={<Icon.Plus size={14} />}
        disabled={disabled}
        aria-expanded={open && !disabled}
        aria-controls={kindsId}
        onClick={() => setOpen(!open)}
      >
        Add block
      </Button>
      {open && !disabled ? (
        <div id={kindsId} className="editlet-ff-blocks__kinds" role="group" aria-label={`${field.label}: block kinds`}>
          {Object.entries(field.blocks).map(([kind, block]) => (
            <Button
              key={kind}
              variant="ghost"
              size="sm"
              data-block={kind}
              onClick={() => {
                setOpen(false);
                onChange([...value, newItem(field, kind)]);
              }}
            >
              {block.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
  return (
    <ItemList
      {...props}
      kindOf={(item) => {
        const kind = item[BLOCK_KEY];
        return typeof kind === 'string' && Object.hasOwn(field.blocks, kind) ? field.blocks[kind] : undefined;
      }}
      add={add}
    />
  );
}
