import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { constants as os_constants, homedir } from "node:os";
import { dirname, join } from "node:path";
import { collapseWhitespace, pyHead, pyLen, pyRepr, pyStr, pyTail } from "./compat/format.ts";
import { pyLoads } from "./compat/json.ts";
import { spawnCaptured } from "./compat/shell.ts";
import { newPiResult, type PiRequest, type PiResult } from "./data_types.ts";
import { nowIso, operatorEnv, RuntimeError, ValueError } from "./utils.ts";

export const PI_PATH = process.env.PI_PATH ?? "pi";
export const MODELS_JSON = process.env.PI_MODELS_PATH ?? join(homedir(), ".pi", "agent", "models.json");

const RESULT_SNIPPET_CHARS = 20_000;
const ARG_VALUE_CHARS = 20_000;
const LABEL_CHARS = 80;

const PRIMARY_ARGS = ["command", "path", "file_path", "pattern", "query", "url"];

type Dict = Record<string, unknown>;
export type PiEvent = Dict;
export type CatalogRow = [provider: string, model_id: string, context_window: number];

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Python truthiness: None, False, 0, "", [], {} are all false. */
function py_truthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function py_int(value: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(value)) throw new Error(`invalid literal for int() with base 10: ${pyRepr(value)}`);
  return Number(value);
}

function py_float(value: string): number {
  const n = value.trim() === "" ? NaN : Number(value);
  if (Number.isNaN(n)) throw new Error(`could not convert string to float: ${pyRepr(value)}`);
  return n;
}

function _count(value: string): number {
  const suffix = value.slice(-1).toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : null;
  if (multiplier !== null) return Math.trunc(py_float(value.slice(0, -1)) * multiplier);
  return py_int(value);
}

let catalog_cache: CatalogRow[] | null = null;

function _pi_catalog(): CatalogRow[] {
  if (catalog_cache) return catalog_cache;
  const result = spawnCaptured([PI_PATH, "--list-models"], { timeoutSeconds: 30, env: operatorEnv() });
  const rows: CatalogRow[] = [];
  if (result.returncode === 0) {
    for (const line of result.stdout.split(/\r?\n/).slice(1)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 3) continue;
      try {
        rows.push([columns[0]!, columns[1]!, _count(columns[2]!)]);
      } catch {
        continue;
      }
    }
  }
  catalog_cache = rows;
  return rows;
}

export function resolveModel(pattern: string): [provider: string, model_id: string] {
  const catalog = _pi_catalog().map(([provider, model_id]) => [provider, model_id] as [string, string]);
  if (pattern.includes("/")) {
    const slash = pattern.indexOf("/");
    const provider = pattern.slice(0, slash);
    const model_id = pattern.slice(slash + 1);
    if (catalog.some(([p, m]) => p === provider && m === model_id)) return [provider, model_id];
  }
  const matches = catalog.filter(([, model_id]) => pattern === model_id || model_id.includes(pattern));
  const exact = matches.filter(([, model_id]) => model_id === pattern || model_id.endsWith("/" + pattern));
  if (exact.length === 1) return exact[0]!;
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) {
    throw new ValueError(
      `model pattern ${pyRepr(pattern)} not found in pi --list-models — ` +
        "authenticate/register it or fix the config",
    );
  }
  const shown = matches.map(([p, m]) => `(${pyRepr(p)}, ${pyRepr(m)})`).join(", ");
  throw new ValueError(`model pattern ${pyRepr(pattern)} is ambiguous: [${shown}]`);
}

function _context_tokens(usage: Dict): number {
  const total = usage.totalTokens;
  if (py_truthy(total)) return Math.trunc(Number(total));
  let sum = 0;
  for (const part of ["input", "output", "cacheRead", "cacheWrite"]) {
    sum += py_truthy(usage[part]) ? Number(usage[part]) : 0;
  }
  return Math.trunc(sum);
}

export function contextWindow(provider: string, model_id: string): number {
  const registry = pyLoads(readFileSync(MODELS_JSON, "utf8")) as Dict;
  const providers = isDict(registry.providers) ? registry.providers : {};
  const entry = isDict(providers[provider]) ? providers[provider] : {};
  const models = Array.isArray(entry.models) ? entry.models : [];
  for (const model of models) {
    if (isDict(model) && model.id === model_id) {
      return Math.trunc(Number(py_truthy(model.contextWindow) ? model.contextWindow : 0));
    }
  }
  for (const [listed_provider, listed_model, window] of _pi_catalog()) {
    if (listed_provider === provider && listed_model === model_id) return window;
  }
  return 0;
}

function _text_of(container: Dict): string {
  const content = Array.isArray(container.content) ? container.content : [];
  let out = "";
  for (const part of content) {
    if (isDict(part) && part.type === "text") out += typeof part.text === "string" ? part.text : "";
  }
  return out;
}

function _clip(text: string, limit: number): string {
  return pyLen(text) <= limit ? text : pyHead(text, limit).trimEnd() + "…";
}

function _label(tool: string, args: Dict): string {
  let value = "";
  for (const key of PRIMARY_ARGS) {
    const candidate = args[key];
    if (typeof candidate === "string" && candidate.trim()) {
      value = candidate;
      break;
    }
  }
  if (!value) {
    value = (Object.values(args).find((v) => typeof v === "string" && v.trim()) as string | undefined) ?? "";
  }
  value = collapseWhitespace(value);
  return value ? `${tool}: ${_clip(value, LABEL_CHARS)}` : tool;
}

interface OpenCall {
  tool: unknown;
  args: unknown;
  started_at: string;
  clock: number;
}

export class ToolCallTracker {
  private _open = new Map<string, OpenCall>();

  observe(event: PiEvent): Dict | null {
    const etype = event.type ?? "";
    if (etype === "message_end") {
      const message = isDict(event.message) ? event.message : {};
      const content = Array.isArray(message.content) ? message.content : [];
      for (const block of content) {
        if (isDict(block) && block.type === "toolCall") this._announce(block.id, block.name, block.arguments);
      }
      return null;
    }
    if (etype === "tool_execution_start") {
      this._announce(event.toolCallId, event.toolName, event.args);
      return null;
    }
    if (etype !== "tool_execution_end") return null;

    const call_id = py_truthy(event.toolCallId) ? pyStr(event.toolCallId) : "";
    const opened = this._open.get(call_id);
    this._open.delete(call_id);
    const tool = pyStr(
      py_truthy(event.toolName) ? event.toolName : py_truthy(opened?.tool) ? opened!.tool : "tool",
    );
    const raw_args = py_truthy(event.args) ? event.args : py_truthy(opened?.args) ? opened!.args : {};
    const args: Dict = isDict(raw_args) ? raw_args : {};
    const record: Dict = {
      tool,
      tool_call_id: call_id,
      args: Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          typeof value === "string" ? _clip(value, ARG_VALUE_CHARS) : value,
        ]),
      ),
      ok: !py_truthy(event.isError),
      label: _label(tool, args),
    };
    const result_text = _text_of(isDict(event.result) ? event.result : {});
    if (result_text) record.result_snippet = _clip(result_text, RESULT_SNIPPET_CHARS);
    record.ended_at = nowIso();
    if (opened && opened.clock) record.duration_ms = Math.trunc(performance.now() - opened.clock);
    if (opened && opened.started_at) record.started_at = opened.started_at;
    return record;
  }

  private _announce(call_id: unknown, tool: unknown, args: unknown): void {
    if (!py_truthy(call_id)) return;
    const key = pyStr(call_id);
    const known = this._open.get(key);
    this._open.set(key, {
      tool: py_truthy(tool) ? tool : known?.tool ?? "",
      args: py_truthy(args) ? args : known?.args ?? {},
      started_at: known?.started_at || nowIso(),
      clock: known?.clock || performance.now(),
    });
  }
}

export async function run(
  request: PiRequest,
  on_event?: (event: PiEvent) => void,
  on_spawn?: (pid: number) => void,
  on_exit?: (pid: number) => void,
): Promise<PiResult> {
  const [provider, model_id] = resolveModel(request.model);
  const cmd = [
    PI_PATH, "-p", "--mode", "json",
    "--provider", provider, "--model", model_id,
    "--thinking", request.thinking,
    "--session-id", request.session_id,
    "--session-dir", request.session_dir,
    "--system-prompt", request.system_prompt,
  ];
  if (request.tools && request.tools.length) cmd.push("--tools", request.tools.join(","));
  for (const extension of request.extensions) cmd.push("-e", extension);
  cmd.push(request.prompt);

  mkdirSync(dirname(request.raw_output_path), { recursive: true });

  const result = newPiResult(request.session_id, contextWindow(provider, model_id));
  const child = Bun.spawn({
    cmd,
    cwd: request.cwd,
    env: operatorEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  on_spawn?.(child.pid);
  // Drained concurrently so a chatty stderr cannot wedge the child while stdout is tailed.
  const stderr_text = new Response(child.stderr).text();

  const absorb = (raw_line: string): void => {
    const line = raw_line.trim();
    if (!line) return;
    let event: unknown;
    try {
      event = pyLoads(line);
    } catch {
      return;
    }
    if (!isDict(event)) return;
    if (event.type === "message_end") {
      const message = isDict(event.message) ? event.message : {};
      if (message.role === "assistant") {
        const text = _text_of(message);
        if (text) result.text = text;
        const usage = isDict(message.usage) ? message.usage : {};
        const turn = _context_tokens(usage);
        result.tokens += turn;
        result.usage.addTurn(usage, turn);
        if (turn && message.stopReason !== "aborted" && message.stopReason !== "error") {
          result.context_tokens = turn;
        }
        const cost = isDict(usage.cost) ? usage.cost : {};
        result.cost += py_truthy(cost.total) ? Number(cost.total) : 0;
      }
    }
    on_event?.(event);
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

  const stderr = await stderr_text;
  const code = await child.exited;
  result.returncode = child.signalCode ? -(os_constants.signals[child.signalCode] ?? 0) : code;
  on_exit?.(child.pid);
  if (result.returncode !== 0 && !result.text) {
    throw new RuntimeError(`pi exited ${result.returncode}: ${pyTail(stderr.trim(), 800)}`);
  }
  return result;
}
