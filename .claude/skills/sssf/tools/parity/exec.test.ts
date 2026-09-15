import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRequest, ExecToolCallTracker, resolveCommand } from "../../templates/adws/adw_modules/agentExec.ts";
import type { AgentRequest } from "../../templates/adws/adw_modules/dataTypes.ts";
import { runSide } from "./runBoth.ts";

const REPO_EXEC = join(import.meta.dir, "fixtures/repo_exec");
const EXEC_AGENT = join(import.meta.dir, "fixtures/fake_exec/agent.ts");
const JSONL = join(import.meta.dir, "fixtures/fake_exec/generic_ok.jsonl");
const BAD_JSONL = join(import.meta.dir, "fixtures/fake_exec/bad_json.jsonl");
const ERROR_JSONL = join(import.meta.dir, "fixtures/fake_exec/error.jsonl");
const TRANSCRIPT = readFileSync(JSONL, "utf8");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REQUEST_KEYS = [
  "protocol",
  "prompt",
  "system_prompt",
  "model",
  "thinking",
  "session_id",
  "session_dir",
  "tools",
  "extensions",
  "cwd",
];

function stampAdapter(dir: string): void {
  const path = join(dir, "adws/adw_sssf_config/sssf.config.yaml");
  writeFileSync(path, readFileSync(path, "utf8").replaceAll("PLACEHOLDER", EXEC_AGENT));
}

function stampEmptyCommand(dir: string): void {
  const path = join(dir, "adws/adw_sssf_config/sssf.config.yaml");
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace(/\n {4}command:\n {6}- bun\n {6}- PLACEHOLDER\n/, "\n    command: []\n"),
  );
}

function fakeEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    FAKE_EXEC_JSONL: JSONL,
    ...extra,
  };
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

function readRequestLog(path: string): Array<Record<string, unknown>> {
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("exec via fake_exec", () => {
  test("scout via fake_exec", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sssf-exec-"));
    const requestLog = join(scratch, "request.jsonl");
    const side = await runSide(
      "port",
      {
        name: "scout-fake-exec",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv({ FAKE_EXEC_REQUEST_LOG: requestLog }),
      },
      REPO_EXEC,
      { prepare: stampAdapter },
    );
    expect(side.exit).toBe(0);
    expect(side.dump).toMatch(/INSERT INTO sessions VALUES\('abcd1234'[^;]*'success'/);

    const agentSessions = dumpInserts(side.dump, "agent_sessions");
    expect(agentSessions).toHaveLength(1);
    expect(agentSessions[0]).toContain("'exec'");
    const sessionId = (JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string; coding_agent: string };
    }).scout.session_id;
    expect(sessionId).toMatch(UUID_RE);
    expect(agentSessions[0]).toContain(`'${sessionId}',1200,200000,`);

    const evs = eventsOf(side.jsonl);
    const toolCalls = evs.filter((e) => e.type === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0]!.name).toBe("bash: echo hi");
    const payload = toolCalls[0]!.payload as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(
      ["agent", "args", "ok", "result_snippet", "tool", "tool_call_id"].sort(),
    );

    const envelopes = dumpInserts(side.dump, "envelopes");
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]).toMatch(/,1,1,'[^']*'\);\s*$/);

    const agentEnd = evs.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
    const endPayload = agentEnd!.payload as { cost: number; usage: { total_tokens: number } };
    expect(endPayload.usage.total_tokens).toBe(240);
    expect(endPayload.cost).toBe(0.0125);

    expect(side.files["abcd1234/scout/raw_output.jsonl"]).toBe(TRANSCRIPT);
    const map = JSON.parse(side.files["abcd1234/agent_map.json"]!) as {
      scout: { coding_agent: string };
    };
    expect(map.scout.coding_agent).toBe("exec");

    const logged = readRequestLog(requestLog);
    expect(logged).toHaveLength(1);
    const req = logged[0]!;
    expect(req.protocol).toBe("sssf-exec/1");
    expect(String(req.prompt)).toContain("summarize");
    expect(String(req.system_prompt)).toContain("# Scout Agent");
    expect(String(req.session_dir)).toMatch(/\/scout\/exec_sessions$/);
    expect(req.tools).toEqual(["read", "grep", "find", "ls", "bash", "write"]);
    expect(req.extensions).toEqual([]);
    expect(req.model).toBe("any-model");
    expect(req).not.toHaveProperty("raw_output_path");

    expect(side.files[`abcd1234/scout/exec_sessions/${sessionId}.calls`]).toBe("1");
    rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  test("resume on a joined run", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sssf-exec-join-"));
    const requestLog = join(scratch, "request.jsonl");
    const env = fakeEnv({ FAKE_EXEC_REQUEST_LOG: requestLog });
    const first = await runSide(
      "port",
      {
        name: "scout-fake-exec-join-1",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_EXEC,
      { keep: true, prepare: stampAdapter },
    );
    expect(first.exit).toBe(0);
    const sessionId = (JSON.parse(first.files["abcd1234/agent_map.json"]!) as {
      scout: { session_id: string };
    }).scout.session_id;
    const second = await runSide(
      "port",
      {
        name: "scout-fake-exec-join-2",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_EXEC,
      { reuseDir: first.dir },
    );
    expect(second.exit).toBe(0);
    const logged = readRequestLog(requestLog);
    expect(logged).toHaveLength(2);
    expect(logged[0]!.session_id).toBe(sessionId);
    expect(logged[1]!.session_id).toBe(sessionId);
    expect(second.files[`abcd1234/scout/exec_sessions/${sessionId}.calls`]).toBe("2");
    rmSync(first.dir, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  test("JSON retry stays in the session", async () => {
    const scratch = mkdtempSync(join(tmpdir(), "sssf-exec-replay-"));
    const requestLog = join(scratch, "request.jsonl");
    const replayDir = join(scratch, "replay");
    mkdirSync(replayDir);
    writeFileSync(join(replayDir, "1.jsonl"), readFileSync(BAD_JSONL));
    writeFileSync(join(replayDir, "2.jsonl"), readFileSync(JSONL));
    const env = fakeEnv({
      FAKE_EXEC_REPLAY: replayDir,
      FAKE_EXEC_REQUEST_LOG: requestLog,
    });
    delete env.FAKE_EXEC_JSONL;
    const side = await runSide(
      "port",
      {
        name: "scout-fake-exec-retry",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env,
      },
      REPO_EXEC,
      { prepare: stampAdapter },
    );
    expect(side.exit).toBe(0);
    const envRows = dumpInserts(side.dump, "envelopes");
    expect(envRows).toHaveLength(2);
    expect(envRows.some((row) => /,0,\d+,'[^']*'\);\s*$/.test(row))).toBe(true);
    expect(envRows.some((row) => /,1,\d+,'[^']*'\);\s*$/.test(row))).toBe(true);

    const logged = readRequestLog(requestLog);
    expect(logged).toHaveLength(2);
    expect(logged[0]!.session_id).toBe(logged[1]!.session_id);
    expect(String(logged[0]!.session_id)).toMatch(UUID_RE);
    expect(String(logged[1]!.prompt)).toContain("not valid JSON");
    rmSync(scratch, { recursive: true, force: true });
  }, 60_000);

  test("validation fails when command is empty", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-exec-empty-command",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv(),
      },
      REPO_EXEC,
      { prepare: stampEmptyCommand },
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("exec runtime needs a non-empty command list");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);

  test("validation fails when --check exits non-zero", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-exec-check-fail",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv({ FAKE_EXEC_CHECK_EXIT: "7" }),
      },
      REPO_EXEC,
      { prepare: stampAdapter },
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("exec command failed --check");
    expect(dumpInserts(side.dump, "sessions")).toHaveLength(0);
  }, 60_000);

  test("adapter error surfaces", async () => {
    const side = await runSide(
      "port",
      {
        name: "scout-fake-exec-error",
        script: "adw_prompt.ts",
        args: ["summarize", "--agent", "scout", "--adw-id", "abcd1234"],
        env: fakeEnv({
          FAKE_EXEC_JSONL: ERROR_JSONL,
          FAKE_EXEC_EXIT: "1",
        }),
      },
      REPO_EXEC,
      { prepare: stampAdapter },
    );
    expect(side.exit).toBe(1);
    expect(side.stderr).toContain("exec exited 1");
    expect(side.stderr).toContain("synthetic adapter failure");
    expect(side.dump).toMatch(/INSERT INTO sessions VALUES\('abcd1234'[^;]*'fail'/);
    expect(dumpInserts(side.dump, "envelopes")).toHaveLength(0);
  }, 60_000);

  test("protocol env pins", () => {
    const env = { ...process.env };
    delete env.SSSF_EXEC_PROTOCOL;
    const result = Bun.spawnSync({
      cmd: [process.execPath, EXEC_AGENT],
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(4);
  });
});

function execRequest(over: Partial<AgentRequest> = {}): AgentRequest {
  return {
    prompt: "hi",
    system_prompt: "sys",
    model: "any-model",
    thinking: "medium",
    session_id: "00000000-0000-0000-0000-000000000001",
    session_dir: "/tmp",
    raw_output_path: "/tmp/out.jsonl",
    tools: null,
    extensions: [],
    cwd: "/tmp",
    command: ["bun", "x"],
    ...over,
  };
}

describe("buildRequest", () => {
  test("key set is exactly the ten documented keys", () => {
    const built = buildRequest(execRequest());
    expect(Object.keys(built)).toEqual(REQUEST_KEYS);
    expect(built).not.toHaveProperty("raw_output_path");
    expect(built).not.toHaveProperty("command");
    expect(built.protocol).toBe("sssf-exec/1");
  });
});

describe("resolveCommand", () => {
  test("relative first token with a separator resolves against cwd", () => {
    expect(resolveCommand(["./tools/agent.ts"], "/repo")[0]).toBe("/repo/tools/agent.ts");
  });

  test("bare name and absolute path are left untouched", () => {
    expect(resolveCommand(["bun", "x"], "/repo")).toEqual(["bun", "x"]);
    expect(resolveCommand(["/abs/a"], "/repo")).toEqual(["/abs/a"]);
  });
});

describe("ExecToolCallTracker", () => {
  test("fills label when absent, keeps a supplied label, clips snippet, ignores other types", () => {
    const tracker = new ExecToolCallTracker();
    const filled = tracker.observe({
      type: "tool_call",
      tool: "bash",
      tool_call_id: "c1",
      args: { command: "echo hi" },
      ok: true,
    });
    expect(filled).not.toBeNull();
    expect(filled!.label).toBe("bash: echo hi");

    const kept = tracker.observe({
      type: "tool_call",
      tool: "bash",
      tool_call_id: "c1",
      args: { command: "echo hi" },
      ok: true,
      label: "custom label",
    });
    expect(kept!.label).toBe("custom label");

    const snippet = "x".repeat(30000);
    const clipped = tracker.observe({
      type: "tool_call",
      tool: "bash",
      tool_call_id: "c1",
      args: {},
      ok: true,
      result_snippet: snippet,
    });
    expect(clipped!.result_snippet).toBe("x".repeat(20000) + "…");

    expect(tracker.observe({ type: "message", text: "hi" })).toBeNull();
    expect(tracker.observe({ type: "unknown" })).toBeNull();
  });
});
