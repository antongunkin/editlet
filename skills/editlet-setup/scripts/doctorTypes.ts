export type Status = 'ok' | 'warn' | 'fail' | 'manual';

export interface Finding {
  status: Status;
  /** Stable id; `references/doctor.md` has a section per id. */
  id: string;
  message: string;
}

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface DoctorContext {
  root: string;
  /** Live site URL (`--url`); remote checks run only with it. */
  url?: string;
  nodeVersion: string;
  exec: (cmd: string, args: string[]) => ExecResult;
  fetch: typeof fetch;
}
