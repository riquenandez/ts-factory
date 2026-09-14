import { mkdtempSync, readFileSync, rmSync, cpSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diff_sides, type Side } from "./compare.ts";

function utf8(bytes?: Uint8Array | null): string {
  return Buffer.from(bytes ?? []).toString("utf8");
}

const SKILL = join(import.meta.dir, "../..");
const GOLD_ADWS = join(import.meta.dir, "python-gold/adws");
const TS_ADWS = join(SKILL, "templates/adws");

export interface Case {
  name: string;
  script: string;
  args: string[];
  env?: Record<string, string>;
}

function collect_files(dir: string, prefix = ""): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(out, collect_files(path, rel));
    else out[rel] = readFileSync(path, "utf8");
  }
  return out;
}

async function run_cmd(cmd: string[], cwd: string, env: Record<string, string>): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, ...env, TERM: "dumb" }, stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exit = await proc.exited;
  return { exit, stdout, stderr };
}

function sqlite_dump(db: string): string {
  const out = Bun.spawnSync(["sqlite3", db, ".dump"], { stdout: "pipe", stderr: "pipe" });
  return utf8(out.stdout);
}

function git_commit(dir: string, message: string): void {
  Bun.spawnSync(["git", "add", "-A"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  Bun.spawnSync(
    ["git", "-c", "user.email=parity@sssf.test", "-c", "user.name=parity", "commit", "-q", "-m", message],
    { cwd: dir, stdout: "pipe", stderr: "pipe" },
  );
}

// Fixtures are plain tracked files, not nested repos: each side gets its own
// fresh git history so both gold and port see the same porcelain.
function init_repo(dir: string): void {
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
  git_commit(dir, "fixture");
}

function stamp_commit(dir: string): void {
  git_commit(dir, "stamp adws");
}

export async function run_side(kind: "gold" | "port", c: Case, fixture: string): Promise<Side> {
  const dir = mkdtempSync(join(tmpdir(), `sssf-${kind}-`));
  cpSync(fixture, dir, { recursive: true });
  init_repo(dir);
  const src = kind === "gold" ? GOLD_ADWS : TS_ADWS;
  const dest = join(dir, "adws");
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true });
  for (const rel of ["adws/adw_sssf_config", "adws/adw_data"]) {
    const keep = join(fixture, rel);
    if (existsSync(keep)) cpSync(keep, join(dir, rel), { recursive: true });
  }
  stamp_commit(dir);
  const cmd = kind === "gold"
    ? ["uv", "run", join(dest, c.script.replace(/\.ts$/, ".py")), ...c.args]
    : ["bun", join(dest, c.script), ...c.args];
  const env = {
    ENGINEER_NAME: "enrique",
    PYTHONDONTWRITEBYTECODE: "1",
    ...(c.env ?? {}),
  };
  const result = await run_cmd(cmd, dir, env);
  const db = join(dir, "adws/adw_data/sssf.db");
  const sessions = join(dir, "adws/adw_data/sessions");
  const dump = existsSync(db) ? sqlite_dump(db) : "";
  const files = collect_files(sessions);
  const jsonl = Object.entries(files)
    .filter(([k]) => k.endsWith("events.jsonl"))
    .sort()
    .map(([, v]) => v)
    .join("");
  const porcelain = utf8(
    Bun.spawnSync(["git", "status", "--porcelain"], { cwd: dir, stdout: "pipe" }).stdout,
  );
  const side: Side = { ...result, dump, jsonl, files, porcelain };
  rmSync(dir, { recursive: true, force: true });
  return side;
}

export async function run_both(c: Case, fixture: string): Promise<string[]> {
  const gold = await run_side("gold", c, fixture);
  const port = await run_side("port", c, fixture);
  return diff_sides(gold, port);
}
