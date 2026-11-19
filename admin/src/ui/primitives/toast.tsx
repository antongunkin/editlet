import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import type { ComponentProps, ReactNode } from 'react';

import { Icon } from './icon';

import { cn } from '../cn';

/**
 * A short confirmation that goes away by itself (FigCraft `Toast`, proposal §14.9): a 343 × 48 pill on the toast
 * shadow with a check, 16 px medium text and an optional action (`View`, `Undo`). It is not for errors: those are banners.
 */
export function ToastView({
  className,
  action,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'children'> & { action?: ReactNode; children?: ReactNode }) {
  return (
    <div
      data-slot="toast"
      className={cn(
        'box-border flex h-12 w-full max-w-85.75 items-center gap-2 rounded-full bg-card px-4 text-base font-medium text-foreground shadow-toast',
        className,
      )}
      {...props}
    >
      <Icon name="check-circle" size={20} className="shrink-0 text-chart-2" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {action}
    </div>
  );
}

/** The toast's action, drawn as the design does: muted, underlined, 44 px tall. */
export const toastActionClass =
  'h-11 min-w-11 cursor-pointer border-0 bg-transparent p-0 font-sans text-base font-medium text-muted-foreground underline outline-none focus-visible:inset-ring-2 focus-visible:inset-ring-foreground';

/** The same button outside a live toast (the /design board draws it so): Base UI's `Toast.Action` needs a toast around it. */
export function ToastAction({ className, ...props }: ComponentProps<'button'>) {
  return <button type="button" className={cn(toastActionClass, className)} {...props} />;
}

/** The old name, kept so `ui/index.ts` (not ours to edit this round) still exports it: use `ToastAction`. */
export const ToastActionText = ToastAction;

/** The manager for toasts raised from outside React (`toastManager.add({ title })`). */
export const toastManager = ToastPrimitive.createToastManager();

function Toasts() {
  const { toasts } = ToastPrimitive.useToastManager();
  return toasts.map((toast) => (
    <ToastPrimitive.Root key={toast.id} toast={toast} className="outline-none">
      <ToastView
        action={
          toast.actionProps ? (
            <ToastPrimitive.Action className={toastActionClass}>{toast.actionProps.children}</ToastPrimitive.Action>
          ) : undefined
        }
      >
        {/* Base UI's title is an h2: a toast is a line of text, not a heading. */}
        <ToastPrimitive.Title render={<span />}>{toast.title}</ToastPrimitive.Title>
      </ToastView>
    </ToastPrimitive.Root>
  ));
}

/**
 * Mount once, near the root: the provider and the viewport, which is the live region. It is on the page from the start,
 * so a toast added later is announced once (Base UI announces through the viewport). Bottom centre over the bottom bar.
 */
export function Toaster({ children }: { children?: ReactNode }) {
  return (
    <ToastPrimitive.Provider toastManager={toastManager} timeout={4000}>
      {children}
      <ToastPrimitive.Viewport className="fixed inset-x-0 bottom-20 z-10 flex flex-col items-center gap-2 outline-none">
        <Toasts />
      </ToastPrimitive.Viewport>
    </ToastPrimitive.Provider>
  );
}
