export interface PreviewEnv {
  owner: string;
  repo: string;
  schemaPath: string;
  sessionMinutes: number;
}

/** The non-secret preview config `withEditlet` injects as `EDITLET_PREVIEW`. `null` when missing or malformed. */
export function readPreviewEnv(): PreviewEnv | null {
  const raw = process.env.EDITLET_PREVIEW;
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { owner, repo, schemaPath, sessionMinutes } = value as Record<string, unknown>;
  if (typeof owner !== 'string' || !owner) return null;
  if (typeof repo !== 'string' || !repo) return null;
  if (typeof schemaPath !== 'string' || !schemaPath) return null;
  if (typeof sessionMinutes !== 'number' || !Number.isFinite(sessionMinutes) || sessionMinutes <= 0) return null;
  return { owner, repo, schemaPath, sessionMinutes };
}
