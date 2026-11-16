export const AUTH_MESSAGE_SOURCE = 'editlet-auth' as const;

export interface TokenResponse {
  /** `ghu_…` */
  access_token: string;
  /** `"bearer"` */
  token_type: string;
  /** `""` for GitHub Apps */
  scope: string;
  /** Seconds, 28800. Absent when the app has expiring tokens off. */
  expires_in?: number;
  /** `ghr_…` */
  refresh_token?: string;
  /** Seconds, 15897600 */
  refresh_token_expires_in?: number;
}

export type AuthMessage =
  | { source: typeof AUTH_MESSAGE_SOURCE; ok: true; token: TokenResponse }
  | { source: typeof AUTH_MESSAGE_SOURCE; ok: false; error: string; description?: string };
