import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PATHSEP = ":";

function utf8(bytes?: Uint8Array | null): string {
  return Buffer.from(bytes ?? []).toString("utf8");
}

export function newId(length = 8): string {
  const bytes = Math.floor(length / 2);
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function nowIso(): string {
  return new Date().toISOString().replace("Z", "+00:00");
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

export function resolvePrompt(arg: string): string {
  try {
    if (existsSync(arg) && statSync(arg).isFile()) return readFileSync(arg, "utf8");
  } catch {
    /* OSError → inline */
  }
  return arg;
}

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

export function engineerName(): string {
  const fromEnv = (process.env.ENGINEER_NAME ?? "").trim();
  if (fromEnv) return fromEnv;
  try {
    const out = Bun.spawnSync(["git", "config", "user.name"], { stdout: "pipe", stderr: "pipe" });
    const name = utf8(out.stdout).trim();
    if (out.exitCode === 0 && name) return name;
  } catch {
    /* git missing */
  }
  return process.env.USER ?? "engineer";
}

const cleanups: Array<() => void> = [];

export function registerCleanup(fn: () => void): () => void {
  cleanups.push(fn);
  return () => {
    const i = cleanups.lastIndexOf(fn);
    if (i !== -1) cleanups.splice(i, 1);
  };
}

export function runCleanups(): void {
  const pending = cleanups.splice(0).reverse();
  for (const fn of pending) {
    try {
      fn();
    } catch {
      /* a throwing hook must not stop the others */
    }
  }
}

export class RuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValueError";
  }
}
