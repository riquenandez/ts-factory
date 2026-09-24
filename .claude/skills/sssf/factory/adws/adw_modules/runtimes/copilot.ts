import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { operatorEnv, spawnCaptured, spawnJsonl } from "../shell.ts";
import {
  finiteOr0,
  newAgentResult,
  type AgentConfig,
  type AgentEvent,
  type AgentInterface,
  type AgentRequest,
  type AgentResult,
  type ToolCallRecord,
} from "./types.ts";
import { ARG_VALUE_CHARS, RESULT_SNIPPET_CHARS, clip, labelFor } from "./toolCalls.ts";
import { isDict, nowIso, registerCleanup } from "../utils.ts";

export const COPILOT_PATH = process.env.COPILOT_PATH ?? "copilot";

const TOOL_MAP: Record<string, string | null> = {
  read: "view",
  bash: "bash",
  edit: "edit",
  write: "create",
  grep: "grep",
  find: "glob",
  ls: null,
};

type Dict = Record<string, unknown>;

export function copilotHome(): string {
  return process.env.COPILOT_HOME ?? join(homedir(), ".copilot");
}

function mapEffort(thinking: string): string {
  return thinking === "off" ? "none" : thinking;
}

function mapTools(tools: string[]): string[] {
  const mapped: string[] = [];
  for (const name of tools) {
    if (Object.hasOwn(TOOL_MAP, name)) {
      const next = TOOL_MAP[name];
      if (next) mapped.push(next);
    } else {
      mapped.push(name);
    }
  }
  return mapped;
}

export function shapeUsageFile(raw: unknown): { shaped: Dict; totalTokens: number; totalCost: number } {
  const obj = isDict(raw) ? raw : {};
  const metrics = isDict(obj.modelMetrics) ? obj.modelMetrics : {};
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let reasoning = 0;
  let totalCost = 0;
  for (const entry of Object.values(metrics)) {
    if (!isDict(entry)) continue;
    const usage = isDict(entry.usage) ? entry.usage : {};
    input += finiteOr0(usage.inputTokens ?? 0);
    output += finiteOr0(usage.outputTokens ?? 0);
    cacheRead += finiteOr0(usage.cacheReadTokens ?? 0);
    cacheWrite += finiteOr0(usage.cacheWriteTokens ?? 0);
    reasoning += finiteOr0(usage.reasoningTokens ?? 0);
    const requests = isDict(entry.requests) ? entry.requests : {};
    totalCost += finiteOr0(requests.cost ?? 0);
  }
  const totalTokens = input + output + cacheRead + cacheWrite;
  return {
    shaped: { input, output, cacheRead, cacheWrite, reasoning, cost: { total: totalCost } },
    totalTokens,
    totalCost,
  };
}

interface OpenCall {
  tool: unknown;
  args: unknown;
  started_at: string;
  clock: number;
}

export class CopilotToolCallTracker {
  private _open = new Map<string, OpenCall>();

  observe(event: AgentEvent): ToolCallRecord | null {
    const etype = event.type ?? "";
    const data = isDict(event.data) ? event.data : {};
    if (etype === "tool.execution_start") {
      this._announce(data.toolCallId, data.toolName, data.arguments);
      return null;
    }
    if (etype !== "tool.execution_complete") return null;
    return this._close(data);
  }

  private _announce(callId: unknown, tool: unknown, args: unknown): void {
    if (callId === null || callId === undefined || callId === "") return;
    const key = String(callId);
    if (this._open.has(key)) return;
    this._open.set(key, {
      tool: tool ?? "",
      args: isDict(args) ? args : {},
      started_at: nowIso(),
      clock: performance.now(),
    });
  }

  private _close(data: Dict): ToolCallRecord {
    const callId = data.toolCallId == null ? "" : String(data.toolCallId);
    const opened = this._open.get(callId);
    this._open.delete(callId);
    const tool = String(opened?.tool || data.toolName || "tool");
    const rawArgs = isDict(opened?.args) ? opened!.args : isDict(data.arguments) ? data.arguments : {};
    const args: Dict = isDict(rawArgs) ? rawArgs : {};
    const record: ToolCallRecord = {
      tool,
      tool_call_id: callId,
      args: Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          typeof value === "string" ? clip(value, ARG_VALUE_CHARS) : value,
        ]),
      ),
      ok: data.success === true,
      label: labelFor(tool, args),
    };
    const result = isDict(data.result) ? data.result : {};
    const error = isDict(data.error) ? data.error : {};
    const snippet =
      typeof result.content === "string" && result.content
        ? result.content
        : typeof error.message === "string" && error.message
          ? error.message
          : "";
    if (snippet) record.result_snippet = clip(snippet, RESULT_SNIPPET_CHARS);
    record.ended_at = nowIso();
    if (opened && opened.clock) record.duration_ms = Math.trunc(performance.now() - opened.clock);
    if (opened && opened.started_at) record.started_at = opened.started_at;
    return record;
  }
}

export function buildArgv(request: AgentRequest, agentName: string, usagePath: string): string[] {
  const cmd = [
    COPILOT_PATH,
    "-p",
    request.prompt,
    "--output-format",
    "json",
    "--no-color",
    "--no-auto-update",
    "--no-ask-user",
    "--no-remote-export",
    "--session-id",
    request.session_id,
    "--model",
    request.model,
    "--effort",
    mapEffort(request.thinking),
    "--agent",
    agentName,
    "--allow-all-tools",
  ];
  if (request.tools !== null) {
    const mapped = mapTools(request.tools);
    cmd.push("--available-tools", mapped.length ? mapped.join(",") : "none");
  }
  for (const entry of request.extensions) cmd.push("--additional-mcp-config", `@${entry}`);
  cmd.push("--usage-output-file", usagePath);
  return cmd;
}

export async function run(
  request: AgentRequest,
  onEvent?: (event: AgentEvent) => void,
  onSpawn?: (pid: number) => void,
  onExit?: (pid: number) => void,
): Promise<AgentResult> {
  mkdirSync(request.session_dir, { recursive: true });
  mkdirSync(dirname(request.raw_output_path), { recursive: true });

  const agentName = `sssf-${request.session_id}`;
  const agentPath = join(copilotHome(), "agents", `${agentName}.agent.md`);
  mkdirSync(dirname(agentPath), { recursive: true });
  writeFileSync(
    agentPath,
    `---\nname: ${agentName}\ndescription: SSSF factory agent\n---\n${request.system_prompt}`,
  );
  const unregister = registerCleanup(() => {
    if (existsSync(agentPath)) unlinkSync(agentPath);
  });

  const usagePath = join(request.session_dir, `${request.session_id}.usage.json`);
  if (existsSync(usagePath)) unlinkSync(usagePath);

  const result = newAgentResult(request.session_id, 0);
  let errorMessage = "";

  try {
    const cmd = buildArgv(request, agentName, usagePath);
    const { returncode, stderr } = await spawnJsonl({
      cmd,
      cwd: request.cwd,
      env: operatorEnv(),
      rawOutputPath: request.raw_output_path,
      onEvent: (event) => {
        if (event.type === "assistant.message") {
          const data = isDict(event.data) ? event.data : {};
          if (typeof data.content === "string" && data.content) result.text = data.content;
        } else if (event.type === "session.error") {
          const data = isDict(event.data) ? event.data : {};
          if (typeof data.message === "string" && data.message) errorMessage = data.message;
        }

        onEvent?.(event);
      },
      onSpawn,
      onExit,
    });
    result.returncode = returncode;

    if (existsSync(usagePath)) {
      try {
        const parsed = JSON.parse(readFileSync(usagePath, "utf8"));
        const { shaped, totalTokens, totalCost } = shapeUsageFile(parsed);
        result.usage.addTurn(shaped, totalTokens);
        result.tokens = totalTokens;
        result.cost = totalCost;
      } finally {
        unlinkSync(usagePath);
      }
    }

    if (result.returncode !== 0 && !result.text) {
      throw new Error(
        `copilot exited ${result.returncode}: ${errorMessage || stderr.trim().slice(-800)}`,
      );
    }
    return result;
  } finally {
    if (existsSync(agentPath)) unlinkSync(agentPath);
    unregister();
  }
}

let copilotBinary: { ok: boolean; detail: string } | null = null;

function copilotBinaryStatus(): { ok: boolean; detail: string } {
  if (copilotBinary) return copilotBinary;
  const captured = spawnCaptured([COPILOT_PATH, "--version"], {
    timeoutSeconds: 30,
    env: operatorEnv(),
  });
  copilotBinary = {
    ok: captured.returncode === 0,
    detail: captured.stderr.trim() || captured.stdout.trim(),
  };
  return copilotBinary;
}

function mintSessionId(_adwId: string, _agentName: string): string {
  return crypto.randomUUID();
}

function validate(agent: AgentConfig): string[] {
  const problems: string[] = [];
  if (!agent.model.trim()) {
    problems.push(`agent '${agent.name}': model is empty`);
  }
  const binary = copilotBinaryStatus();
  if (!binary.ok) {
    problems.push(
      `agent '${agent.name}': copilot binary not runnable: ${COPILOT_PATH} (${binary.detail.slice(-200)})`,
    );
  }
  for (const entry of agent.harness_engineering) {
    if (!entry.endsWith(".json")) {
      problems.push(
        `agent '${agent.name}': harness_engineering entry ${entry} is a pi extension; copilot takes MCP config JSON files`,
      );
    }
  }
  return problems;
}

export const INTERFACE: AgentInterface = {
  run,
  newTracker: () => new CopilotToolCallTracker(),
  mintSessionId,
  validate,
  sessionDirName: "copilot_sessions",
};
