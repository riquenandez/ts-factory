import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgv, shapeUsageFile } from "../.claude/skills/sssf/factory/adws/adw_modules/runtimes/copilot.ts";
import type { AgentRequest } from "../.claude/skills/sssf/factory/adws/adw_modules/runtimes/types.ts";
import { dumpInserts, eventsOf, flagAfter, UUID_RE } from "./harness.ts";
import { runAdw } from "./runAdw.ts";

const REPO_COPILOT = join(import.meta.dir, "fixtures/repo_copilot");
const COPILOT = join(import.meta.dir, "fixtures/fake_copilot/copilot.ts");
const JSONL = join(import.meta.dir, "fixtures/fake_copilot/generic_ok.jsonl");
const BAD_JSONL = join(import.meta.dir, "fixtures/fake_copilot/bad_json.jsonl");
const ERROR_JSONL = join(import.meta.dir, "fixtures/fake_copilot/error.jsonl");
const USAGE = join(import.meta.dir, "fixtures/fake_copilot/usage.json");
const TRANSCRIPT = readFileSync(JSONL, "utf8");

const FIRST_ARGV = [
  "-p",
  "<any>",
  "--output-format",
  "json",
  "--no-color",
  "--no-auto-update",
  "--no-ask-user",
  "--no-remote-export",
  "--session-id",
  "<uuid>",
  "--model",
  "gpt-5.4",
  "--effort",
  "medium",
  "--agent",
  "<any>",
  "--allow-all-tools",
  "--available-tools",
  "view,grep,glob,bash,create",
  "--usage-output-file",
  "<any>",
];

function fakeEnv(extra: Record<string, string> = {}): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), "sssf-copilot-home-"));
  return {
    COPILOT_PATH: COPILOT,
    COPILOT_HOME: home,
    FAKE_COPILOT_JSONL: JSONL,
    FAKE_COPILOT_USAGE: USAGE,
    FAKE_COPILOT_AGENT_LOG: join(home, "agent.log"),
    ...extra,
  };
}

describe("copilot via fake_copilot", () => {
  test("scout via fake_copilot", async () => {
    const env = fakeEnv();
    const side = await runAdw(
      {
        name: "scout-fake-copilot",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
    );
    expect(side.exit).toBe(0);
    expect(side.dump).toMatch(/INSERT INTO sessions VALUES\('abcd1234'[^;]*'success'/);

    const agentSessions = dumpInserts(side.dump, "agent_sessions");
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0]).toContain("'copilot'");
    const sessionId = (JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string; coding_agent: string };
    }).scout.session_id;
    expect(sessionId).toMatch(UUID_RE);
    expect(agentSessions[0]).toContain(`'${sessionId}',0,0,`);

    const evs = eventsOf(side.jsonl);
    const toolCalls = evs.filter((e) => e.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("bash: echo hi");
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
    expect(endPayload.usage.total_tokens).toBe(240);
    expect(endPayload.cost).toBe(0);

    expect(side.files["abcd1234/scout/raw_output.jsonl"]).toBe(TRANSCRIPT);
    const map = JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { coding_agent: string };
    };
    expect(map.scout.coding_agent).toBe("copilot");

    const agentLog = readFileSync(env.FAKE_COPILOT_AGENT_LOG!, "utf8");
    expect(agentLog).toContain("# Scout Agent");

    const agentsDir = join(env.COPILOT_HOME!, "agents");
    expect(existsSync(agentsDir) ? readdirSync(agentsDir) : []).toEqual([]);
    expect(
      Object.keys(side.files).some((key) => key.includes("copilot_sessions/") && key.endsWith(".usage.json")),
    ).toBe(false);
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("argv on first call", async () => {
    const env = fakeEnv({ FAKE_COPILOT_EXPECT: JSON.stringify(FIRST_ARGV) });
    const side = await runAdw(
      {
        name: "scout-fake-copilot-argv",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
    );
    expect(side.exit).toBe(0);
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("resume on a joined run", async () => {
    const argvLog = join(mkdtempSync(join(tmpdir(), "sssf-copilot-argv-")), "argv.jsonl");
    const env = fakeEnv({ FAKE_COPILOT_ARGV_LOG: argvLog });
    const first = await runAdw(
      {
        name: "scout-fake-copilot-join-1",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
      { keep: true },
    );
    expect(first.exit).toBe(0);
    const sessionId = (JSON.parse(first.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string };
    }).scout.session_id;
    const second = await runAdw(
      {
        name: "scout-fake-copilot-join-2",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
      { reuseDir: first.dir },
    );
    expect(second.exit).toBe(0);
    const lines = readFileSync(argvLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(lines.length).toBe(2);
    expect(flagAfter(lines[0]!, "--session-id")).toBe(sessionId);
    expect(flagAfter(lines[1]!, "--session-id")).toBe(sessionId);
    expect(lines[0]).not.toContain("--resume");
    expect(lines[1]).not.toContain("--resume");
    rmSync(first.dir, { recursive: true, force: true });
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("JSON retry stays in the session", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sssf-copilot-replay-"));
    const argvLog = join(scratch, "argv.jsonl");
    const replayDir = join(scratch, "replay");
    mkdirSync(replayDir);
    writeFileSync(join(replayDir, "any.1.jsonl"), readFileSync(BAD_JSONL));
    writeFileSync(join(replayDir, "any.2.jsonl"), readFileSync(JSONL));
    const env = fakeEnv({
      FAKE_COPILOT_REPLAY: replayDir,
      FAKE_COPILOT_ARGV_LOG: argvLog,
    });
    delete env.FAKE_COPILOT_JSONL;
    const side = await runAdw(
      {
        name: "scout-fake-copilot-retry",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
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
    const sessionA = flagAfter(lines[0]!, "--session-id");
    const sessionB = flagAfter(lines[1]!, "--session-id");
    expect(sessionA).toBe(sessionB);
    expect(sessionA).toMatch(UUID_RE);
    expect(flagAfter(lines[1]!, "-p")).toContain("not valid JSON");
    rmSync(scratch, { recursive: true, force: true });
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("validation fails before any session when binary is missing", async () => {
    const env = fakeEnv({ COPILOT_PATH: "/nonexistent/copilot" });
    const side = await runAdw(
      {
        name: "scout-copilot-missing-binary",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("copilot binary not runnable");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("validation fails for a pi extension on a copilot agent", async () => {
    const env = fakeEnv();
    const side = await runAdw(
      {
        name: "scout-copilot-pi-extension",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
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
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);

  test("model error surfaces", async () => {
    const env = fakeEnv({
      FAKE_COPILOT_JSONL: ERROR_JSONL,
      FAKE_COPILOT_EXIT: "1",
    });
    const side = await runAdw(
      {
        name: "scout-fake-copilot-error",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_COPILOT,
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("copilot exited 1");
    expect(side.stderr).toContain("synthetic provider failure");
    expect(side.dump).toMatch(/INSERT INTO sessions VALUES\('abcd1234'[^;]*'fail'/);
    expect(dumpInserts(side.dump, "envelopes")).toHaveLength(0);
    rmSync(env.COPILOT_HOME!, { recursive: true, force: true });
  }, 60_000);
});

function copilotRequest(over: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: "hi",
    system_prompt: "sys",
    model: "gpt-5.4",
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

describe("buildArgv", () => {
  const sessionId = "00000000-0000-0000-0000-000000000001";
  const agentName = `sssf-${sessionId}`;
  const usagePath = "/tmp/usage.json";

  test("tools null: no --available-tools, has --allow-all-tools", () => {
    const argv = buildArgv(copilotRequest({ tools: null }), agentName, usagePath);
    expect(argv).toContain("--allow-all-tools");
    expect(argv).not.toContain("--available-tools");
    expect(flagAfter(argv, "--agent")).toBe(agentName);
  });

  test("roster list: mapped, ls dropped, write→create, find→glob", () => {
    const argv = buildArgv(
      copilotRequest({ tools: ["read", "grep", "find", "ls", "bash", "write"] }),
      agentName,
      usagePath,
    );
    expect(flagAfter(argv, "--available-tools")).toBe("view,grep,glob,bash,create");
    expect(argv).toContain("--allow-all-tools");
  });

  test("empty list: --available-tools none", () => {
    const argv = buildArgv(copilotRequest({ tools: [] }), agentName, usagePath);
    expect(flagAfter(argv, "--available-tools")).toBe("none");
    expect(argv).toContain("--allow-all-tools");
  });

  test("thinking off maps to --effort none", () => {
    const argv = buildArgv(copilotRequest({ thinking: "off" }), agentName, usagePath);
    expect(flagAfter(argv, "--effort")).toBe("none");
  });

  test("one extension: --additional-mcp-config @path", () => {
    const argv = buildArgv(copilotRequest({ extensions: ["adws/x.json"] }), agentName, usagePath);
    expect(flagAfter(argv, "--additional-mcp-config")).toBe("@adws/x.json");
  });

  test("agent name equals sssf-<session_id>", () => {
    const argv = buildArgv(copilotRequest(), agentName, usagePath);
    expect(flagAfter(argv, "--agent")).toBe(`sssf-${sessionId}`);
  });
});

describe("shapeUsageFile", () => {
  test("totalTokens is the four components; reasoning sits inside output", () => {
    const { shaped, totalTokens } = shapeUsageFile({
      modelMetrics: {
        "gpt-5.4": {
          requests: { count: 1, cost: 0 },
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            cacheReadTokens: 5,
            cacheWriteTokens: 5,
            reasoningTokens: 7,
          },
        },
      },
    });
    expect(totalTokens).toBe(40);
    expect(shaped.reasoning).toBe(7);
    expect(shaped.output).toBe(20);
  });
});
