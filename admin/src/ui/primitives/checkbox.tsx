import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import { Radio as RadioPrimitive } from '@base-ui/react/radio';
import { RadioGroup as RadioGroupPrimitive } from '@base-ui/react/radio-group';

import { Icon } from './icon';

import { cn } from '../cn';

/**
 * The 24 px box of a checkbox or a radio inside its 44 × 44 hit area (FigCraft `states.py` check_s). Off: a white box
 * with a 1 px edge; on: the primary fill. A control that is not a button has no loading state (§14.9).
 */
const box = [
  'flex size-6 items-center justify-center bg-card text-primary-foreground transition-colors duration-150 ease-release',
  'inset-ring-1 inset-ring-input group-hovered:bg-accent group-hovered:inset-ring-muted-foreground',
  'group-pressed:bg-accent group-pressed:inset-ring-muted-foreground',
  'group-data-checked:bg-primary group-data-checked:inset-ring-0 group-data-checked:group-hovered:bg-primary-hover group-data-checked:group-pressed:bg-primary-active',
  'group-focused:inset-ring-2 group-focused:inset-ring-ring group-data-disabled:opacity-40 forced-colors:border',
];
const hit =
  'group relative inline-flex size-11 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 outline-none data-disabled:cursor-default';

export function Checkbox({
  className,
  ...props
}: Omit<CheckboxPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <CheckboxPrimitive.Root data-slot="checkbox" className={cn(hit, className)} {...props}>
      <span data-slot="checkbox-box" data-focus-ring="" className={cn(box, 'rounded-md')}>
        <CheckboxPrimitive.Indicator>
          <Icon name="check" size={16} strokeWidth={2.5} />
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  );
}

export function RadioGroup({
  className,
  ...props
}: Omit<RadioGroupPrimitive.Props, 'className'> & { className?: string }) {
  return <RadioGroupPrimitive data-slot="radio-group" className={cn('flex flex-col', className)} {...props} />;
}

export function Radio({ className, ...props }: Omit<RadioPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <RadioPrimitive.Root data-slot="radio" className={cn(hit, className)} {...props}>
      <span data-slot="radio-box" data-focus-ring="" className={cn(box, 'rounded-full')}>
        <RadioPrimitive.Indicator className="size-2.5 rounded-full bg-primary-foreground" />
      </span>
    </RadioPrimitive.Root>
  );
}
