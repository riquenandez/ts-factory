import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pyRepr, pyTail } from "./compat/format.ts";
import { operatorEnv, spawnCaptured, spawnJsonl } from "./compat/shell.ts";
import {
  newAgentResult,
  type AgentConfig,
  type AgentEvent,
  type AgentInterface,
  type AgentRequest,
  type AgentResult,
  type ToolCallRecord,
} from "./dataTypes.ts";
import { ARG_VALUE_CHARS, RESULT_SNIPPET_CHARS, clip, labelFor, textOf } from "./toolCalls.ts";
import { isDict, nowIso, RuntimeError } from "./utils.ts";

export const CLAUDE_CODE_PATH = process.env.CLAUDE_CODE_PATH ?? "claude";

const TOOL_MAP: Record<string, string | null> = {
  read: "Read",
  bash: "Bash",
  edit: "Edit",
  write: "Write",
  grep: "Grep",
  find: "Glob",
  ls: null,
};

const createdSessionIds = new Set<string>();

type Dict = Record<string, unknown>;

function mapEffort(thinking: string): string {
  if (thinking === "off" || thinking === "minimal") return "low";
  return thinking;
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

export function claudeEnv(): Record<string, string> {
  const env = operatorEnv();
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

function shapeUsage(usage: Dict): { shaped: Dict; sum: number } {
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0);
  const sum = input + output + cacheRead + cacheWrite;
  return { shaped: { input, output, cacheRead, cacheWrite, totalTokens: sum }, sum };
}

function contextWindowFrom(modelUsage: unknown, model: string): number {
  if (!isDict(modelUsage)) return 0;
  const direct = modelUsage[model];
  if (isDict(direct) && direct.contextWindow != null) return Math.trunc(Number(direct.contextWindow));
  const needle = model.toLowerCase();
  for (const [key, entry] of Object.entries(modelUsage)) {
    if (!isDict(entry) || entry.contextWindow == null) continue;
    const canonical = typeof entry.canonicalModel === "string" ? entry.canonicalModel.toLowerCase() : "";
    if (key.toLowerCase().includes(needle) || canonical.includes(needle)) {
      return Math.trunc(Number(entry.contextWindow));
    }
  }
  return 0;
}

function resultTextOf(block: Dict): string {
  const content = block.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return textOf({ content });
  if (isDict(content)) return textOf(content);
  return "";
}

interface OpenCall {
  tool: unknown;
  args: unknown;
  started_at: string;
  clock: number;
}

export class ClaudeToolCallTracker {
  private _open = new Map<string, OpenCall>();

  observe(event: AgentEvent): ToolCallRecord | null {
    const etype = event.type ?? "";
    if (etype === "assistant") {
      const message = isDict(event.message) ? event.message : {};
      const content = Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        if (isDict(block) && block.type === "tool_use") this._announce(block.id, block.name, block.input);
      }
      return null;
    }
    if (etype !== "user") return null;

    const message = isDict(event.message) ? event.message : {};
    const content = Array.isArray(message.content) ? message.content : [];
    let record: ToolCallRecord | null = null;
    for (const block of content) {
      if (!isDict(block) || block.type !== "tool_result") continue;
      const closed = this._close(block);
      if (closed) record = closed;
    }
    return record;
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

  private _close(block: Dict): ToolCallRecord {
    const callId = block.tool_use_id == null ? "" : String(block.tool_use_id);
    const opened = this._open.get(callId);
    this._open.delete(callId);
    const tool = String(opened?.tool || "tool");
    const rawArgs = isDict(opened?.args) ? opened!.args : {};
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
      ok: !block.is_error,
      label: labelFor(tool, args),
    };
    const snippet = resultTextOf(block);
    if (snippet) record.result_snippet = clip(snippet, RESULT_SNIPPET_CHARS);
    record.ended_at = nowIso();
    if (opened && opened.clock) record.duration_ms = Math.trunc(performance.now() - opened.clock);
    if (opened && opened.started_at) record.started_at = opened.started_at;
    return record;
  }
}

export function buildArgv(request: AgentRequest, first: boolean): string[] {
  const cmd = [CLAUDE_CODE_PATH, "-p", "--output-format", "stream-json", "--verbose"];
  if (first) cmd.push("--session-id", request.session_id);
  else cmd.push("--resume", request.session_id);
  cmd.push("--model", request.model);
  cmd.push("--effort", mapEffort(request.thinking));
  cmd.push("--system-prompt", request.system_prompt);
  if (request.tools === null) {
    cmd.push("--dangerously-skip-permissions");
  } else {
    const mapped = mapTools(request.tools);
    const builtin = mapped.filter((name) => !name.startsWith("mcp__"));
    if (mapped.length) {
      cmd.push("--tools", builtin.join(","));
      cmd.push("--allowedTools", mapped.join(","));
    } else {
      cmd.push("--tools", "");
    }
    cmd.push("--permission-mode", "dontAsk");
  }
  for (const entry of request.extensions) cmd.push("--mcp-config", entry);
  cmd.push("--strict-mcp-config");
  cmd.push(request.prompt);
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

  const marker = join(request.session_dir, `${request.session_id}.created`);
  const first = !createdSessionIds.has(request.session_id) && !existsSync(marker);
  createdSessionIds.add(request.session_id);

  const cmd = buildArgv(request, first);
  const result = newAgentResult(request.session_id, 0);
  const seenMessageIds = new Set<string>();
  let lastAssistantText = "";
  let errorSubtype: string | null = null;

  const { returncode, stderr } = await spawnJsonl({
    cmd,
    cwd: request.cwd,
    env: claudeEnv(),
    rawOutputPath: request.raw_output_path,
    onEvent: (event) => {
      if (event.type === "assistant") {
        const message = isDict(event.message) ? event.message : {};
        const text = textOf(message);
        if (text) lastAssistantText = text;
        const messageId = typeof message.id === "string" ? message.id : "";
        const duplicate = messageId !== "" && seenMessageIds.has(messageId);
        if (messageId) seenMessageIds.add(messageId);
        if (!duplicate) {
          const usage = isDict(message.usage) ? message.usage : {};
          const { shaped, sum } = shapeUsage(usage);
          result.usage.addTurn(shaped, sum);
          result.tokens += sum;
          result.context_tokens = sum;
        }
      } else if (event.type === "result") {
        if (typeof event.result === "string" && event.result) result.text = event.result;
        const cost = Number(event.total_cost_usd ?? 0);
        result.cost += cost;
        result.usage.addTurn({ cost: { total: cost } }, 0);
        const window = contextWindowFrom(event.modelUsage, request.model);
        if (window) result.context_window = window;
        if (event.is_error) errorSubtype = typeof event.subtype === "string" && event.subtype ? event.subtype : "error";
      }

      onEvent?.(event);
    },
    onSpawn,
    onExit,
  });
  if (!result.text) result.text = lastAssistantText;
  result.returncode = returncode;

  if (first && result.returncode === 0) writeFileSync(marker, "");

  if (errorSubtype && !result.text) {
    throw new RuntimeError(`claude ${errorSubtype}`);
  }
  if (result.returncode !== 0 && !result.text) {
    throw new RuntimeError(`claude exited ${result.returncode}: ${pyTail(stderr.trim(), 800)}`);
  }
  return result;
}

let claudeBinary: { ok: boolean; detail: string } | null = null;

function claudeBinaryStatus(): { ok: boolean; detail: string } {
  if (claudeBinary) return claudeBinary;
  const captured = spawnCaptured([CLAUDE_CODE_PATH, "--version"], {
    timeoutSeconds: 30,
    env: claudeEnv(),
  });
  claudeBinary = {
    ok: captured.returncode === 0,
    detail: captured.stderr.trim() || captured.stdout.trim(),
  };
  return claudeBinary;
}

function mintSessionId(_adwId: string, _agentName: string): string {
  return crypto.randomUUID();
}

function validate(agent: AgentConfig): string[] {
  const problems: string[] = [];
  if (!agent.model.trim()) {
    problems.push(`agent ${pyRepr(agent.name)}: model is empty`);
  }
  const binary = claudeBinaryStatus();
  if (!binary.ok) {
    problems.push(
      `agent ${pyRepr(agent.name)}: claude_code binary not runnable: ${CLAUDE_CODE_PATH} (${pyTail(binary.detail, 200)})`,
    );
  }
  for (const entry of agent.harness_engineering) {
    if (!entry.endsWith(".json")) {
      problems.push(
        `agent ${pyRepr(agent.name)}: harness_engineering entry ${entry} is a pi extension; claude_code takes MCP config JSON files`,
      );
    }
  }
  return problems;
}

export const INTERFACE: AgentInterface = {
  run,
  newTracker: () => new ClaudeToolCallTracker(),
  mintSessionId,
  validate,
  sessionDirName: "claude_sessions",
};
