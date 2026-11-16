import { Readable } from 'node:stream';

import { vi } from 'vitest';

export interface ScriptResult {
  status: number;
  stdout: string;
  stderr: string;
}

class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/**
 * Runs a skill CLI script in this process, as `node <script> ...argv` would (fresh module, own argv, stdin, stdout,
 * stderr, exit code), so v8 coverage follows it. The spawned jiti tests check the same scripts as real processes.
 */
export async function runScript(script: string, argv: string[], stdin = ''): Promise<ScriptResult> {
  const saved = { argv: process.argv, stdin: Object.getOwnPropertyDescriptor(process, 'stdin')! };
  let stdout = '';
  let stderr = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
  const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
    throw new Exit(Number(code ?? 0));
  });
  // `readFileSync(0)` (style.mjs pr-body) and `for await (process.stdin)` (guard.mjs) both read this text.
  vi.doMock('node:fs', async (importOriginal) => {
    const fs = await importOriginal<typeof import('node:fs')>();
    const readFileSync = ((path: unknown, ...rest: unknown[]) =>
      path === 0 ? stdin : (fs.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)) as typeof fs.readFileSync;
    return { ...fs, default: { ...fs, readFileSync }, readFileSync };
  });
  Object.defineProperty(process, 'stdin', { value: Readable.from([Buffer.from(stdin)]), configurable: true });
  process.argv = [process.execPath, script, ...argv];
  process.exitCode = undefined;
  let status: number;
  try {
    vi.resetModules();
    await import(/* @vite-ignore */ script);
    status = Number(process.exitCode ?? 0);
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    status = error.code;
  } finally {
    process.argv = saved.argv;
    process.exitCode = undefined;
    Object.defineProperty(process, 'stdin', saved.stdin);
    vi.doUnmock('node:fs');
    out.mockRestore();
    err.mockRestore();
    exit.mockRestore();
  }
  return { status, stdout, stderr };
}
