import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { constants as os_constants, homedir } from "node:os";
import { dirname, join } from "node:path";
import { collapseWhitespace, pyHead, pyLen, pyRepr, pyStr, pyTail } from "./compat/format.ts";
import { pyLoads } from "./compat/json.ts";
import { spawnCaptured } from "./compat/shell.ts";
import { newPiResult, type PiRequest, type PiResult } from "./dataTypes.ts";
import { nowIso, operatorEnv, RuntimeError, ValueError } from "./utils.ts";

export const PI_PATH = process.env.PI_PATH ?? "pi";
export const MODELS_JSON = process.env.PI_MODELS_PATH ?? join(homedir(), ".pi", "agent", "models.json");

const RESULT_SNIPPET_CHARS = 20_000;
const ARG_VALUE_CHARS = 20_000;
const LABEL_CHARS = 80;

const PRIMARY_ARGS = ["command", "path", "file_path", "pattern", "query", "url"];

type Dict = Record<string, unknown>;
export type PiEvent = Dict;
export type CatalogRow = [provider: string, modelId: string, contextWindow: number];

function isDict(value: unknown): value is Dict {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Python truthiness: None, False, 0, "", [], {} are all false. */
function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function pyInt(value: string): number {
  if (!/^\s*[+-]?\d+\s*$/.test(value)) throw new Error(`invalid literal for int() with base 10: ${pyRepr(value)}`);
  return Number(value);
}

function pyFloat(value: string): number {
  const n = value.trim() === "" ? NaN : Number(value);
  if (Number.isNaN(n)) throw new Error(`could not convert string to float: ${pyRepr(value)}`);
  return n;
}

function _count(value: string): number {
  const suffix = value.slice(-1).toUpperCase();
  const multiplier = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : null;
  if (multiplier !== null) return Math.trunc(pyFloat(value.slice(0, -1)) * multiplier);
  return pyInt(value);
}

let catalogCache: CatalogRow[] | null = null;

function _piCatalog(): CatalogRow[] {
  if (catalogCache) return catalogCache;
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
  catalogCache = rows;
  return rows;
}

export function resolveModel(pattern: string): [provider: string, modelId: string] {
  const catalog = _piCatalog().map(([provider, modelId]) => [provider, modelId] as [string, string]);
  if (pattern.includes("/")) {
    const slash = pattern.indexOf("/");
    const provider = pattern.slice(0, slash);
    const modelId = pattern.slice(slash + 1);
    if (catalog.some(([p, m]) => p === provider && m === modelId)) return [provider, modelId];
  }
  const matches = catalog.filter(([, modelId]) => pattern === modelId || modelId.includes(pattern));
  const exact = matches.filter(([, modelId]) => modelId === pattern || modelId.endsWith("/" + pattern));
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

function _contextTokens(usage: Dict): number {
  const total = usage.totalTokens;
  if (pyTruthy(total)) return Math.trunc(Number(total));
  let sum = 0;
  for (const part of ["input", "output", "cacheRead", "cacheWrite"]) {
    sum += pyTruthy(usage[part]) ? Number(usage[part]) : 0;
  }
  return Math.trunc(sum);
}

export function contextWindow(provider: string, modelId: string): number {
  const registry = pyLoads(readFileSync(MODELS_JSON, "utf8")) as Dict;
  const providers = isDict(registry.providers) ? registry.providers : {};
  const entry = isDict(providers[provider]) ? providers[provider] : {};
  const models = Array.isArray(entry.models) ? entry.models : [];
  for (const model of models) {
    if (isDict(model) && model.id === modelId) {
      return Math.trunc(Number(pyTruthy(model.contextWindow) ? model.contextWindow : 0));
    }
  }
  for (const [listedProvider, listedModel, window] of _piCatalog()) {
    if (listedProvider === provider && listedModel === modelId) return window;
  }
  return 0;
}

export function _textOf(container: Dict): string {
  const content = Array.isArray(container.content) ? container.content : [];
  let out = "";
  for (const part of content) {
    if (isDict(part) && part.type === "text") out += typeof part.text === "string" ? part.text : "";
  }
  return out;
}

export function _clip(text: string, limit: number): string {
  return pyLen(text) <= limit ? text : pyHead(text, limit).trimEnd() + "…";
}

export function _label(tool: string, args: Dict): string {
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

    const callId = pyTruthy(event.toolCallId) ? pyStr(event.toolCallId) : "";
    const opened = this._open.get(callId);
    this._open.delete(callId);
    const tool = pyStr(
      pyTruthy(event.toolName) ? event.toolName : pyTruthy(opened?.tool) ? opened!.tool : "tool",
    );
    const rawArgs = pyTruthy(event.args) ? event.args : pyTruthy(opened?.args) ? opened!.args : {};
    const args: Dict = isDict(rawArgs) ? rawArgs : {};
    const record: Dict = {
      tool,
      tool_call_id: callId,
      args: Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          typeof value === "string" ? _clip(value, ARG_VALUE_CHARS) : value,
        ]),
      ),
      ok: !pyTruthy(event.isError),
      label: _label(tool, args),
    };
    const resultText = _textOf(isDict(event.result) ? event.result : {});
    if (resultText) record.result_snippet = _clip(resultText, RESULT_SNIPPET_CHARS);
    record.ended_at = nowIso();
    if (opened && opened.clock) record.duration_ms = Math.trunc(performance.now() - opened.clock);
    if (opened && opened.started_at) record.started_at = opened.started_at;
    return record;
  }

  private _announce(callId: unknown, tool: unknown, args: unknown): void {
    if (!pyTruthy(callId)) return;
    const key = pyStr(callId);
    const known = this._open.get(key);
    this._open.set(key, {
      tool: pyTruthy(tool) ? tool : known?.tool ?? "",
      args: pyTruthy(args) ? args : known?.args ?? {},
      started_at: known?.started_at || nowIso(),
      clock: known?.clock || performance.now(),
    });
  }
}

export async function run(
  request: PiRequest,
  onEvent?: (event: PiEvent) => void,
  onSpawn?: (pid: number) => void,
  onExit?: (pid: number) => void,
): Promise<PiResult> {
  const [provider, modelId] = resolveModel(request.model);
  const cmd = [
    PI_PATH, "-p", "--mode", "json",
    "--provider", provider, "--model", modelId,
    "--thinking", request.thinking,
    "--session-id", request.session_id,
    "--session-dir", request.session_dir,
    "--system-prompt", request.system_prompt,
  ];
  if (request.tools && request.tools.length) cmd.push("--tools", request.tools.join(","));
  for (const extension of request.extensions) cmd.push("-e", extension);
  cmd.push(request.prompt);

  mkdirSync(dirname(request.raw_output_path), { recursive: true });

  const result = newPiResult(request.session_id, contextWindow(provider, modelId));
  const child = Bun.spawn({
    cmd,
    cwd: request.cwd,
    env: operatorEnv(),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  onSpawn?.(child.pid);
  // Drained concurrently so a chatty stderr cannot wedge the child while stdout is tailed.
  const stderrText = new Response(child.stderr).text();

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
    if (event.type === "message_end") {
      const message = isDict(event.message) ? event.message : {};
      if (message.role === "assistant") {
        const text = _textOf(message);
        if (text) result.text = text;
        const usage = isDict(message.usage) ? message.usage : {};
        const turn = _contextTokens(usage);
        result.tokens += turn;
        result.usage.addTurn(usage, turn);
        if (turn && message.stopReason !== "aborted" && message.stopReason !== "error") {
          result.context_tokens = turn;
        }
        const cost = isDict(usage.cost) ? usage.cost : {};
        result.cost += pyTruthy(cost.total) ? Number(cost.total) : 0;
      }
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
  result.returncode = child.signalCode ? -(os_constants.signals[child.signalCode] ?? 0) : code;
  onExit?.(child.pid);
  if (result.returncode !== 0 && !result.text) {
    throw new RuntimeError(`pi exited ${result.returncode}: ${pyTail(stderr.trim(), 800)}`);
  }
  return result;
}
