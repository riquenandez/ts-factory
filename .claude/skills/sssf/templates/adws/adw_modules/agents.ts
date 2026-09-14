import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as agentPi from "./agentPi.ts";
import { SystemExit } from "./compat/cli.ts";
import { pyRepr, pyStr, pyTail, removePrefix } from "./compat/format.ts";
import { pyJson, pyLoads, serdeJson } from "./compat/json.ts";
import { modelValidate, type Schema } from "./compat/schema.ts";
import { pyYamlLoad } from "./compat/yaml.ts";
import {
  DEFAULT_PROTECTED,
  GateReport,
  UsageBreakdown,
  defaultConfig,
  type AgentCall,
  type AgentConfig,
  type EnvelopeBase,
  type Phase,
  type PiRequest,
  type PiResult,
  type SSSFConfig,
} from "./dataTypes.ts";
import { PermissionBreach, enforce, snapshot } from "./permissions.ts";
import * as prompts from "./prompts.ts";
import type { Run } from "./runner.ts";
import { RuntimeError, ValueError, newId } from "./utils.ts";

export const JSON_FIX_ATTEMPTS = 2;

export class GateFailure extends RuntimeError {
  constructor(message: string) {
    super(message);
    this.name = "GateFailure";
  }
}

// ── config ───────────────────────────────────────────────────────────────────

const BASE = defaultConfig();

const PROMPT_ENGINEERING: Schema = {
  name: "PromptEngineering",
  fields: [
    { name: "system", kind: "str" },
    { name: "user", kind: "str" },
  ],
};

const STR_LIST = { name: "item", kind: "str" as const };

const AGENT_CONFIG: Schema = {
  name: "AgentConfig",
  fields: [
    { name: "name", kind: "str" },
    { name: "coding_agent", kind: "literal", literals: ["pi", "claude_code"], default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "purpose", kind: "str", default: "" },
    { name: "prompt_engineering", kind: "model", model: PROMPT_ENGINEERING },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "writes", kind: "list", optional: true, default: null, inner: STR_LIST },
  ],
};

const CONFIG_DEFAULTS: Schema = {
  name: "ConfigDefaults",
  fields: [
    { name: "coding_agent", kind: "literal", literals: ["pi", "claude_code"], default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "protected_files", kind: "list", defaultFactory: () => [...DEFAULT_PROTECTED], inner: STR_LIST },
    { name: "data_dir", kind: "str", default: BASE.defaults.data_dir },
  ],
};

const OBSERVABILITY_CONFIG: Schema = {
  name: "ObservabilityConfig",
  fields: [
    { name: "db", kind: "str", default: BASE.observability.db },
    { name: "poll_ms", kind: "int", default: BASE.observability.poll_ms },
  ],
};

const SSSF_CONFIG: Schema = {
  name: "SSSFConfig",
  fields: [
    {
      name: "defaults",
      kind: "model",
      model: CONFIG_DEFAULTS,
      defaultFactory: () => modelValidate(CONFIG_DEFAULTS, {}),
    },
    {
      name: "observability",
      kind: "model",
      model: OBSERVABILITY_CONFIG,
      defaultFactory: () => modelValidate(OBSERVABILITY_CONFIG, {}),
    },
    { name: "agents", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "model", model: AGENT_CONFIG } },
  ],
};

const INHERITED_KEYS = ["coding_agent", "model", "thinking", "color", "tools", "writes"];

function isDict(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadConfig(path = "adws/adw_sssf_config/sssf.config.yaml"): SSSFConfig {
  const loaded = pyYamlLoad(readFileSync(path, "utf8"));
  const raw: Record<string, unknown> = isDict(loaded) ? loaded : {};
  const defaults = isDict(raw.defaults) ? raw.defaults : {};
  const agents = Array.isArray(raw.agents) ? raw.agents : [];
  for (const agent of agents) {
    if (!isDict(agent)) continue;
    for (const key of INHERITED_KEYS) {
      if (Object.hasOwn(defaults, key) && !Object.hasOwn(agent, key)) agent[key] = defaults[key];
    }
    if (!Object.hasOwn(agent, "harness_engineering")) {
      agent.harness_engineering = Object.hasOwn(defaults, "harness_engineering") ? defaults.harness_engineering : [];
    }
  }
  return modelValidate(SSSF_CONFIG, raw) as unknown as SSSFConfig;
}

export function resolve(cfg: SSSFConfig, name: string): AgentConfig {
  for (const agent of cfg.agents) {
    if (agent.name === name) return agent;
  }
  throw new SystemExit(
    `agent ${pyRepr(name)} is not defined in the config — ` +
      `available: ${pyStr(cfg.agents.map((a) => a.name))}`,
  );
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

export function validate(cfg: SSSFConfig, required: string[]): void {
  const problems: string[] = [];
  for (const name of required) {
    let agent: AgentConfig;
    try {
      agent = resolve(cfg, name);
    } catch (error) {
      if (!(error instanceof SystemExit)) throw error;
      problems.push(error.message);
      continue;
    }
    if (agent.coding_agent !== "pi") {
      problems.push(
        `agent ${pyRepr(name)}: coding_agent ${pyRepr(agent.coding_agent)} ` +
          "is not implemented in v1 (pi only)",
      );
    }
    for (const [label, ref] of [["system", agent.prompt_engineering.system], ["user", agent.prompt_engineering.user]]) {
      if (!isFile(ref!)) problems.push(`agent ${pyRepr(name)}: ${label} prompt not found: ${ref}`);
    }
    try {
      agentPi.resolveModel(agent.model);
    } catch (error) {
      if (!(error instanceof ValueError)) throw error;
      problems.push(`agent ${pyRepr(name)}: ${error.message}`);
    }
  }
  if (problems.length) {
    throw new SystemExit("config validation failed:\n- " + problems.join("\n- "));
  }
}

// ── execution ────────────────────────────────────────────────────────────────

type Send = (prompt_text: string) => Promise<PiResult>;

export async function execute(run: Run, phase: Phase, call: AgentCall): Promise<EnvelopeBase> {
  const agent = resolve(run.cfg, phase.params.owner);
  const agentDir = join(run.sessionDir, agent.name);
  mkdirSync(agentDir, { recursive: true });

  const variables = {
    prompt: call.prompt,
    previous_envelope: call.previous ? serdeJson(call.previous, 2) : "(none)",
    context_handoff_dir: run.contextHandoffDir,
  };
  const systemText = prompts.render(agent.prompt_engineering.system, variables);
  const userText = prompts.render(agent.prompt_engineering.user, variables);
  prompts.save(join(agentDir, "prompts"), "system.md", systemText);
  prompts.save(join(agentDir, "prompts"), "user.md", userText);

  const sessionId = agentSessionId(run, agent);
  run.tracer.event({
    adw_id: run.adwId,
    phase_id: phase.phase_id,
    type: "agent_start",
    name: agent.name,
    payload: {
      model: agent.model,
      thinking: agent.thinking,
      color: agent.color,
      session_id: sessionId,
      coding_agent: agent.coding_agent,
      purpose: agent.purpose,
      tools: agent.tools,
      harness_engineering: agent.harness_engineering,
    },
  });
  run.console.agentStarted(agent.name, agent.model, sessionId);

  let latest: PiResult | null = null;
  const spent = new UsageBreakdown();
  const forward = eventForwarder(run, phase, agent.name);
  // Absolute, like Path.resolve(): the pi subprocess reads these from repoRoot.
  const agentDirAbs = realpathSync(agentDir);

  const send: Send = async (promptText) => {
    const request: PiRequest = {
      prompt: promptText,
      system_prompt: systemText,
      model: agent.model,
      thinking: agent.thinking,
      session_id: sessionId,
      session_dir: join(agentDirAbs, "pi_sessions"),
      raw_output_path: join(agentDirAbs, "raw_output.jsonl"),
      tools: agent.tools,
      extensions: agent.harness_engineering,
      cwd: run.repoRoot,
    };
    const result = await agentPi.run(
      request,
      forward,
      (pid) =>
        run.tracer.processStart(
          run.adwId, "agent", agent.name, pid,
          `${agent.coding_agent} ${agent.name} ${agent.model}`,
        ),
      (pid) => run.tracer.processEnd(run.adwId, pid),
    );
    run.addUsage(result.tokens, result.cost);
    spent.merge(result.usage);
    latest = result;
    return result;
  };

  const treeBefore = snapshot(run);

  let result = await send(userText);
  let [envelope, attempt] = await parseWithRetries(run, phase, call, result, send);

  const retries = phase.params.retries;
  for (let gateAttempt = 1; gateAttempt <= Math.max(1, retries + 1); gateAttempt++) {
    const violations: string[] = [];
    for (const gate of call.gates ?? []) {
      const report = asReport(gate(envelope, run));
      const found = report.violations;
      run.tracer.gateRow(phase, gate.name, report, gateAttempt);
      run.tracer.event({
        adw_id: run.adwId,
        phase_id: phase.phase_id,
        type: found.length ? "gate_fail" : "gate_pass",
        name: gate.name,
        payload: {
          attempt: gateAttempt,
          violations: found,
          checks: report.checks.map((c) => ({ item: c.item, ok: c.ok, note: c.note })),
        },
      });
      run.console.gateResult(gate.name, report);
      violations.push(...found);
    }
    if (!violations.length) break;
    if (gateAttempt > retries) {
      throw new GateFailure(
        `${agent.name} failed gates after ${gateAttempt} attempt(s):\n- ` + violations.join("\n- "),
      );
    }
    phase.attempt = gateAttempt;
    run.console.retry(agent.name, gateAttempt, retries, `${violations.length} gate violation(s)`);
    const correction =
      "Your previous response failed validation:\n- " +
      violations.join("\n- ") +
      "\n\nFix these problems, then re-emit ONLY your Report JSON.";
    result = await send(correction);
    [envelope, attempt] = await parseWithRetries(run, phase, call, result, send);
  }

  let touched: string[];
  try {
    touched = enforce(run, phase, agent, treeBefore);
  } catch (breach) {
    if (breach instanceof PermissionBreach) {
      run.tracer.event({
        adw_id: run.adwId,
        phase_id: phase.phase_id,
        type: "error",
        name: "permission_breach",
        payload: {
          agent: agent.name,
          error: breach.message,
          writes: agent.writes,
          protected_files: run.cfg.defaults.protected_files,
        },
      });
    }
    throw breach;
  }
  if (touched.length) {
    run.tracer.event({
      adw_id: run.adwId,
      phase_id: phase.phase_id,
      type: "log",
      name: "paths_touched",
      payload: { agent: agent.name, paths: touched },
    });
  }

  persistEnvelope(run, phase, agent.name, call, envelope, attempt, true);
  run.console.envelopeSummary(envelope, call.outputType.name);
  const context: PiResult = latest ?? result;
  run.tracer.agentSessionRow(run.adwId, agent, sessionId, context.context_tokens, context.context_window);
  run.saveAgentMap(agent.name, {
    session_id: sessionId,
    model: agent.model,
    coding_agent: agent.coding_agent,
  });
  run.tracer.event({
    adw_id: run.adwId,
    phase_id: phase.phase_id,
    type: "handoff",
    name: agent.name,
    payload: { artifacts: envelope.artifacts, summary: envelope.summary },
  });
  run.tracer.event({
    adw_id: run.adwId,
    phase_id: phase.phase_id,
    type: "agent_end",
    name: agent.name,
    tokens: spent.total_tokens,
    payload: {
      cost: spent.total_cost,
      usage: spent.modelDump(),
      context_tokens: context.context_tokens,
      context_window: context.context_window,
    },
  });
  run.console.agentFinished(agent.name, spent.total_tokens, spent.total_cost);
  if (envelope.status !== "success") {
    throw new RuntimeError(`${agent.name} reported status=${pyRepr(envelope.status)}: ${envelope.summary}`);
  }
  return envelope;
}

// ── internals ────────────────────────────────────────────────────────────────

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : pyStr(error);
}

function asReport(result: GateReport | string[] | null | undefined): GateReport {
  if (result instanceof GateReport) return result;
  const report = new GateReport();
  for (const violation of result ?? []) report.check(pyStr(violation), false);
  return report;
}

function agentSessionId(run: Run, agent: AgentConfig): string {
  const entry = run.agentMap[agent.name];
  if (entry && entry.model === agent.model) return entry.session_id;
  return `sssf-${run.adwId}-${agent.name}-${newId(4)}`;
}

function eventForwarder(run: Run, phase: Phase, agentName: string): (event: agentPi.PiEvent) => void {
  const tracker = new agentPi.ToolCallTracker();
  return (event) => {
    const record = tracker.observe(event);
    if (record === null) return;
    const { label, started_at, ended_at, ...rest } = record;
    run.tracer.event({
      adw_id: run.adwId,
      phase_id: phase.phase_id,
      type: "tool_call",
      name: pyStr(label),
      started_at: (started_at as string | undefined) ?? null,
      ended_at: (ended_at as string | undefined) ?? null,
      payload: { ...rest, agent: agentName },
    });
  };
}

export function extractJson(text: string): unknown {
  let candidate = text;
  if (text.includes("```")) {
    const blocks = text.split("```");
    for (let i = 1; i < blocks.length; i += 2) {
      const block = removePrefix(blocks[i]!, "json").trim();
      if (block.startsWith("{")) {
        candidate = block;
        break;
      }
    }
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in the response");
  return pyLoads(candidate.slice(start, end + 1));
}

async function parseWithRetries(
  run: Run,
  phase: Phase,
  call: AgentCall,
  result: PiResult,
  send: Send,
): Promise<[EnvelopeBase, number]> {
  for (let attempt = 1; attempt <= JSON_FIX_ATTEMPTS + 1; attempt++) {
    let error: unknown;
    try {
      const payload = extractJson(result.text);
      return [call.outputType.parse(payload), attempt];
    } catch (caught) {
      error = caught;
    }
    persistEnvelope(run, phase, phase.params.owner, call, null, attempt, false, result.text);
    if (attempt > JSON_FIX_ATTEMPTS) {
      throw new RuntimeError(
        `${phase.params.owner} never produced valid ${call.outputType.name} JSON: ${messageOf(error)}`,
      );
    }
    run.console.retry(
      phase.params.owner, attempt, JSON_FIX_ATTEMPTS,
      `invalid ${call.outputType.name} JSON: ${messageOf(error)}`,
    );
    const fields = call.outputType.fields.join(", ");
    result = await send(
      "Your response was not valid JSON for the required structure " +
        `(${messageOf(error)}). Respond again with ONLY a JSON object with these ` +
        `fields: ${fields}. No prose, no code fences.`,
    );
  }
  throw new RuntimeError("unreachable");
}

function persistEnvelope(
  run: Run,
  phase: Phase,
  agentName: string,
  call: AgentCall,
  envelope: EnvelopeBase | null,
  attempt: number,
  valid: boolean,
  raw = "",
): void {
  const payloadJson = envelope
    ? call.outputType.dumpJson(envelope, 2)
    : pyJson({ raw: pyTail(raw, 2000) });
  run.tracer.envelopeRow(phase, agentName, call.outputType.name, payloadJson, valid, attempt);
  if (envelope) {
    const record = {
      agent_name: agentName,
      purpose: resolve(run.cfg, agentName).purpose,
      output_type: call.outputType.name,
      attempt,
      ...call.outputType.dump(envelope),
    };
    writeFileSync(join(run.sessionDir, agentName, "envelope.json"), pyJson(record, 2));
  }
}
