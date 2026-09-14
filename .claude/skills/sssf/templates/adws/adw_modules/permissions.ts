import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnCaptured } from "./compat/shell.ts";
import { pySorted, pyStr } from "./compat/format.ts";
import type { AgentConfig, SSSFConfig } from "./data_types.ts";
import type { Run } from "./runner.ts";

export class PermissionBreach extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermissionBreach";
  }
}

function _git(args: string[], cwd: string): string {
  const result = spawnCaptured(["git", ...args], { cwd });
  return result.returncode === 0 ? result.stdout : "";
}

export function snapshot(run: Run): Map<string, string> {
  const fingerprints = new Map<string, string>();
  for (const line of _git(["diff", "HEAD", "--numstat"], run.repoRoot).split("\n")) {
    const fields = line.split("\t");
    if (fields.length >= 3) {
      const path = fields[fields.length - 1]!.trim();
      fingerprints.set(path, `${fields[0]},${fields[1]}`);
    }
  }
  for (const path of _git(["ls-files", "--others", "--exclude-standard"], run.repoRoot).split("\n")) {
    if (path.trim()) {
      fingerprints.set(path.trim(), "untracked");
    }
  }
  return fingerprints;
}

export function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return pySorted([...keys].filter((p) => before.get(p) !== after.get(p)));
}

function _re_escape(char: string): string {
  const named: Record<string, string> = {
    "\t": "\\t",
    "\n": "\\n",
    "\v": "\\v",
    "\f": "\\f",
    "\r": "\\r",
  };
  if (char in named) return named[char]!;
  if (" #$&()*+-.?[\\]^{|}~".includes(char)) return `\\${char}`;
  return char;
}

function _glob(pattern: string): RegExp {
  const out: string[] = [];
  const chars = [...pattern];
  let i = 0;
  while (i < chars.length) {
    const char = chars[i]!;
    if (char === "*" && chars[i + 1] === "*") {
      out.push(".*");
      i += 2;
    } else if (char === "*") {
      out.push("[^/]*");
      i += 1;
    } else if (char === "?") {
      out.push("[^/]");
      i += 1;
    } else {
      out.push(_re_escape(char));
      i += 1;
    }
  }
  return new RegExp(`^${out.join("")}$`);
}

function _matches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/")) {
    return path.startsWith(pattern);
  }
  if (pattern.includes("*") || pattern.includes("?")) {
    return _glob(pattern).exec(path) !== null;
  }
  return path === pattern;
}

export function alwaysWritable(cfg: SSSFConfig): string[] {
  return [cfg.defaults.data_dir.replace(/\/+$/, "") + "/"];
}

export function permitted(path: string, agent: AgentConfig, cfg: SSSFConfig): boolean {
  if (alwaysWritable(cfg).some((p) => _matches(path, p))) {
    return true;
  }
  if ((agent.writes ?? []).some((p) => _matches(path, p))) {
    return true;
  }
  if (cfg.defaults.protected_files.some((p) => _matches(path, p))) {
    return false;
  }
  return agent.writes === null;
}

function _roll_back(
  run: Run,
  path: string,
  before: Map<string, string>,
  after: Map<string, string>,
): string {
  if (before.has(path)) {
    return !after.has(path)
      ? "REVERTED-BY-AGENT (uncommitted work lost, cannot restore)"
      : "left as-is (was already modified)";
  }
  if (after.get(path) === "untracked") {
    try {
      unlinkSync(join(run.repoRoot, path));
      return "deleted";
    } catch (error) {
      return `could not delete (${error})`;
    }
  }
  const result = spawnCaptured(["git", "checkout", "--", path], { cwd: run.repoRoot });
  return result.returncode === 0 ? "rolled back" : "could not roll back";
}

export function enforce(run: Run, _phase: unknown, agent: AgentConfig, before: Map<string, string>): string[] {
  const after = snapshot(run);
  const touched = changedPaths(before, after);
  const breaches = touched.filter((p) => !permitted(p, agent, run.cfg));
  if (!breaches.length) {
    return touched;
  }

  const outcomes = new Map<string, string>();
  for (const p of breaches) {
    outcomes.set(p, _roll_back(run, p, before, after));
  }
  const scope =
    agent.writes !== null && agent.writes.length === 0
      ? "read-only"
      : agent.writes
        ? `limited to ${pyStr(agent.writes)}`
        : `barred from ${pyStr(run.cfg.defaults.protected_files)}`;
  const detail = [...outcomes.entries()].map(([p, outcome]) => `  - ${p} — ${outcome}`).join("\n");
  throw new PermissionBreach(
    `${agent.name} is ${scope} but modified ${breaches.length} path(s):\n${detail}`,
  );
}
