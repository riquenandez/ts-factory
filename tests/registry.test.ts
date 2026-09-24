import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INTERFACES } from "../.claude/skills/sssf/factory/adws/adw_modules/runtimes/index.ts";
import { labelFor } from "../.claude/skills/sssf/factory/adws/adw_modules/runtimes/toolCalls.ts";
import { dumpInserts, UUID_RE } from "./harness.ts";
import { runAdw } from "./runAdw.ts";

const REPO_CLAUDE = join(import.meta.dir, "fixtures/repo_claude");
const REPO_AGENT = join(import.meta.dir, "fixtures/repo_agent");
const MODULES = join(import.meta.dir, "../.claude/skills/sssf/factory/adws/adw_modules");

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(path));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}
const SESSION_DIRS: Record<string, string> = {
  pi: "pi_sessions",
  claude_code: "claude_sessions",
  copilot: "copilot_sessions",
  exec: "exec_sessions",
};

describe("agent registry", () => {
  test("registry shape", () => {
    expect(Object.keys(INTERFACES)).toEqual(["pi", "claude_code", "copilot", "exec"]);
    for (const [key, iface] of Object.entries(INTERFACES)) {
      expect(typeof iface.run).toBe("function");
      expect(typeof iface.newTracker).toBe("function");
      expect(typeof iface.mintSessionId).toBe("function");
      expect(typeof iface.validate).toBe("function");
      expect(iface.sessionDirName).toBe(SESSION_DIRS[key]);
      expect(iface.newTracker().observe({})).toBeNull();
    }
  });

  test("mintSessionId", () => {
    const pi = INTERFACES.pi!.mintSessionId("abcd1234", "scout");
    expect(pi).toMatch(/^sssf-abcd1234-scout-[0-9a-f]{4}$/);
    expect(INTERFACES.pi!.mintSessionId("abcd1234", "scout")).not.toBe(pi);

    const claudeA = INTERFACES.claude_code!.mintSessionId("abcd1234", "scout");
    const claudeB = INTERFACES.claude_code!.mintSessionId("abcd1234", "scout");
    expect(claudeA).toMatch(UUID_RE);
    expect(claudeB).toMatch(UUID_RE);
    expect(claudeA).not.toBe(claudeB);

    const copilotA = INTERFACES.copilot!.mintSessionId("abcd1234", "scout");
    const copilotB = INTERFACES.copilot!.mintSessionId("abcd1234", "scout");
    expect(copilotA).toMatch(UUID_RE);
    expect(copilotB).toMatch(UUID_RE);
    expect(copilotA).not.toBe(copilotB);

    const execA = INTERFACES.exec!.mintSessionId("abcd1234", "scout");
    const execB = INTERFACES.exec!.mintSessionId("abcd1234", "scout");
    expect(execA).toMatch(UUID_RE);
    expect(execB).toMatch(UUID_RE);
    expect(execA).not.toBe(execB);
  });

  test("unknown coding_agent fails validation before any session", async () => {
    const side = await runAdw(
      {
        name: "unknown-coding-agent",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: {
          PI_PATH: "/nonexistent/pi",
          CLAUDE_CODE_PATH: "/nonexistent/claude",
          COPILOT_PATH: "/nonexistent/copilot",
        },
      },
      REPO_CLAUDE,
      {
        prepare(dir) {
          const path = join(dir, "adws/adw_sssf_config/sssf.config.yaml");
          writeFileSync(
            path,
            readFileSync(path, "utf8").replaceAll("coding_agent: claude_code", "coding_agent: bogus"),
          );
        },
      },
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("unknown coding_agent 'bogus'");
    expect(side.stderr).toContain("known: pi, claude_code, copilot, exec");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);

  test("missing pi binary fails validation before any session", async () => {
    const side = await runAdw(
      {
        name: "missing-pi",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: { PI_PATH: "/nonexistent/pi" },
      },
      REPO_AGENT,
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("pi binary not runnable: /nonexistent/pi");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);

  test("ph.call is typed only on agent phases", () => {
    const text = readFileSync(join(MODULES, "runner.ts"), "utf8");
    const handle = text.slice(
      text.indexOf("export class PhaseHandle"),
      text.indexOf("export class AgentPhaseHandle"),
    );
    expect(handle).not.toMatch(/^\s+(override\s+)?call</m);
    expect(text).toMatch(
      /phase<T>\(params: PhaseParams & \{ kind: "agent" \}, body: \(ph: AgentPhaseHandle\) => T \| Promise<T>\): Promise<T>;/,
    );
    expect(text).toMatch(
      /phase<T>\(params: PhaseParams & \{ kind: "engineer" \| "code" \}, body: \(ph: PhaseHandle\) => T \| Promise<T>\): Promise<T>;/,
    );
  });

  test("a runtime file imports only types, toolCalls, shell, and utils", () => {
    const allowed = new Set(["./types.ts", "./toolCalls.ts", "../shell.ts", "../utils.ts"]);
    for (const name of ["pi.ts", "claude.ts", "copilot.ts", "exec.ts"]) {
      const text = readFileSync(join(MODULES, "runtimes", name), "utf8");
      expect(text).toContain("export const INTERFACE");
      const specs = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) {
        const builtin = spec.startsWith("node:") || spec.startsWith("bun:");
        expect(builtin || allowed.has(spec), `${name} imports ${spec}`).toBe(true);
      }
    }
  });

  test("runtimes/index.ts is the only file that imports a runtime", () => {
    const runtimeImport = /from "(?:(?:\.\.\/)+|\.\/)(?:runtimes\/)?(?:pi|claude|copilot|exec)\.ts"/;
    const files = tsFiles(MODULES).filter((path) => !path.endsWith("/runtimes/index.ts"));
    for (const path of files) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(runtimeImport);
    }
  });

  test("utils, shell, and schema import only Node and Bun builtins", () => {
    for (const name of ["utils.ts", "shell.ts", "schema.ts"]) {
      const text = readFileSync(join(MODULES, name), "utf8");
      const specs = [...text.matchAll(/from "([^"]+)"/g)].map((match) => match[1]!);
      for (const spec of specs) {
        expect(spec.startsWith("node:") || spec.startsWith("bun:"), `${name} imports ${spec}`).toBe(true);
      }
    }
  });

  test("pi labels unchanged", () => {
    expect(labelFor("bash", { command: "ls -la src" })).toBe("bash: ls -la src");
    const command = "x".repeat(200);
    expect(labelFor("bash", { command })).toBe(`bash: ${"x".repeat(80)}…`);
  });
});
