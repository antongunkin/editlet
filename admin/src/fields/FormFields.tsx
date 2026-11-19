import { ColorField } from './ColorField';
import { ImageField } from './ImageField';
import { JsonField } from './JsonField';
import { MarkdownField } from './MarkdownField';
import { NumberField } from './NumberField';
import { MultiSelectField } from './SelectField';
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

/**
 * The widget for a field that edits in its own modal (screens/FieldRows.tsx), with the UI value coerced to its type.
 * A boolean (a switch in its row), a single select, a reference, a date, an object and the blocks have their editors in
 * FieldRows.tsx, so they render nothing here.
 */
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
    case 'select':
      return field.multiple ? <MultiSelectField {...p(asStringList(value))} /> : null;
    case 'number':
      return <NumberField {...p(asString(value))} />;
    case 'json':
      return <JsonField {...p(asString(value))} />;
    case 'url':
      return <UrlField {...p(asString(value))} />;
    case 'color':
      return <ColorField {...p(asString(value))} />;
    case 'image':
      return <ImageField {...p(asImage(value))} />;
    case 'boolean':
    case 'datetime':
    case 'reference':
    case 'object':
    case 'blocks':
      return null;
  }
}
