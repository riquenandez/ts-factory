import { appendFileSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { join } from "node:path";
import { isDict } from "../utils.ts";

const PATHSEP = ":";

export function operatorEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  const venv = env.VIRTUAL_ENV;
  delete env.VIRTUAL_ENV;
  let parts = (env.PATH ?? "").split(PATHSEP).filter(Boolean);
  if (venv) {
    const venvBin = join(venv, "bin");
    parts = parts.filter((p) => p !== venvBin);
  }
  parts = parts.filter((p) => !p.endsWith("/node_modules/.bin"));
  env.PATH = parts.join(PATHSEP);
  return env;
}

function utf8(bytes?: Uint8Array | null): string {
  return Buffer.from(bytes ?? []).toString("utf8");
}

/** POSIX `shlex.quote` / `shlex.join`. */
export function shlexQuote(s: string): string {
  if (s.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

export function shlexJoin(argv: string[]): string {
  return argv.map(shlexQuote).join(" ");
}

export function spawnCaptured(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeoutSeconds?: number } = {},
): { returncode: number; stdout: string; stderr: string } {
  const env = opts.env ?? operatorEnv();
  try {
    const result = Bun.spawnSync({
      cmd: argv,
      cwd: opts.cwd,
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
      timeout: opts.timeoutSeconds !== undefined ? opts.timeoutSeconds * 1000 : undefined,
    });
    const stdout = utf8(result.stdout);
    const stderr = utf8(result.stderr);
    if (result.exitCode === null && result.signalCode) {
      return { returncode: 124, stdout, stderr: stderr + `\nTimed out after ${opts.timeoutSeconds}s.` };
    }
    return { returncode: result.exitCode ?? 1, stdout, stderr };
  } catch (error) {
    return { returncode: 127, stdout: "", stderr: String(error) };
  }
}

export function spawnShell(
  command: string,
  opts: { cwd?: string } = {},
): { returncode: number; stdout: string; stderr: string } {
  return spawnCaptured(["/bin/sh", "-c", command], opts);
}

export interface SpawnJsonlOpts {
  cmd: string[];
  cwd: string;
  env: Record<string, string>;
  /** Bytes written to stdin, then stdin is closed. Omitted: stdin is "ignore". */
  stdin?: string;
  /** Every stdout chunk is appended here as received, before it is parsed. */
  rawOutputPath: string;
  /** Called once per JSON-object line, in order. Non-JSON lines and non-object values are skipped. */
  onEvent: (event: Record<string, unknown>) => void;
  onSpawn?: (pid: number) => void;
  onExit?: (pid: number) => void;
}

export async function spawnJsonl(opts: SpawnJsonlOpts): Promise<{ returncode: number; stderr: string }> {
  const child = Bun.spawn({
    cmd: opts.cmd,
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin !== undefined ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  opts.onSpawn?.(child.pid);
  // Drained concurrently so a chatty stderr cannot wedge the child while stdout is tailed.
  const stderrText = new Response(child.stderr).text();
  if (opts.stdin !== undefined) {
    await child.stdin!.write(opts.stdin);
    child.stdin!.end();
  }

  const emit = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line) return;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (!isDict(event)) return;
    opts.onEvent(event);
  };

  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of child.stdout) {
    appendFileSync(opts.rawOutputPath, chunk);
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      emit(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  if (pending) emit(pending);

  const stderr = await stderrText;
  const code = await child.exited;
  const returncode = child.signalCode ? -(osConstants.signals[child.signalCode] ?? 0) : code;
  opts.onExit?.(child.pid);
  return { returncode, stderr };
}
