import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useAuth } from './auth';
import { TOKEN_REJECTED } from './errors';
import { SignInView, type SignInViewProps } from './SignInView';

import { AuthError } from '../../../auth/client';
import { useScreenChrome } from '../window/chrome';
import { GateFrame } from '../window/GateFrame';

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

/**
 * GitHub popup sign-in (when the site has an auth handler) and the personal access token form: the state of the flow
 * and its handlers, as the props of `SignInView`.
 */
function useSignIn(authUrl: string | undefined, repo: string): Omit<SignInViewProps, 'variant' | 'actions'> {
  const auth = useAuth();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // A token GitHub just refused (the sign-out notice says so): the form opens again with the reason on the field.
  const refused = auth.notice === TOKEN_REJECTED;
  const [tokenOpen, setTokenOpen] = useState(!authUrl || refused);
  const [token, setToken] = useState('');
  const [tokenError, setTokenError] = useState<string | null>(refused ? TOKEN_REJECTED : null);
  // Each refusal (the notice comes back after every sign-in attempt) opens the form again, the typed token still in it.
  useEffect(() => {
    if (!refused) return;
    setTokenOpen(true);
    setTokenError(TOKEN_REJECTED);
  }, [refused]);
  /** Bumped by Cancel, a new attempt and unmount: a result from an older attempt is ignored. */
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);

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
    setTokenOpen(false);
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
  return {
    step: phase.kind === 'waiting' ? 'waiting' : tokenOpen ? 'token' : 'start',
    repo,
    // The refusal is shown on the field, not twice.
    notice: refused ? null : auth.notice,
    failure: failed?.text ?? null,
    retry: failed?.retry ?? true,
    github: Boolean(authUrl),
    token,
    onTokenChange: (next) => {
      setToken(next);
      setTokenError(null);
    },
    tokenError,
    onGitHub: start,
    onCancel: cancel,
    onOpenToken: () => setTokenOpen(true),
    onUseToken: () => auth.signInWithToken(token),
  };
}

/** The window before the shell exists, signed out: GitHub or a personal access token. */
export function SignIn({ authUrl, repo }: { authUrl?: string; repo: string }) {
  return (
    <GateFrame>
      <SignInScreen authUrl={authUrl} repo={repo} />
    </GateFrame>
  );
}

function SignInScreen({ authUrl, repo }: { authUrl?: string; repo: string }) {
  const chrome = useScreenChrome();
  const props = useSignIn(authUrl, repo);
  return <SignInView {...props} actions={chrome.windowActions} />;
}

/**
 * The session ended by itself while a screen was open: sign in again on top of it, so unsaved edits stay. `checking`:
 * signed in, the account is being compared with the one the screen belongs to. It has to be rendered inside the
 * window (`Shell`'s `overlay`), where the sheets are.
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
}): ReactNode {
  const props = useSignIn(authUrl, repo);
  return <SignInView {...props} variant="again" login={login} sub={repo} checking={checking} />;
}
