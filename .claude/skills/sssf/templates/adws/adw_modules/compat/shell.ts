import { operatorEnv } from "../utils.ts";

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
