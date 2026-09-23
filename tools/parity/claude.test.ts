import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgv } from "../../.claude/skills/sssf/templates/adws/adw_modules/agentCc.ts";
import type { AgentRequest } from "../../.claude/skills/sssf/templates/adws/adw_modules/dataTypes.ts";
import { runSide } from "./runBoth.ts";

const REPO_CLAUDE = join(import.meta.dir, "fixtures/repo_claude");
const CLAUDE = join(import.meta.dir, "fixtures/fake_claude/claude.ts");
const JSONL = join(import.meta.dir, "fixtures/fake_claude/generic_ok.jsonl");
const BAD_JSONL = join(import.meta.dir, "fixtures/fake_claude/bad_json.jsonl");
const TRANSCRIPT = readFileSync(JSONL, "utf8");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const FIRST_ARGV = [
  "-p",
  "--output-format",
  "stream-json",
  "--verbose",
  "--session-id",
  "<uuid>",
  "--model",
  "sonnet",
  "--effort",
  "medium",
  "--system-prompt",
  "<any>",
  "--tools",
  "Read,Grep,Glob,Bash,Write",
  "--allowedTools",
  "Read,Grep,Glob,Bash,Write",
  "--permission-mode",
  "dontAsk",
  "--strict-mcp-config",
  "<any>",
];

function fakeEnv(extra: Record<string, string> = {}): Record<string, string> {
  return { CLAUDE_CODE_PATH: CLAUDE, FAKE_CLAUDE_JSONL: JSONL, ...extra };
}

function eventsOf(jsonl: string): Array<Record<string, unknown>> {
  return jsonl
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function dumpInserts(dump: string, table: string): string[] {
  const prefix = `INSERT INTO ${table} `;
  return dump.split("\n").filter((line) => line.startsWith(prefix));
}

describe("claude_code via fake_claude", () => {
  test("scout via fake_claude", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-fake-claude",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv(),
      },
      REPO_CLAUDE,
    );
    expect(side.exit).toBe(0);
    expect(side.dump).toMatch(/INSERT INTO sessions VALUES\('abcd1234'[^;]*'success'/);

    const agentSessions = dumpInserts(side.dump, "agent_sessions");
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0]).toContain("'claude_code'");
    expect(agentSessions[0]).toContain("200000");
    const sessionId = (JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string; coding_agent: string };
    }).scout.session_id;
    expect(sessionId).toMatch(UUID_RE);
    expect(agentSessions[0]).toContain(`'${sessionId}'`);

    const evs = eventsOf(side.jsonl);
    const toolCalls = evs.filter((e) => e.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("Bash: ls -la");
    const payload = toolCalls[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["agent", "args", "duration_ms", "ok", "result_snippet", "tool", "tool_call_id"].sort(),
    );

    const envelopes = dumpInserts(side.dump, "envelopes");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatch(/,1,1,'[^']*'\);\s*$/);

    const agentEnd = evs.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
    const endPayload = agentEnd!.payload as { cost: number; usage: { total_tokens: number } };
    expect(endPayload.usage.total_tokens).toBe(35);
    expect(endPayload.cost).toBe(0.001);

    expect(side.files["abcd1234/scout/raw_output.jsonl"]).toBe(TRANSCRIPT);
    const map = JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { coding_agent: string };
    };
    expect(map.scout.coding_agent).toBe("claude_code");
    expect(
      Object.keys(side.files).some((key) =>
        /^abcd1234\/scout\/claude_sessions\/[0-9a-f-]{36}\.created$/.test(key),
      ),
    ).toBe(true);
  }, 60_000);

  test("argv on first call", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-fake-claude-argv",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv({ FAKE_CLAUDE_EXPECT: JSON.stringify(FIRST_ARGV) }),
      },
      REPO_CLAUDE,
    );
    expect(side.exit).toBe(0);
  }, 60_000);

  test("resume on a joined run", async () => {
    const argvLog = join(mkdtempSync(join(tmpdir(), "sssf-claude-argv-")), "argv.jsonl");
    const env = fakeEnv({ FAKE_CLAUDE_ARGV_LOG: argvLog });
    const first = await runSide(
      "port",
      {
        name: "scout-fake-claude-join-1",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_CLAUDE,
      { keep: true },
    );
    expect(first.exit).toBe(0);
    const sessionId = (JSON.parse(first.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string };
    }).scout.session_id;
    const second = await runSide(
      "port",
      {
        name: "scout-fake-claude-join-2",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_CLAUDE,
      { reuseDir: first.dir },
    );
    expect(second.exit).toBe(0);
    const lines = readFileSync(argvLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("--session-id");
    expect(lines[0]).toContain(sessionId);
    expect(lines[0]).not.toContain("--resume");
    expect(lines[1]).toContain("--resume");
    expect(lines[1]).toContain(sessionId);
    expect(lines[1]).not.toContain("--session-id");
    rmSync(first.dir, { recursive: true, force: true });
  }, 60_000);

  test("JSON retry resumes the session", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sssf-claude-replay-"));
    const argvLog = join(scratch, "argv.jsonl");
    const replayDir = join(scratch, "replay");
    mkdirSync(replayDir);
    writeFileSync(join(replayDir, "any.1.jsonl"), readFileSync(BAD_JSONL));
    writeFileSync(join(replayDir, "any.2.jsonl"), readFileSync(JSONL));
    const side = await runSide(
      "port",
      {
        name: "scout-fake-claude-retry",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: {
          CLAUDE_CODE_PATH: CLAUDE,
          FAKE_CLAUDE_REPLAY: replayDir,
          FAKE_CLAUDE_ARGV_LOG: argvLog,
        },
      },
      REPO_CLAUDE,
    );
    expect(side.exit).toBe(0);
    const envRows = dumpInserts(side.dump, "envelopes");
    expect(envRows).toHaveLength(2);
    expect(envRows.some((row) => /,0,\d+,'[^']*'\);\s*$/.test(row))).toBe(true);
    expect(envRows.some((row) => /,1,\d+,'[^']*'\);\s*$/.test(row))).toBe(true);

    const lines = readFileSync(argvLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("--session-id");
    expect(lines[0]).not.toContain("--resume");
    expect(lines[1]).toContain("--resume");
    expect(lines[1]).not.toContain("--session-id");
    const prompt = lines[1]![lines[1]!.length - 1]!;
    expect(prompt).toContain("not valid JSON");
    rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  test("validation fails before any session when binary is missing", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-claude-missing-binary",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: { CLAUDE_CODE_PATH: "/nonexistent/claude" },
      },
      REPO_CLAUDE,
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("claude_code binary not runnable");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);

  test("validation fails for a pi extension on a claude_code agent", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-claude-pi-extension",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv(),
      },
      REPO_CLAUDE,
      {
        prepare(dir) {
          const path = join(dir, "adws/adw_sssf_config/sssf.config.yaml");
          const yaml = readFileSync(path, "utf8");
          writeFileSync(
            path,
            yaml.replace(
              "harness_engineering: []",
              "harness_engineering:\n      - adws/adw_data/harness_engineering/subagents.ts",
            ),
          );
        },
      },
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("is a pi extension");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);
});

function ccRequest(over: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: "hi",
    system_prompt: "sys",
    model: "sonnet",
    thinking: "medium",
    session_id: "00000000-0000-0000-0000-000000000001",
    session_dir: "/tmp",
    raw_output_path: "/tmp/out.jsonl",
    tools: null,
    extensions: [],
    cwd: "/tmp",
    ...over,
  };
}

function flagAfter(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
}

describe("buildArgv", () => {
  test("tools null: dangerously-skip-permissions, no --tools", () => {
    const argv = buildArgv(ccRequest({ tools: null }), true);
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(argv).not.toContain("--tools");
    expect(argv).not.toContain("--allowedTools");
    expect(argv).toContain("--strict-mcp-config");
  });

  test("roster list: --tools and --allowedTools, ls dropped, find→Glob", () => {
    const argv = buildArgv(
      ccRequest({ tools: ["read", "grep", "find", "ls", "bash", "write"] }),
      true,
    );
    expect(flagAfter(argv, "--tools")).toBe("Read,Grep,Glob,Bash,Write");
    expect(flagAfter(argv, "--allowedTools")).toBe("Read,Grep,Glob,Bash,Write");
    expect(argv.indexOf("--tools")).toBeLessThan(argv.indexOf("--allowedTools"));
    expect(argv.indexOf("--allowedTools")).toBeLessThan(argv.indexOf("--permission-mode"));
    expect(argv).toContain("--strict-mcp-config");
  });

  test("empty list: --tools empty, no --allowedTools", () => {
    const argv = buildArgv(ccRequest({ tools: [] }), true);
    expect(flagAfter(argv, "--tools")).toBe("");
    expect(argv).not.toContain("--allowedTools");
    expect(argv).toContain("--permission-mode");
    expect(argv).toContain("--strict-mcp-config");
  });

  test("MCP tool is in --allowedTools only", () => {
    const argv = buildArgv(ccRequest({ tools: ["read", "mcp__jira__search"] }), true);
    expect(flagAfter(argv, "--tools")).toBe("Read");
    expect(flagAfter(argv, "--allowedTools")).toBe("Read,mcp__jira__search");
    expect(argv).toContain("--strict-mcp-config");
  });
});

