import type { AgentConfig } from "../dataTypes.ts";

export type { AgentConfig };

export type AgentEvent = Record<string, unknown>;

export interface AgentRequest {
  prompt: string;
  system_prompt: string;
  model: string;
  thinking: string;
  session_id: string;
  session_dir: string;
  raw_output_path: string;
  tools: string[] | null;
  extensions: string[];
  cwd: string;
  command?: string[];
}

export interface ToolCallRecord {
  tool: string;
  tool_call_id: string;
  args: Record<string, unknown>;
  ok: boolean;
  label: string;
  result_snippet?: string;
  started_at?: string;
  ended_at?: string;
  duration_ms?: number;
}

export interface ToolCallTracker {
  observe(event: AgentEvent): ToolCallRecord | null;
}

export function finiteOr0(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export class UsageBreakdown {
  input_tokens = 0;
  output_tokens = 0;
  cache_read_tokens = 0;
  cache_write_tokens = 0;
  reasoning_tokens = 0;
  total_tokens = 0;
  input_cost = 0;
  output_cost = 0;
  cache_read_cost = 0;
  cache_write_cost = 0;
  total_cost = 0;

  addTurn(usage: Record<string, unknown>, totalTokens: number): void {
    const cost = (usage.cost as Record<string, unknown> | undefined) ?? {};
    this.input_tokens += finiteOr0(usage.input ?? 0);
    this.output_tokens += finiteOr0(usage.output ?? 0);
    this.cache_read_tokens += finiteOr0(usage.cacheRead ?? 0);
    this.cache_write_tokens += finiteOr0(usage.cacheWrite ?? 0);
    this.reasoning_tokens += finiteOr0(usage.reasoning ?? 0);
    this.total_tokens += finiteOr0(totalTokens);
    this.input_cost += finiteOr0(cost.input ?? 0);
    this.output_cost += finiteOr0(cost.output ?? 0);
    this.cache_read_cost += finiteOr0(cost.cacheRead ?? 0);
    this.cache_write_cost += finiteOr0(cost.cacheWrite ?? 0);
    this.total_cost += finiteOr0(cost.total ?? 0);
  }

  merge(other: UsageBreakdown): void {
    this.input_tokens += other.input_tokens;
    this.output_tokens += other.output_tokens;
    this.cache_read_tokens += other.cache_read_tokens;
    this.cache_write_tokens += other.cache_write_tokens;
    this.reasoning_tokens += other.reasoning_tokens;
    this.total_tokens += other.total_tokens;
    this.input_cost += other.input_cost;
    this.output_cost += other.output_cost;
    this.cache_read_cost += other.cache_read_cost;
    this.cache_write_cost += other.cache_write_cost;
    this.total_cost += other.total_cost;
  }

  modelDump(): Record<string, unknown> {
    return {
      input_tokens: this.input_tokens,
      output_tokens: this.output_tokens,
      cache_read_tokens: this.cache_read_tokens,
      cache_write_tokens: this.cache_write_tokens,
      reasoning_tokens: this.reasoning_tokens,
      total_tokens: this.total_tokens,
      input_cost: this.input_cost,
      output_cost: this.output_cost,
      cache_read_cost: this.cache_read_cost,
      cache_write_cost: this.cache_write_cost,
      total_cost: this.total_cost,
    };
  }
}

export interface AgentResult {
  text: string;
  returncode: number;
  session_id: string;
  tokens: number;
  cost: number;
  usage: UsageBreakdown;
  context_tokens: number;
  context_window: number;
}

export function newAgentResult(sessionId: string, contextWindow = 0): AgentResult {
  return {
    text: "",
    returncode: 0,
    session_id: sessionId,
    tokens: 0,
    cost: 0,
    usage: new UsageBreakdown(),
    context_tokens: 0,
    context_window: contextWindow,
  };
}

export interface AgentInterface {
  run(request: AgentRequest, onEvent?: (event: AgentEvent) => void, onSpawn?: (pid: number) => void, onExit?: (pid: number) => void): Promise<AgentResult>;
  newTracker(): ToolCallTracker;
  mintSessionId(adwId: string, agentName: string): string;
  validate(agent: AgentConfig): string[];
  sessionDirName: string;
}
