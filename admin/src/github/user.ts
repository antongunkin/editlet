import { createContext, useContext } from 'react';

/**
 * What the admin shows: `admin` for the Admin and Maintain roles, `editor` for push access only. A hint for the UI,
 * never a permission: GitHub's rulesets and `CODEOWNERS` decide what a push or a merge may do.
 */
export type GitHubRole = 'admin' | 'editor';

/** The signed-in GitHub account. */
export interface GitHubUser {
  login: string;
  avatarUrl: string;
  role: GitHubRole;
}

export const GitHubUserContext = createContext<GitHubUser | null>(null);

/** The signed-in account in github mode, else `null`. */
export function useGitHubUser(): GitHubUser | null {
  return useContext(GitHubUserContext);
}
