import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { INTERFACES } from "../../templates/adws/adw_modules/agents.ts";
import { labelFor } from "../../templates/adws/adw_modules/toolCalls.ts";
import { runSide } from "./runBoth.ts";

const REPO_CLAUDE = join(import.meta.dir, "fixtures/repo_claude");
const REPO_AGENT = join(import.meta.dir, "fixtures/repo_agent");
const MODULES = join(import.meta.dir, "../../templates/adws/adw_modules");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SESSION_DIRS: Record<string, string> = {
  pi: "pi_sessions",
  claude_code: "claude_sessions",
  copilot: "copilot_sessions",
  exec: "exec_sessions",
};

function dumpInserts(dump: string, table: string): string[] {
  const prefix = `INSERT INTO ${table} `;
  return dump.split("\n").filter((line) => line.startsWith(prefix));
}

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
    const side = await runSide(
      "port",
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
    const side = await runSide(
      "port",
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

  test("runtime files are self-contained", () => {
    for (const name of ["agentPi.ts", "agentCc.ts", "agentCopilot.ts", "agentExec.ts"]) {
      const text = readFileSync(join(MODULES, name), "utf8");
      expect(text).toContain("export const INTERFACE");
      expect(text).not.toContain('from "./agents.ts"');
      expect(text).not.toContain('from "./runner.ts"');
    }
    for (const name of ["agentCc.ts", "agentCopilot.ts", "agentExec.ts"]) {
      const text = readFileSync(join(MODULES, name), "utf8");
      expect(text).not.toContain('from "./agentPi.ts"');
    }
  });

  test("compat imports nothing outside compat", () => {
    const dir = join(MODULES, "compat");
    const names = readdirSync(dir).filter((name) => name.endsWith(".ts"));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const text = readFileSync(join(dir, name), "utf8");
      expect(text).not.toContain('from "../');
    }
  });

  test("pi labels unchanged", () => {
    expect(labelFor("bash", { command: "ls -la src" })).toBe("bash: ls -la src");
    const command = "x".repeat(200);
    expect(labelFor("bash", { command })).toBe(`bash: ${"x".repeat(80)}…`);
  });
});
