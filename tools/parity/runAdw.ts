import { expect } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SKILL } from "./harness.ts";
import { normalizeText } from "./normalize.ts";

function utf8(bytes?: Uint8Array | null): string {
  return Buffer.from(bytes ?? []).toString("utf8");
}

const TS_ADWS = join(SKILL, "factory/adws");

export interface Case {
  name: string;
  script: string;
  args: string[];
  env?: Record<string, string>;
}

export interface AdwRun {
  exit: number;
  stdout: string;
  stderr: string;
  dump: string;
  jsonl: string;
  files: Record<string, string>;
  porcelain: string;
  dir: string;
}

export interface RunAdwOpts {
  /** Keep the work dir and return it as `dir`. Caller deletes it. */
  keep?: boolean;
  /** Reuse an already-stamped dir: skip copy/init/stamp, do not delete. */
  reuseDir?: string;
  /** Mutate the stamped dir after copy, before the command. Ignored with reuseDir. */
  prepare?: (dir: string) => void;
}

function collectFiles(dir: string, prefix = ""): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, collectFiles(path, rel));
    else out[rel] = readFileSync(path, "utf8");
  }
  return out;
}

async function runCmd(
  cmd: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...env, TERM: "dumb" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

function sqliteDump(db: string): string {
  const out = Bun.spawnSync(["sqlite3", db, ".dump"], { stdout: "pipe", stderr: "pipe" });
  return utf8(out.stdout);
}

function gitCommit(dir: string, message: string): void {
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(
    ["git", "-c", "user.email=parity@sssf.test", "-c", "user.name=parity", "commit", "-q", "-m", message],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
}

// Fixtures are plain tracked files, not nested repos. Each run gets a fresh
// git history so porcelain starts from the same commit.
function initRepo(dir: string): void {
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  gitCommit(dir, "fixture");
}

function stampCommit(dir: string): void {
  gitCommit(dir, "stamp adws");
}

export function stampAdw(fixture: string, opts?: RunAdwOpts): string {
  if (opts?.reuseDir) return opts.reuseDir;
  const dir = mkdtempSync(join(tmpdir(), "sssf-port-"));
  try {
    cpSync(fixture, dir, { recursive: true });
    initRepo(dir);
    const dest = join(dir, "adws");
    rmSync(dest, { recursive: true, force: true });
    cpSync(TS_ADWS, dest, { recursive: true });
    for (const rel of ["adws/adw_sssf_config", "adws/adw_data"]) {
      const keep = join(fixture, rel);
      if (existsSync(keep)) cpSync(keep, join(dir, rel), { recursive: true });
    }
    stampCommit(dir);
    opts?.prepare?.(dir);
    return dir;
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

export async function runAdw(c: Case, fixture: string, opts?: RunAdwOpts): Promise<AdwRun> {
  const dir = stampAdw(fixture, opts);
  try {
    const dest = join(dir, "adws");
    // bun swallows a leading "--" in script args unless one "--" precedes them.
    const cmd = ["bun", join(dest, c.script), "--", ...c.args];
    const env = {
      ENGINEER_NAME: "enrique",
      ...(c.env ?? {}),
    };
    const result = await runCmd(cmd, dir, env);
    const db = join(dir, "adws/adw_data/sssf.db");
    const sessions = join(dir, "adws/adw_data/sessions");
    const dump = existsSync(db) ? sqliteDump(db) : "";
    const files = collectFiles(sessions);
    const jsonl = Object.entries(files)
      .filter(([k]) => k.endsWith("events.jsonl"))
      .sort()
      .map(([, v]) => v)
      .join("");
    const porcelain = utf8(
      Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir, stdout: "pipe" }).stdout,
    );
    return { ...result, dump, jsonl, files, porcelain, dir };
  } finally {
    if (!opts?.keep && !opts?.reuseDir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Every session file as `=== <path> ===\n<content>\n`, sorted by path. */
export function joinSessionFiles(files: Record<string, string>): string {
  return Object.keys(files)
    .sort()
    .map((path) => `=== ${path} ===\n${files[path]}\n`)
    .join("");
}

export async function snapshotAdw(c: Case, fixture: string, opts?: RunAdwOpts): Promise<void> {
  const side = await runAdw(c, fixture, opts);
  const norm = normalizeText;
  expect(norm(side.stdout)).toMatchSnapshot("stdout");
  expect(`exit ${side.exit}\n${norm(side.stderr)}`).toMatchSnapshot("exit+stderr");
  expect(norm(side.dump)).toMatchSnapshot("sqlite");
  expect(norm(side.jsonl)).toMatchSnapshot("events.jsonl");
  expect(norm(joinSessionFiles(side.files))).toMatchSnapshot("session files");
  expect(side.porcelain).toMatchSnapshot("git status");
}
