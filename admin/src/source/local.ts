import {
  DEV_API_BASE,
  type DevCommitChange,
  type DevCommitRequest,
  type DevFilesResponse,
  type DevVersionsResponse,
} from '../../../core/devApi';
import { EditletError, type Issue } from '../../../core/issues';
import { versionLimit, type ContentSource, type FileChange } from '../../../core/source';

/** A `FileChange` with an optional expected blob sha (`null` = the file must not exist yet). */
export type SourceChange = FileChange & { sha?: string | null };

/** A `ContentSource` whose `commit` also takes per-change expected shas; it always has the history reads. */
export type LocalSource = ContentSource & {
  commit(changes: SourceChange[], message: string): Promise<{ issues: Issue[] }>;
  listVersions: NonNullable<ContentSource['listVersions']>;
  readVersion: NonNullable<ContentSource['readVersion']>;
};

export interface LocalSourceOptions {
  base?: string;
  fetch?: typeof fetch;
}

const CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function toDevChange(change: SourceChange): DevCommitChange {
  const { path, content } = change;
  const out: DevCommitChange =
    content === null
      ? { path, content: null }
      : typeof content === 'string'
        ? { path, content, encoding: 'utf8' }
        : { path, content: toBase64(content), encoding: 'base64' };
  if (Object.hasOwn(change, 'sha') && change.sha !== undefined) out.sha = change.sha;
  return out;
}

/** `ContentSource` over the local dev file API (`/__editlet/*`, served by `createDevHandler`). */
export function createLocalSource({
  base = DEV_API_BASE,
  fetch: fetchFn = globalThis.fetch.bind(globalThis),
}: LocalSourceOptions = {}): LocalSource {
  return {
    kind: 'local',

    async listFiles() {
      const res = await fetchFn(`${base}/files`);
      if (res.status !== 200) throw new Error(`Dev API ${res.status}`);
      const body = (await res.json()) as DevFilesResponse;
      return body.files;
    },

    async readFile(path) {
      const res = await fetchFn(`${base}/file?path=${encodeURIComponent(path)}`);
      if (res.status === 404) throw new EditletError([{ file: path, path: '', message: `File not found: ${path}` }]);
      if (res.status !== 200) throw new Error(`Dev API ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    async commit(changes: SourceChange[], message: string) {
      const body: DevCommitRequest = { message, changes: changes.map(toDevChange) };
      const res = await fetchFn(`${base}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 204) return { issues: [] };
      if ([400, 409, 422].includes(res.status)) {
        const { issues } = (await res.json()) as { issues: Issue[] };
        return { issues };
      }
      throw new Error(`Dev API ${res.status}`);
    },

    async listVersions(path, limit) {
      const query = new URLSearchParams({ path, limit: String(versionLimit(limit)) });
      const res = await fetchFn(`${base}/versions?${query}`);
      if (res.status !== 200) throw new Error(`Dev API ${res.status}`);
      return ((await res.json()) as DevVersionsResponse).versions;
    },

    async readVersion(path, commit) {
      const res = await fetchFn(`${base}/version?${new URLSearchParams({ path, commit })}`);
      if (res.status === 404) {
        throw new EditletError([{ file: path, path: '', message: `Not in ${commit.slice(0, 7)}: ${path}` }]);
      }
      if (res.status !== 200) throw new Error(`Dev API ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
