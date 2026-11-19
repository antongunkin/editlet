import { useEffect, useId, useRef, type ReactNode } from 'react';

import { BottomBar } from '../ui/parts/bottom-bar';
import { Header } from '../ui/parts/header';
import { Sheet } from '../ui/parts/sheet';
import { Banner } from '../ui/primitives/banner';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';
import { Input } from '../ui/primitives/input';

// Sign in as the design draws it (FigCraft *Sign in*, *Sign in · token*, *· token refused*, *· waiting*, *· again*):
// one CTA in the bottom bar and the other way as a quiet link under it. `screen` is the window before the shell
// exists; `again` is the modal over the kept screen when the session ends. Props only: SignIn.tsx has the auth.

export const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

export type SignInStep = 'start' | 'token' | 'waiting';

export interface SignInViewProps {
  variant?: 'screen' | 'again';
  step: SignInStep;
  repo: string;
  /** `again`: the account that has to sign in. */
  login?: string;
  /** `again`: the line under the modal's title (the open screen's name). */
  sub?: string;
  /** `screen`: the window's Move and Minimize. */
  actions?: ReactNode;
  /** Why the session ended (*Your GitHub session expired.*), a notice above the form. */
  notice?: string | null;
  /** The popup sign-in failed: what happened. */
  failure?: string | null;
  /** The popup can be tried again after the failure. */
  retry?: boolean;
  /** The site has an auth handler: *Sign in with GitHub* exists. */
  github: boolean;
  token?: string;
  onTokenChange?: (token: string) => void;
  /** GitHub refused the token: the field is red and says so. */
  tokenError?: string | null;
  /** `again`: signed in, the account is being compared with the one the screen belongs to. */
  checking?: boolean;
  onGitHub?: () => void;
  onCancel?: () => void;
  onOpenToken?: () => void;
  onUseToken?: () => void;
}

const link = 'h-11 w-full text-sm font-medium text-tray-muted-foreground underline';

function Brand({ repo, waiting }: { repo: string; waiting: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 pt-12 pb-4 text-center">
      <span
        aria-hidden="true"
        className="flex size-16 items-center justify-center rounded-2xl bg-gradient-ink text-on-ink shadow-button-primary"
      >
        <Icon name="pencil" size={24} />
      </span>
      <h1 className="m-0 text-3xl font-semibold">Sign in to edit</h1>
      {waiting ? (
        <output className="block m-0 text-base text-tray-muted-foreground">
          Finish signing in in the GitHub window…
        </output>
      ) : (
        <p className="m-0 text-base text-tray-muted-foreground">Your edits are saved as commits to {repo}.</p>
      )}
    </div>
  );
}

function TokenFields({
  repo,
  heading,
  token,
  onTokenChange,
  error,
}: {
  repo: string;
  /** The screen's `h1`; in the modal a plain label. */
  heading: boolean;
  token: string;
  onTokenChange?: (token: string) => void;
  error?: string | null;
}) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  // The link that opened this step is gone: the field takes the focus (the keyboard rises on a phone, as in the design).
  useEffect(() => input.current?.focus({ preventScroll: true }), []);
  const label = <label htmlFor={inputId}>Personal access token</label>;
  return (
    <div className="flex flex-col gap-3 px-4 pt-2">
      {heading ? (
        <h1 className="m-0 text-2xl font-semibold">{label}</h1>
      ) : (
        <span className="text-sm font-medium text-tray-muted-foreground">{label}</span>
      )}
      <Input
        ref={input}
        id={inputId}
        type="password"
        value={token}
        onChange={(event) => onTokenChange?.(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${errorId} ${hintId}` : hintId}
      />
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="m-0 flex items-center gap-2 text-sm font-medium text-tint-danger-foreground"
        >
          <Icon name="alert" size={16} className="shrink-0 text-destructive" />
          {error}
        </p>
      ) : null}
      <p id={hintId} className="m-0 text-sm text-tray-muted-foreground">
        Needs Contents and Pull requests (read and write), Deployments (read). Fine-grained, for {repo}.{' '}
        <a
          className="rounded-md text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={NEW_TOKEN_URL}
          target="_blank"
          rel="noreferrer"
        >
          Create a token
        </a>
      </p>
    </div>
  );
}

export function SignInView({
  variant = 'screen',
  step,
  repo,
  login,
  sub,
  actions,
  notice,
  failure,
  retry = true,
  github,
  token = '',
  onTokenChange,
  tokenError,
  checking = false,
  onGitHub,
  onCancel,
  onOpenToken,
  onUseToken,
}: SignInViewProps) {
  const formId = useId();
  const again = variant === 'again';
  const showGitHub = github && (!failure || retry);

  const failed = failure && step === 'start';

  let body: ReactNode;
  if (checking) {
    body = (
      <output className="block m-0 px-4 text-center text-base text-tray-muted-foreground">
        Checking your account…
      </output>
    );
  } else if (step === 'token') {
    // With no GitHub sign-in the token form is the whole screen: the brand stays above it.
    body = (
      <>
        {!again && !github ? <Brand repo={repo} waiting={false} /> : null}
        <TokenFields
          repo={repo}
          heading={!again && github}
          token={token}
          onTokenChange={onTokenChange}
          error={tokenError}
        />
      </>
    );
  } else if (again) {
    body =
      step === 'waiting' ? (
        <output className="block m-0 px-4 text-center text-base text-tray-muted-foreground">
          Finish signing in in the GitHub window…
        </output>
      ) : (
        <p className="m-0 px-4 text-center text-base text-tray-muted-foreground">
          Your open edits are kept. Sign in as {login} to go on.
        </p>
      );
  } else {
    body = <Brand repo={repo} waiting={step === 'waiting'} />;
  }

  let bar: ReactNode = null;
  if (!checking) {
    if (step === 'waiting') {
      bar = (
        <>
          <Button
            variant="primary"
            size="lg"
            full
            loading
            busyLabel="Signing in…"
            iconRight={<Icon name="arrow-up-right" />}
          >
            Sign in with GitHub
          </Button>
          <Button variant="link" className={link} onClick={onCancel}>
            Cancel
          </Button>
        </>
      );
    } else if (step === 'token') {
      bar = (
        <>
          <Button type="submit" form={formId} variant="primary" size="lg" full disabled={!token.trim()}>
            Use token
          </Button>
          {showGitHub ? (
            <Button variant="link" className={link} onClick={onGitHub}>
              Sign in with GitHub instead
            </Button>
          ) : null}
        </>
      );
    } else {
      bar = (
        <>
          {showGitHub ? (
            <Button variant="primary" size="lg" full iconRight={<Icon name="arrow-up-right" />} onClick={onGitHub}>
              {failure ? 'Try again' : 'Sign in with GitHub'}
            </Button>
          ) : null}
          <Button variant="link" className={link} onClick={onOpenToken}>
            Use a personal access token
          </Button>
        </>
      );
    }
  }
  // The bar's actions stack: the CTA, then the link under it (4 px apart, `sign_bar`).
  const barBox = bar ? <div className="flex w-full flex-col gap-1">{bar}</div> : null;

  const content = (
    <form
      id={formId}
      className="flex flex-col gap-3 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 'token' && token.trim()) onUseToken?.();
      }}
    >
      {notice || failed ? (
        <div className="flex flex-col gap-2 px-4">
          {notice ? (
            <output className="block">
              <Banner tone="unsaved">{notice}</Banner>
            </output>
          ) : null}
          {failed ? (
            <Banner tone="danger" role="alert">
              {failure}
            </Banner>
          ) : null}
        </div>
      ) : null}
      {body}
    </form>
  );

  if (again) {
    return (
      <Sheet
        open
        closable={false}
        title="Sign in again"
        sub={sub}
        bar={barBox ? <BottomBar className="shrink-0">{barBox}</BottomBar> : undefined}
      >
        {content}
      </Sheet>
    );
  }
  return (
    <section data-editlet="screen" className="flex min-h-0 flex-1 flex-col bg-background text-foreground">
      <Header as="span" title="Editlet" actions={actions} className="shrink-0" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{content}</div>
      {barBox ? <BottomBar className="shrink-0">{barBox}</BottomBar> : null}
    </section>
  );
}
