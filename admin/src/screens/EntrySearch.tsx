import { Icon } from '../ui/primitives/icon';
import { InputGroup, InputGroupInput } from '../ui/primitives/input';

/**
 * The entry search of the reference picker and *Used by*: a case-insensitive match on the title or the ref
 * (`collection/slug`). An empty query matches everything.
 */
export function matches(query: string) {
  const q = query.trim().toLowerCase();
  return (e: { ref: string; title: string }) =>
    q === '' || e.title.toLowerCase().includes(q) || e.ref.toLowerCase().includes(q);
}

/** The search field over a list of entries. */
export function EntrySearch({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <InputGroup lead={<Icon name="search" size={20} />}>
      <InputGroupInput
        type="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </InputGroup>
  );
}
