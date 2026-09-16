import { appendFileSync, mkdirSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pyRepr, pyTail } from "./compat/format.ts";
import { pyJson, pyLoads } from "./compat/json.ts";
import { shlexJoin, spawnCaptured } from "./compat/shell.ts";
import {
  finiteOr0,
  newAgentResult,
  type AgentConfig,
  type AgentEvent,
  type AgentInterface,
  type AgentRequest,
  type AgentResult,
  type ToolCallRecord,
  type ToolCallTracker,
} from "./dataTypes.ts";
import { ARG_VALUE_CHARS, RESULT_SNIPPET_CHARS, clip, labelFor } from "./toolCalls.ts";
import { nowIso, operatorEnv, RuntimeError } from "./utils.ts";

const PROTOCOL = "sssf-exec/1";

type Dict = Record<string, unknown>;

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function buildRequest(request: AgentRequest): Record<string, unknown> {
  return {
    protocol: PROTOCOL,
    prompt: request.prompt,
    system_prompt: request.system_prompt,
    model: request.model,
    thinking: request.thinking,
    session_id: request.session_id,
    session_dir: request.session_dir,
    tools: request.tools,
    extensions: request.extensions,
    cwd: request.cwd,
  };
}

export function resolveCommand(command: string[], cwd: string): string[] {
  const head = command[0];
  if (!head) return command;
  if (!isAbsolute(head) && (head.includes("/") || head.includes("\\"))) {
    return [join(cwd, head), ...command.slice(1)];
  }
  return command;
}

export class ExecToolCallTracker implements ToolCallTracker {
  observe(event: AgentEvent): ToolCallRecord | null {
    if (event.type !== "tool_call") return null;
    const tool = String(event.tool ?? "");
    const rawArgs = isDict(event.args) ? event.args : {};
    const args: Dict = Object.fromEntries(
      Object.entries(rawArgs).map(([key, value]) => [
        key,
        typeof value === "string" ? clip(value, ARG_VALUE_CHARS) : value,
      ]),
    );
    const record: ToolCallRecord = {
      tool,
      tool_call_id: event.tool_call_id == null ? "" : String(event.tool_call_id),
      args,
      ok: Boolean(event.ok),
      label: typeof event.label === "string" && event.label ? event.label : labelFor(tool, args),
    };
    if (typeof event.result_snippet === "string") {
      record.result_snippet = clip(event.result_snippet, RESULT_SNIPPET_CHARS);
    }
    record.ended_at = typeof event.ended_at === "string" && event.ended_at ? event.ended_at : nowIso();
    if (typeof event.started_at === "string" && event.started_at) record.started_at = event.started_at;
    if (event.duration_ms != null && event.duration_ms !== "") {
      record.duration_ms = Math.trunc(Number(event.duration_ms));
    }
    return record;
  }
}

export async function run(
  request: AgentRequest,
  onEvent?: (event: AgentEvent) => void,
  onSpawn?: (pid: number) => void,
  onExit?: (pid: number) => void,
): Promise<AgentResult> {
  mkdirSync(request.session_dir, { recursive: true });
  mkdirSync(dirname(request.raw_output_path), { recursive: true });

  const cmd = resolveCommand(request.command ?? [], request.cwd);
  const result = newAgentResult(request.session_id, 0);
  let lastError = "";

  const child = Bun.spawn({
    cmd,
    cwd: request.cwd,
    env: {
      ...operatorEnv(),
      SSSF_EXEC_PROTOCOL: PROTOCOL,
      SSSF_SESSION_ID: request.session_id,
      SSSF_SESSION_DIR: request.session_dir,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  onSpawn?.(child.pid);
  const stderrText = new Response(child.stderr).text();

  await child.stdin.write(pyJson(buildRequest(request)));
  child.stdin.end();

  const absorb = (rawLine: string): void => {
    const line = rawLine.trim();
    if (!line) return;
    let event: unknown;
    try {
      event = pyLoads(line);
    } catch {
      return;
    }
    if (!isDict(event)) return;

    if (event.type === "message") {
      if (typeof event.text === "string" && event.text) result.text = event.text;
    } else if (event.type === "usage") {
      const input = finiteOr0(event.input ?? 0);
      const output = finiteOr0(event.output ?? 0);
      const cacheRead = finiteOr0(event.cache_read ?? 0);
      const cacheWrite = finiteOr0(event.cache_write ?? 0);
      const reasoning = finiteOr0(event.reasoning ?? 0);
      const cost = finiteOr0(event.cost ?? 0);
      const sum = input + output + cacheRead + cacheWrite;
      result.usage.addTurn(
        { input, output, cacheRead, cacheWrite, reasoning, cost: { total: cost } },
        sum,
      );
      result.tokens += sum;
      result.cost += cost;
    } else if (event.type === "context") {
      if (event.tokens != null) result.context_tokens = Math.trunc(Number(event.tokens));
      if (event.window != null) result.context_window = Math.trunc(Number(event.window));
    } else if (event.type === "error") {
      if (typeof event.message === "string" && event.message) lastError = event.message;
    }

    onEvent?.(event);
  };

  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of child.stdout) {
    appendFileSync(request.raw_output_path, chunk);
    pending += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      absorb(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  if (pending) absorb(pending);

  const stderr = await stderrText;
  const code = await child.exited;
  result.returncode = child.signalCode ? -(osConstants.signals[child.signalCode] ?? 0) : code;
  onExit?.(child.pid);

  if (result.returncode !== 0 && !result.text) {
    throw new RuntimeError(
      `exec exited ${result.returncode}: ${lastError || pyTail(stderr.trim(), 800)}`,
    );
  }
  return result;
}

const checkCache = new Map<string, { ok: boolean; detail: string }>();

function checkCommand(command: string[]): { ok: boolean; detail: string } {
  const key = shlexJoin(command);
  const cached = checkCache.get(key);
  if (cached) return cached;
  const captured = spawnCaptured([...resolveCommand(command, process.cwd()), "--check"], {
    timeoutSeconds: 30,
    env: operatorEnv(),
  });
  const status = { ok: captured.returncode === 0, detail: captured.stderr.trim() };
  checkCache.set(key, status);
  return status;
}

function mintSessionId(_adwId: string, _agentName: string): string {
  return crypto.randomUUID();
}

function validate(agent: AgentConfig): string[] {
  const problems: string[] = [];
  const command = agent.command;
  if (!Array.isArray(command) || command.length === 0 || command.some((token) => typeof token !== "string")) {
    problems.push(`agent ${pyRepr(agent.name)}: exec runtime needs a non-empty command list`);
    return problems;
  }
  const checked = checkCommand(command);
  if (!checked.ok) {
    problems.push(
      `agent ${pyRepr(agent.name)}: exec command failed --check: ${shlexJoin(command)} (${pyTail(checked.detail, 200)})`,
    );
  }
  return problems;
}

export const INTERFACE: AgentInterface = {
  run,
  newTracker: () => new ExecToolCallTracker(),
  mintSessionId,
  validate,
  sessionDirName: "exec_sessions",
};
