import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "./agents.ts";
import { Console, errorText } from "./console.ts";
import {
  newPhase,
  validatePhaseParams,
  type AgentCall,
  type EnvelopeBase,
  type EnvelopeType,
  type Phase,
  type PhaseParams,
  type SSSFConfig,
} from "./dataTypes.ts";
import { repoRoot } from "./gitHelper.ts";
import { Tracer } from "./tracer.ts";
import { pyJson } from "./compat/json.ts";
import { pyStr } from "./compat/format.ts";
import { nowIso, runCleanups, RuntimeError } from "./utils.ts";

export { registerCleanup, runCleanups } from "./utils.ts";

export class PhaseHandle {
  constructor(readonly run: Run, readonly phase: Phase) {}

  log(payload: Record<string, unknown>): void {
    this.run.tracer.event({
      adw_id: this.run.adwId,
      phase_id: this.phase.phase_id,
      type: "log",
      name: this.phase.params.name,
      payload,
    });
    this.run.console.note(
      Object.entries(payload).map(([k, v]) => `${k}: ${pyStr(v)}`).join(", "),
    );
    if (this.phase.params.kind === "engineer" && "input" in payload) {
      this.run.tracer.sessionRequest(this.run.adwId, pyStr(payload.input));
    }
  }

  call<T extends EnvelopeBase = EnvelopeBase>(
    _call: AgentCall & { outputType: EnvelopeType<T> },
  ): Promise<T> {
    throw new RuntimeError("ph.call() is only valid inside an agent phase");
  }
}

export class AgentPhaseHandle extends PhaseHandle {
  override call<T extends EnvelopeBase = EnvelopeBase>(
    call: AgentCall & { outputType: EnvelopeType<T> },
  ): Promise<T> {
    return execute(this.run, this.phase, call) as Promise<T>;
  }
}

interface OpenPhase {
  phase: Phase;
  clock: number;
}

export class Run {
  readonly cfg: SSSFConfig;
  readonly adwId: string;
  readonly tracer: Tracer;
  readonly console: Console;
  readonly engineer: string;
  readonly phases: Phase[] = [];
  tokens = 0;
  cost = 0;
  readonly repoRoot: string;
  readonly sessionDir: string;
  readonly contextHandoffDir: string;
  readonly agentMap: Record<string, { session_id: string; model: string; coding_agent: string }>;
  private seq: number;
  private open: OpenPhase | null = null;

  constructor(args: { cfg: SSSFConfig; adwId: string; tracer: Tracer; engineer: string }) {
    this.cfg = args.cfg;
    this.adwId = args.adwId;
    this.tracer = args.tracer;
    this.engineer = args.engineer;
    this.console = new Console(args.tracer, args.adwId);
    this.repoRoot = repoRoot();
    this.sessionDir = join(args.cfg.defaults.data_dir, "sessions", args.adwId);
    this.contextHandoffDir = join(this.sessionDir, "context_handoff");
    mkdirSync(this.sessionDir, { recursive: true });
    mkdirSync(this.contextHandoffDir, { recursive: true });
    const mapPath = join(this.sessionDir, "agent_map.json");
    this.agentMap = existsSync(mapPath)
      ? JSON.parse(readFileSync(mapPath, "utf8")) as Run["agentMap"]
      : {};
    this.seq = this.tracer.maxPhaseSeq(args.adwId);
  }

  saveAgentMap(agent: string, entry: { session_id: string; model: string; coding_agent: string }): void {
    this.agentMap[agent] = entry;
    writeFileSync(join(this.sessionDir, "agent_map.json"), pyJson(this.agentMap, 2));
  }

  addUsage(tokens: number, cost: number): void {
    this.tokens += tokens;
    this.cost += cost;
    this.tracer.sessionAddUsage(this.adwId, tokens, cost);
  }

  async phase<T>(params: PhaseParams, body: (ph: PhaseHandle) => T | Promise<T>): Promise<T> {
    const earned = validatePhaseParams(params);
    this.seq += 1;
    const phase = newPhase({ adw_id: this.adwId, seq: this.seq, params: earned });
    phase.status = "running";
    phase.started_at = nowIso();
    this.phases.push(phase);
    this.tracer.phaseUpsert(phase);
    this.tracer.event({
      adw_id: this.adwId,
      phase_id: phase.phase_id,
      type: "phase_start",
      name: earned.name,
      payload: { kind: earned.kind, owner: earned.owner, description: earned.description },
    });
    this.console.phaseStarted(phase);
    const open: OpenPhase = { phase, clock: performance.now() };
    this.open = open;
    const handle = earned.kind === "agent"
      ? new AgentPhaseHandle(this, phase)
      : new PhaseHandle(this, phase);
    try {
      const result = await body(handle);
      this.open = null;
      phase.status = "success";
      phase.ended_at = nowIso();
      this.tracer.event({
        adw_id: this.adwId,
        phase_id: phase.phase_id,
        type: "phase_end",
        name: earned.name,
        payload: { status: "success" },
      });
      this.tracer.phaseUpsert(phase);
      this.console.phaseEnded(phase, (performance.now() - open.clock) / 1000);
      return result;
    } catch (error) {
      this.open = null;
      this.failPhase(open, errorText(error));
      throw error;
    }
  }

  /** The `except BaseException` arm of Python's phase context manager. */
  private failPhase({ phase, clock }: OpenPhase, error: string): void {
    phase.status = "fail";
    phase.error = error;
    phase.ended_at = nowIso();
    this.tracer.event({
      adw_id: this.adwId,
      phase_id: phase.phase_id,
      type: "error",
      name: phase.params.name,
      payload: { error: phase.error },
    });
    this.tracer.event({
      adw_id: this.adwId,
      phase_id: phase.phase_id,
      type: "phase_end",
      name: phase.params.name,
      payload: { status: "fail" },
    });
    this.tracer.phaseUpsert(phase);
    this.tracer.sessionFinish(this.adwId, false);
    this.console.phaseEnded(phase, (performance.now() - clock) / 1000);
    this.console.sessionFinished(false, this.tokens, this.cost, this.cfg.observability.db);
  }

  finish(opts: { accepted?: boolean; reason?: string } = {}): number {
    const accepted = opts.accepted ?? true;
    const phasesOk = this.phases.length > 0 && this.phases.every((p) => p.status === "success");
    const ok = phasesOk && accepted;
    if (phasesOk && !accepted) {
      const note = opts.reason || "the run's acceptance criterion was not met";
      this.tracer.event({
        adw_id: this.adwId,
        phase_id: this.phases.at(-1)?.phase_id ?? "",
        type: "error",
        name: "not_accepted",
        payload: { reason: note },
      });
      this.console.note(`not accepted: ${note}`);
    }
    this.tracer.sessionFinish(this.adwId, ok);
    this.console.sessionFinished(ok, this.tokens, this.cost, this.cfg.observability.db);
    return ok ? 0 : 1;
  }

  /**
   * SIGTERM / SIGINT. Python's handler closes the session, then raises
   * SystemExit(128+signum) inside the open phase, so that phase fails too.
   */
  signalDoor(signum: number): never {
    const live = this.tracer.conn
      .query("SELECT pid FROM processes WHERE adw_id=? AND kind='agent' AND ended_at IS NULL")
      .all(this.adwId) as Array<{ pid: number }>;
    for (const { pid } of live) {
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") continue;
        throw error;
      }
    }
    runCleanups();
    this.tracer.sessionFinish(this.adwId, false);
    if (this.open) this.failPhase(this.open, String(128 + signum));
    process.exit(128 + signum);
  }
}
