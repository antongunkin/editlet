import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AuthProvider, useAuth } from './auth';
import { errorText } from './errors';
import { SignIn, SignInDialog } from './SignIn';
import { GitHubUserContext, type GitHubUser } from './user';
import { WorkspaceProvider } from './workspace';

import { AuthError } from '../../../auth/client';
import { resolveGitStyle, type GitStyle } from '../../../core/gitStyle';
import { EditletError } from '../../../core/issues';
import { parseSchemaText } from '../../../core/schema';
import { createGitHubClient, GitHubError, type GitHubClient } from '../../../github';
import type { AdminConfig, AdminGitHubConfig } from '../../config';
import { GitHubPreviewSync } from '../preview/GitHubPreviewSync';
import { GateLoading } from '../screens/GateLoading';
import { Unavailable } from '../screens/Unavailable';
import { Shell } from '../Shell';
import { Button } from '../ui/primitives/button';
import { Icon } from '../ui/primitives/icon';

export { useGitHubUser, type GitHubRole, type GitHubUser } from './user';

type Access = { user: GitHubUser; status: 'ok' | 'read_only' | 'not_found' };

export const ACCESS_KEY = ['access'] as const;
export const GIT_STYLE_KEY = ['git-style'] as const;

const SCHEMA_PATH = 'cms/schema.json';

/**
 * The `git` style of the schema on the base branch (one raw `GET contents`). A missing or broken schema gives the
 * defaults: the shell shows the schema's own error later.
 */
async function readGitStyle(client: GitHubClient, { owner, repo, baseBranch }: AdminGitHubConfig): Promise<GitStyle> {
  try {
    const bytes = await client.rest<Uint8Array>('GET', `/repos/${owner}/${repo}/contents/${SCHEMA_PATH}`, {
      query: { ref: baseBranch },
      raw: true,
      accept: 'application/vnd.github.raw+json',
    });
    return resolveGitStyle(parseSchemaText(new TextDecoder().decode(bytes), SCHEMA_PATH).git);
  } catch (error) {
    if (error instanceof EditletError || (error instanceof GitHubError && error.code === 'not_found')) {
      return resolveGitStyle(null);
    }
    throw error;
  }
}

type RepoPermissions = { admin?: boolean; maintain?: boolean; push?: boolean };

/**
 * `GET /user`, then `GET /repos/{owner}/{repo}`: a `404` or no `permissions.push` means the user can't edit;
 * `admin` or `maintain` is the admin role, `push` alone the editor role.
 */
async function checkAccess(client: GitHubClient, { owner, repo }: AdminGitHubConfig): Promise<Access> {
  const me = await client.rest<{ login: string; avatar_url: string }>('GET', '/user');
  const user: GitHubUser = { login: me.login, avatarUrl: me.avatar_url, role: 'editor' };
  try {
    const { permissions: p } = await client.rest<{ permissions?: RepoPermissions }>('GET', `/repos/${owner}/${repo}`);
    if (p?.admin === true || p?.maintain === true) user.role = 'admin';
    return { user, status: p?.push === true ? 'ok' : 'read_only' };
  } catch (error) {
    if (error instanceof GitHubError && error.code === 'not_found') return { user, status: 'not_found' };
    throw error;
  }
}

/** `config.json` has no `github` section. */
export function NotConfigured() {
  return (
    <Unavailable
      title="Editing is not set up"
      icon="settings"
      tone="neutral"
      text={
        <>
          Editing on the live site is not set up. Set the <code>admin</code> option of the Editlet adapter (repo,
          authUrl). See <code>docs/admin/production.md</code>.
        </>
      }
    />
  );
}

/**
 * Signed in: one client for this session, the access check, then the workspace and the shell. When the session lapses
 * (idle, expired) the shell stays under `SignInDialog`; after a new sign-in the account is checked again, and only the
 * same login with write access goes on with the open screen. Anything else calls `onReplace` (fresh mount).
 */
function SignedIn({
  github,
  authUrl,
  storage,
  preview,
  param,
  fetch: fetchFn,
  onShell,
  onReplace,
}: {
  github: AdminGitHubConfig;
  authUrl?: string;
  storage?: Storage;
  /** `config.preview`: keep the site's preview cookie on the active branch (Layer B). */
  preview: boolean;
  /** `config.param`: the site's editor query parameter (default `editlet`). */
  param?: string;
  /** For the preview route (the site's own origin). */
  fetch?: typeof fetch;
  /** `true` while the shell is mounted. */
  onShell(up: boolean): void;
  onReplace(): void;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { getToken, fetch: authFetch, signOut, session } = auth;
  const client = useMemo(() => createGitHubClient({ token: getToken, fetch: authFetch }), [getToken, authFetch]);
  const access = useQuery({
    queryKey: ACCESS_KEY,
    queryFn: () => checkAccess(client, github),
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof AuthError) && count < 1,
  });
  const repo = `${github.owner}/${github.repo}`;
  const allowed = access.data?.status === 'ok';
  const style = useQuery({
    queryKey: GIT_STYLE_KEY,
    queryFn: () => readGitStyle(client, github),
    staleTime: Infinity,
    enabled: allowed,
    retry: (count, error) => !(error instanceof AuthError) && count < 1,
  });
  const ready = allowed && style.data !== undefined;
  const login = access.data?.user.login;

  useEffect(() => {
    if (!ready) return;
    onShell(true);
    return () => onShell(false);
  }, [ready, onShell]);

  /** The session lapsed while the shell was up: the next sign-in must be checked before the shell goes on. */
  const [recheck, setRecheck] = useState(false);
  useEffect(() => {
    if (!session && ready) setRecheck(true);
  }, [session, ready]);
  const loginRef = useRef(login);
  loginRef.current = login;
  useEffect(() => {
    if (!recheck || !session) return;
    let cancelled = false;
    checkAccess(client, github).then(
      (result) => {
        if (cancelled) return;
        if (result.status !== 'ok' || result.user.login !== loginRef.current) {
          queryClient.clear();
          onReplace();
          return;
        }
        queryClient.setQueryData(ACCESS_KEY, result);
        setRecheck(false);
        // What failed while signed out loads again; the rest (and the open form) stays as it is.
        void queryClient.refetchQueries({ predicate: (query) => query.state.status === 'error' });
      },
      (error: unknown) => {
        if (cancelled) return;
        // GitHub refused the new token: the session lapsed again and the dialog asks once more.
        if (error instanceof AuthError && error.code === 'unauthorized') return;
        queryClient.clear();
        onReplace();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [recheck, session, client, github, queryClient, onReplace]);

  const signOutButton = (size: 'md' | 'lg' = 'md') => (
    <Button size={size} full icon={<Icon name="logout" />} onClick={() => signOut()}>
      Sign out
    </Button>
  );

  const failed = access.error ?? style.error;
  if (failed) {
    return (
      <Unavailable title="Can't check your access" text={errorText(failed, { repo })}>
        <Button
          variant="primary"
          size="lg"
          full
          onClick={() => void (access.error ? access.refetch() : style.refetch())}
        >
          Try again
        </Button>
        {signOutButton('lg')}
      </Unavailable>
    );
  }
  if (!access.data) return <GateLoading />;

  const { user, status } = access.data;
  if (status === 'not_found') {
    return (
      <Unavailable
        title={`Can't open ${repo}`}
        text={`GitHub doesn't show ${repo} to ${user.login}. Check that the repository exists and that the GitHub App of the auth handler is installed on it.`}
      >
        {signOutButton()}
      </Unavailable>
    );
  }
  if (status === 'read_only') {
    return (
      <Unavailable
        title="No write access"
        icon="lock"
        text={`${errorText(new AuthError('forbidden'), { repo })} (signed in as ${user.login}). Ask an owner of the repository for write access, or sign in with another account.`}
      >
        {signOutButton()}
      </Unavailable>
    );
  }

  if (!style.data) return <GateLoading />;
  return (
    <GitHubUserContext.Provider value={user}>
      <WorkspaceProvider config={github} style={style.data} param={param} client={client} storage={storage}>
        <GitHubPreviewSync preview={preview} fetch={fetchFn} />
        <Shell
          overlay={
            session && !recheck ? null : (
              <SignInDialog authUrl={authUrl} repo={repo} login={user.login} checking={session !== null} />
            )
          }
        />
      </WorkspaceProvider>
    </GitHubUserContext.Provider>
  );
}

function Gate({
  config,
  storage,
  fetch: fetchFn,
}: {
  config: AdminConfig & { github: AdminGitHubConfig };
  storage?: Storage;
  fetch?: typeof fetch;
}) {
  const { session, lapsed } = useAuth();
  const queryClient = useQueryClient();
  const { github, authUrl } = config;
  const [shellUp, setShellUp] = useState(false);
  /** Bumped when a new sign-in may not take over the open screen: `SignedIn` mounts afresh. */
  const [mount, setMount] = useState(0);
  const onReplace = useMemo(() => () => setMount((n) => n + 1), []);
  const keepShell = lapsed && shellUp;
  const signedOut = !session && !keepShell;
  useEffect(() => {
    // A lapse without an open shell: nothing to resume, so nothing cached may reach the next account.
    if (signedOut && lapsed) queryClient.clear();
  }, [signedOut, lapsed, queryClient]);

  if (signedOut) return <SignIn authUrl={authUrl} repo={`${github.owner}/${github.repo}`} />;
  return (
    <SignedIn
      key={mount}
      github={github}
      authUrl={authUrl}
      storage={storage}
      preview={config.preview === true}
      param={config.param}
      fetch={fetchFn}
      onShell={setShellUp}
      onReplace={onReplace}
    />
  );
}

/** Production mode: sign-in → access check → workspace on GitHub → the shell. */
export function GitHubApp({
  config,
  fetch: fetchFn,
  storage,
}: {
  config: AdminConfig;
  fetch?: typeof globalThis.fetch;
  /** For the active branch (default `window.localStorage`). The session always uses `sessionStorage`. */
  storage?: Storage;
}) {
  const { github } = config;
  if (!github) return <NotConfigured />;
  return (
    <AuthProvider authUrl={config.authUrl} fetch={fetchFn} sessionMinutes={config.sessionMinutes}>
      <Gate config={{ ...config, github }} storage={storage} fetch={fetchFn} />
    </AuthProvider>
  );
}
