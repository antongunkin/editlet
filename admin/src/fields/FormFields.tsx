import { BooleanField } from './BooleanField';
import { ColorField } from './ColorField';
import { DatetimeField } from './DatetimeField';
import { ImageField } from './ImageField';
import { JsonField } from './JsonField';
import { MarkdownField } from './MarkdownField';
import { NumberField } from './NumberField';
import { BlocksField, ObjectField, ObjectListField } from './ObjectField';
import { MultiReferenceField, ReferenceField } from './ReferenceField';
import { MultiSelectField, SelectField } from './SelectField';
import { asString, asStringList } from './shared';
import { StringField } from './StringField';
import { StringListField } from './StringListField';
import { TextField } from './TextField';
import type { ImageValue, WidgetProps } from './types';
import { UrlField } from './UrlField';

function asImage(v: unknown): ImageValue {
  if (typeof v === 'string') return { src: v, alt: '' };
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { src: '', alt: '' };
  const o = v as Record<string, unknown>;
  return { src: asString(o.src), alt: asString(o.alt) };
}

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Picks the widget for `field.type` and coerces the UI value to the widget's value type. */
export function FieldWidget(props: WidgetProps<unknown>) {
  const { field, value } = props;
  const p = <V,>(v: V) => ({ ...props, value: v, onChange: props.onChange as (v: V) => void });
  switch (field.type) {
    case 'string':
      return field.list ? <StringListField {...p(asStringList(value))} /> : <StringField {...p(asString(value))} />;
    case 'text':
      return <TextField {...p(asString(value))} />;
    case 'markdown':
      return <MarkdownField {...p(asString(value))} />;
    case 'boolean':
      return <BooleanField {...p(typeof value === 'boolean' ? value : undefined)} />;
    case 'select':
      return field.multiple ? (
        <MultiSelectField {...p(asStringList(value))} />
      ) : (
        <SelectField {...p(asString(value))} />
      );
    case 'number':
      return <NumberField {...p(asString(value))} />;
    case 'datetime':
      return <DatetimeField {...p(asString(value))} />;
    case 'json':
      return <JsonField {...p(asString(value))} />;
    case 'url':
      return <UrlField {...p(asString(value))} />;
    case 'color':
      return <ColorField {...p(asString(value))} />;
    case 'image':
      return <ImageField {...p(asImage(value))} />;
    case 'reference':
      return field.multiple ? (
        <MultiReferenceField {...p(asStringList(value))} />
      ) : (
        <ReferenceField {...p(asString(value))} />
      );
    case 'object':
      return field.list ? <ObjectListField {...p(asList(value))} /> : <ObjectField {...p(asRecord(value))} />;
    case 'blocks':
      return <BlocksField {...p(asList(value))} />;
  }
}
