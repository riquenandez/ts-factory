import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SKILL = join(import.meta.dir, "../../.claude/skills/sssf");

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function eventsOf(jsonl: string): Array<Record<string, unknown>> {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function dumpInserts(dump: string, table: string): string[] {
  const prefix = `INSERT INTO ${table} `;
  return dump.split("\n").filter((line) => line.startsWith(prefix));
}

export function flagAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

export async function oracle(args: string[]): Promise<string> {
  const proc = Bun.spawn(["uv", "run", `${import.meta.dir}/oracle.py`, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (code !== 0) throw new Error(`oracle ${args[0]} exited ${code}: ${stderr}`);
  return stdout;
}

const EXEC_AGENT = join(import.meta.dir, "fixtures/fake_exec/agent.ts");

export function stampAdapter(dir: string): void {
  const path = join(dir, "adws/adw_sssf_config/sssf.config.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("PLACEHOLDER", EXEC_AGENT));
}
