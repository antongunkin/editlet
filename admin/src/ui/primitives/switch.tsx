import { Switch as SwitchPrimitive } from '@base-ui/react/switch';

import { cn } from '../cn';

/**
 * The switch of the redesign (FigCraft `Switch/<on|off>/<state>`): a 52 × 32 track with a 28 px knob and 2 px of padding,
 * inside a 52 × 44 hit area. On is the ink gradient with its inset shine (lighter on hover); off is the sunken track.
 * The knob is a raised white disc that stretches to 32 px while pressed. Focus is a 2 px ring inside: white when on, ink
 * when off. A switch flips at once and has no loading state: the save is a button's job (§14.9).
 */
export function Switch({
  className,
  ...props
}: Omit<SwitchPrimitive.Root.Props, 'className'> & { className?: string }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group relative inline-flex h-11 w-13 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 outline-none',
        'data-disabled:cursor-default',
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-track"
        data-focus-ring=""
        className={cn(
          'box-border flex h-8 w-13 items-center rounded-full bg-track p-0.5 shadow-sunken transition-colors duration-150 ease-release',
          'group-data-checked:bg-gradient-ink group-data-checked:shadow-ink-inset group-data-checked:group-hovered:bg-gradient-ink-hover',
          'group-focused:inset-ring-2 group-focused:inset-ring-foreground group-data-checked:group-focused:inset-ring-on-ink',
          'group-data-disabled:opacity-40 forced-colors:border',
        )}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            'h-7 w-7 rounded-full bg-card shadow-raised transition-all duration-150 ease-release',
            'group-hovered:shadow-raised-hover group-pressed:w-8',
            'data-checked:translate-x-5 data-checked:group-pressed:translate-x-4',
          )}
        />
      </span>
    </SwitchPrimitive.Root>
  );
}
