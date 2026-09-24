import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve, type AgentConfig } from "./agents.ts";
import { GateReport, type AgentCall, type EnvelopeBase } from "./dataTypes.ts";
import { PermissionBreach, enforce, snapshot } from "./permissions.ts";
import type { Phase, Run } from "./runner.ts";
import { interfaceFor } from "./runtimes/index.ts";
import {
  UsageBreakdown,
  type AgentEvent,
  type AgentRequest,
  type AgentResult,
  type ToolCallTracker,
} from "./runtimes/types.ts";

type Send = (prompt_text: string) => Promise<AgentResult>;

export async function execute(run: Run, phase: Phase, call: AgentCall): Promise<EnvelopeBase> {
  const agent = resolve(run.cfg, phase.params.owner);
  const iface = interfaceFor(agent);
  const agentDir = join(run.sessionDir, agent.name);
  mkdirSync(agentDir, { recursive: true });

  const variables = {
    prompt: call.prompt,
    previous_envelope: call.previous ? JSON.stringify(call.previous, null, 2) : "(none)",
    context_handoff_dir: run.contextHandoffDir,
  };
  const systemText = render(agent.prompt_engineering.system, variables);
  const userText = render(agent.prompt_engineering.user, variables);
  save(join(agentDir, "prompts"), "system.md", systemText);
  save(join(agentDir, "prompts"), "user.md", userText);

  const sessionId = reuseOrMint(run, agent, () => iface.mintSessionId(run.adwId, agent.name));
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

  let latest: AgentResult | null = null;
  const spent = new UsageBreakdown();
  const forward = eventForwarder(run, phase, agent.name, iface.newTracker());
  // Absolute, like Path.resolve(): the agent subprocess reads these from repoRoot.
  const agentDirAbs = realpathSync(agentDir);

  const send: Send = async (promptText) => {
    const request: AgentRequest = {
      prompt: promptText,
      system_prompt: systemText,
      model: agent.model,
      thinking: agent.thinking,
      session_id: sessionId,
      session_dir: join(agentDirAbs, iface.sessionDirName),
      raw_output_path: join(agentDirAbs, "raw_output.jsonl"),
      tools: agent.tools,
      extensions: agent.harness_engineering,
      cwd: run.repoRoot,
      command: agent.command,
    };
    const result = await iface.run(
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
  const context: AgentResult = latest ?? result;
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
    throw new Error(`${agent.name} reported status='${envelope.status}': ${envelope.summary}`);
  }
  return envelope;
}

function render(templatePath: string, variables: Record<string, string>): string {
  let text = readFileSync(templatePath, "utf8");
  for (const [key, value] of Object.entries(variables)) {
    text = text.replaceAll("{{" + key + "}}", value);
  }
  return text;
}

function save(directory: string, name: string, content: string): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, content);
  return path;
}

function reuseOrMint(run: Run, agent: AgentConfig, mint: () => string): string {
  const entry = run.agentMap[agent.name];
  if (entry && entry.model === agent.model) return entry.session_id;
  return mint();
}

function eventForwarder(
  run: Run,
  phase: Phase,
  agentName: string,
  tracker: ToolCallTracker,
): (event: AgentEvent) => void {
  return (event) => {
    const record = tracker.observe(event);
    if (record === null) return;
    const { label, started_at, ended_at, ...rest } = record;
    run.tracer.event({
      adw_id: run.adwId,
      phase_id: phase.phase_id,
      type: "tool_call",
      name: String(label),
      started_at: started_at ?? null,
      ended_at: ended_at ?? null,
      payload: { ...rest, agent: agentName },
    });
  };
}

export const JSON_FIX_ATTEMPTS = 2;

async function parseWithRetries(
  run: Run,
  phase: Phase,
  call: AgentCall,
  result: AgentResult,
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
      throw new Error(
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
  throw new Error("unreachable");
}

export function extractJson(text: string): unknown {
  let candidate = text;
  if (text.includes("```")) {
    const blocks = text.split("```");
    for (let i = 1; i < blocks.length; i += 2) {
      const rawBlock = blocks[i]!;
      const block = (rawBlock.startsWith("json") ? rawBlock.slice("json".length) : rawBlock).trim();
      if (block.startsWith("{")) {
        candidate = block;
        break;
      }
    }
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object found in the response");
  return JSON.parse(candidate.slice(start, end + 1));
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
    : JSON.stringify({ raw: raw.slice(-2000) });
  run.tracer.envelopeRow(phase, agentName, call.outputType.name, payloadJson, valid, attempt);
  if (envelope) {
    const record = {
      agent_name: agentName,
      purpose: resolve(run.cfg, agentName).purpose,
      output_type: call.outputType.name,
      attempt,
      ...call.outputType.dump(envelope),
    };
    writeFileSync(join(run.sessionDir, agentName, "envelope.json"), JSON.stringify(record, null, 2));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asReport(result: GateReport | string[] | null | undefined): GateReport {
  if (result instanceof GateReport) return result;
  const report = new GateReport();
  for (const violation of result ?? []) report.check(String(violation), false);
  return report;
}

export class GateFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateFailure";
  }
}
