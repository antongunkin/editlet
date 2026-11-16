import { useEffect, useId, useRef, useState } from 'react';

import { useAuth } from './auth';

import { AuthError } from '../../../auth/client';
import { Button } from '../ui/Button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Icon } from '../ui/Icon';
import { FIELD_INPUT_CLASS } from '../ui/Input';

const NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

type Phase = { kind: 'idle' } | { kind: 'waiting' } | { kind: 'failed'; code: string };

/** What a failed popup sign-in says, and whether trying again can help. */
function failure(code: string): { text: string; retry: boolean } {
  switch (code) {
    case 'popup_blocked':
      return { text: 'Your browser blocked the sign-in window.', retry: true };
    case 'access_denied':
      return { text: 'GitHub sign-in was cancelled.', retry: true };
    case 'origin_not_allowed':
      return {
        text: `This site isn't set up for sign-in yet. Add ${window.location.origin} to ALLOWED_ORIGINS of the auth handler.`,
        retry: false,
      };
    default:
      return { text: `Sign-in failed (${code}).`, retry: true };
  }
}

function TokenForm({ repo, primary, onUse }: { repo: string; primary: boolean; onUse(token: string): void }) {
  const [token, setToken] = useState('');
  const inputId = useId();
  const hintId = useId();
  return (
    <form
      className="editlet-sign-in__token"
      onSubmit={(event) => {
        event.preventDefault();
        onUse(token);
      }}
    >
      <Field label="Personal access token" htmlFor={inputId}>
        <input
          id={inputId}
          type="password"
          className={FIELD_INPUT_CLASS}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
        />
      </Field>
      <p id={hintId} className="editlet-sign-in__hint">
        Fine-grained token for {repo} with Contents and Pull requests read/write and Deployments read.{' '}
        <a className="editlet-link editlet-u-text-brand" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
          Create a token
        </a>
      </p>
      <Button type="submit" variant={primary ? 'primary' : 'outline'} disabled={!token.trim()}>
        Use token
      </Button>
    </form>
  );
}

/**
 * GitHub popup sign-in (when the site has an auth handler) and the personal access token form. `dialog`: the body only,
 * for `SignInDialog`.
 */
export function SignIn({ authUrl, repo, dialog = false }: { authUrl?: string; repo: string; dialog?: boolean }) {
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [tokenOpen, setTokenOpen] = useState(!authUrl);
  /** Bumped by Cancel, a new attempt and unmount: a result from an older attempt is ignored. */
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const titleId = useId();

  const stop = () => {
    generation.current += 1;
    abort.current?.abort();
    abort.current = null;
  };
  useEffect(() => {
    const attempts = generation;
    const controllers = abort;
    return () => {
      attempts.current += 1;
      controllers.current?.abort();
    };
  }, []);

  const start = () => {
    if (!authUrl) return;
    stop();
    const gen = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    // `signIn` opens the popup synchronously: no await before it.
    const pending = auth.signIn(authUrl, { signal: controller.signal });
    setPhase({ kind: 'waiting' });
    pending.then(
      () => {
        if (gen === generation.current) setPhase({ kind: 'idle' });
      },
      (error: unknown) => {
        if (gen !== generation.current) return;
        const code = error instanceof AuthError ? error.code : 'unknown_error';
        setPhase(code === 'popup_closed' ? { kind: 'idle' } : { kind: 'failed', code });
      },
    );
  };

  const cancel = () => {
    stop();
    setPhase({ kind: 'idle' });
  };

  const failed = phase.kind === 'failed' ? failure(phase.code) : null;

  const body = (
    <>
      {auth.notice ? (
        <div className="editlet-card editlet-card--banner" role="status">
          <Icon.Alert />
          <span className="editlet-u-flex-1">{auth.notice}</span>
        </div>
      ) : null}
      {phase.kind === 'waiting' ? (
        <div className="editlet-sign-in__actions">
          <p className="editlet-sign-in__text" role="status">
            Finish signing in in the GitHub window…
          </p>
          <Button variant="outline" onClick={cancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          {failed ? (
            <p className="editlet-sign-in__error" role="alert">
              {failed.text}
            </p>
          ) : null}
          {authUrl && (!failed || failed.retry) ? (
            <div className="editlet-sign-in__actions">
              <Button variant="primary" onClick={start}>
                {failed ? 'Try again' : 'Sign in with GitHub'}
              </Button>
            </div>
          ) : null}
          {tokenOpen ? (
            <TokenForm repo={repo} primary={!authUrl} onUse={auth.signInWithToken} />
          ) : (
            <Button variant="ghost" onClick={() => setTokenOpen(true)}>
              Use a personal access token
            </Button>
          )}
        </>
      )}
    </>
  );

  if (dialog) return body;
  return (
    <div className="editlet-layout__sign-in">
      <section className="editlet-sign-in" aria-labelledby={titleId}>
        <div className="editlet-sign-in__header">
          <h1 id={titleId} className="editlet-sign-in__title">
            Sign in to edit
          </h1>
          <p className="editlet-sign-in__text">Your edits are saved as commits to {repo} on GitHub.</p>
        </div>
        {body}
      </section>
    </div>
  );
}

/**
 * The session ended by itself while a screen was open: sign in again on top of it, so unsaved edits stay. `checking`:
 * signed in, the account is being compared with the one the screen belongs to.
 */
export function SignInDialog({
  authUrl,
  repo,
  login,
  checking,
}: {
  authUrl?: string;
  repo: string;
  login: string;
  checking: boolean;
}) {
  return (
    <Dialog open onOpenChange={() => undefined}>
      <DialogContent closable={false}>
        <DialogHeader>
          <DialogTitle>Sign in again</DialogTitle>
          <DialogDescription>Your open edits are kept. Sign in as {login} to go on.</DialogDescription>
        </DialogHeader>
        {checking ? (
          <p className="editlet-u-text-muted" role="status">
            Checking your account…
          </p>
        ) : (
          <SignIn authUrl={authUrl} repo={repo} dialog />
        )}
      </DialogContent>
    </Dialog>
  );
}
