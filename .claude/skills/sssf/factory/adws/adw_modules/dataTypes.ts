import { fieldNames, modelDump, modelValidate, type Schema } from "./schema.ts";

export type PhaseKind = "engineer" | "agent" | "code";
export type PhaseStatus = "queued" | "running" | "success" | "fail";
export type QualityArea = "frontend" | "backend";
export type QualityOperation = "lint" | "typecheck" | "build";

export interface EnvelopeType<T extends EnvelopeBase = EnvelopeBase> {
  name: string;
  schema: Schema;
  parse(payload: unknown): T;
  dump(obj: T): Record<string, unknown>;
  dumpJson(obj: T, indent?: number): string;
  fields: string[];
}

export interface EnvelopeBase {
  status: "success" | "fail";
  summary: string;
  artifacts: string[];
  notes_for_next_agent: string;
}

const envelopeBaseFields = [
  { name: "status", kind: "literal" as const, literals: ["success", "fail"] },
  { name: "summary", kind: "str" as const, default: "" },
  { name: "artifacts", kind: "list" as const, defaultFactory: () => [], inner: { name: "item", kind: "str" as const } },
  { name: "notes_for_next_agent", kind: "str" as const, default: "" },
];

function envelopeType<T extends EnvelopeBase>(name: string, extra: Schema["fields"] = []): EnvelopeType<T> {
  const schema: Schema = { name, fields: [...envelopeBaseFields, ...extra] };
  return {
    name,
    schema,
    fields: fieldNames(schema),
    parse(payload: unknown): T {
      return modelValidate(schema, payload) as T;
    },
    dump(obj: T): Record<string, unknown> {
      return modelDump(schema, obj as unknown as Record<string, unknown>);
    },
    dumpJson(obj: T, indent?: number): string {
      return JSON.stringify(modelDump(schema, obj as unknown as Record<string, unknown>), null, indent);
    },
  };
}

export const GenericOutput = envelopeType<EnvelopeBase>("GenericOutput");

export interface PlanOutput extends EnvelopeBase {
  commit_message: string;
}
export const PlanOutput = envelopeType<PlanOutput>("PlanOutput", [
  { name: "commit_message", kind: "str", default: "" },
]);

export interface BuildOutput extends EnvelopeBase {
  changed_files: string[];
  commit_message: string;
}
export const BuildOutput = envelopeType<BuildOutput>("BuildOutput", [
  { name: "changed_files", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
  { name: "commit_message", kind: "str", default: "" },
]);

export interface ScoutFinding {
  file: string;
  note: string;
}
export interface ScoutOutput extends EnvelopeBase {
  findings: ScoutFinding[];
}
export const ScoutOutput = envelopeType<ScoutOutput>("ScoutOutput", [
  {
    name: "findings",
    kind: "list",
    defaultFactory: () => [],
    inner: {
      name: "item",
      kind: "model",
      model: {
        name: "ScoutFinding",
        fields: [
          { name: "file", kind: "str" },
          { name: "note", kind: "str", default: "" },
        ],
      },
    },
  },
]);

export interface ReviewFinding {
  requirement: string;
  met: boolean;
  evidence: string;
}
export interface ReviewOutput extends EnvelopeBase {
  approved: boolean;
  findings: ReviewFinding[];
  blocking: string[];
}
export const ReviewOutput = envelopeType<ReviewOutput>("ReviewOutput", [
  { name: "approved", kind: "bool", default: false },
  {
    name: "findings",
    kind: "list",
    defaultFactory: () => [],
    inner: {
      name: "item",
      kind: "model",
      model: {
        name: "ReviewFinding",
        fields: [
          { name: "requirement", kind: "str" },
          { name: "met", kind: "bool" },
          { name: "evidence", kind: "str", default: "" },
        ],
      },
    },
  },
  { name: "blocking", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
]);

export interface DocumentOutput extends EnvelopeBase {
  document_path: string;
  documented_files: string[];
  commit_message: string;
}
export const DocumentOutput = envelopeType<DocumentOutput>("DocumentOutput", [
  { name: "document_path", kind: "str", default: "" },
  { name: "documented_files", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
  { name: "commit_message", kind: "str", default: "" },
]);

export interface VerifyOutput extends EnvelopeBase {
  passed: boolean;
  failures: string[];
}
export const VerifyOutput = envelopeType<VerifyOutput>("VerifyOutput", [
  { name: "passed", kind: "bool", default: false },
  { name: "failures", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
]);

export interface ChangesOutput extends EnvelopeBase {
  base: string;
  changed_files: string[];
  insertions: number;
  deletions: number;
  stat: string;
  diff_path: string;
}
export const ChangesOutput = envelopeType<ChangesOutput>("ChangesOutput", [
  { name: "base", kind: "str", default: "" },
  { name: "changed_files", kind: "list", defaultFactory: () => [], inner: { name: "item", kind: "str" } },
  { name: "insertions", kind: "int", default: 0 },
  { name: "deletions", kind: "int", default: 0 },
  { name: "stat", kind: "str", default: "" },
  { name: "diff_path", kind: "str", default: "" },
]);

export interface PhaseParams {
  name: string;
  kind: PhaseKind;
  owner: string;
  description: string;
  retries?: number;
}

export interface Phase {
  phase_id: string;
  adw_id: string;
  seq: number;
  params: Required<PhaseParams>;
  status: PhaseStatus;
  attempt: number;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
}

export function newPhase(args: { adw_id: string; seq: number; params: Required<PhaseParams> }): Phase {
  return {
    phase_id: `${args.adw_id}_${String(args.seq).padStart(2, "0")}_${args.params.name}`,
    adw_id: args.adw_id,
    seq: args.seq,
    params: args.params,
    status: "fail",
    attempt: 0,
    error: null,
    started_at: null,
    ended_at: null,
  };
}

export interface QualityCheckSpec {
  name: string;
  area: QualityArea;
  operation: QualityOperation;
  argv: string[];
  timeoutSeconds: number;
}

export interface QualityCheckResult {
  name: string;
  area: QualityArea;
  operation: QualityOperation;
  command: string;
  returncode: number;
  passed: boolean;
  duration_seconds: number;
  output_artifact: string;
  output_tail: string;
}

export interface QualityResult {
  passed: boolean;
  checks: QualityCheckResult[];
  failures: string[];
  artifacts: string[];
}

export interface ChangeCapture {
  base: string;
  maxDiffLines: number;
  includeUntracked: boolean;
}

export interface BaseRef {
  ref: string;
  commit: string;
  reason: string;
  get label(): string;
}

export function baseRef(ref: string, commit: string, reason = ""): BaseRef {
  return {
    ref,
    commit,
    reason,
    get label() {
      if (this.ref.length === 40 && [...this.ref].every((c) => "0123456789abcdef".includes(c))) {
        return this.ref.slice(0, 7);
      }
      return this.ref;
    },
  };
}

export interface ChangeSet {
  base: BaseRef;
  files: string[];
  untracked: string[];
  insertions: number;
  deletions: number;
  stat: string;
  diff_path: string;
  truncated: boolean;
  get empty(): boolean;
}

export function changeSet(args: Omit<ChangeSet, "empty">): ChangeSet {
  return {
    ...args,
    get empty() {
      return !(this.files.length || this.untracked.length);
    },
  };
}

export interface GateCheck {
  item: string;
  ok: boolean;
  note: string;
}

export class GateReport {
  checks: GateCheck[] = [];

  check(item: string, ok: boolean, note = ""): this {
    this.checks.push({ item, ok, note });
    return this;
  }

  get violations(): string[] {
    return this.checks.filter((c) => !c.ok).map((c) => `${c.item}: ${c.note || "failed"}`);
  }

  get passed(): boolean {
    return this.violations.length === 0;
  }
}

export type GateFn = (envelope: EnvelopeBase, run: unknown) => GateReport | string[];

export interface AgentCall {
  outputType: EnvelopeType;
  prompt: string;
  previous?: EnvelopeBase | null;
  gates?: GateFn[];
}

export const DEFAULT_PROTECTED = ["adws/adw_modules/", "adws/adw_sssf_config/", "adws/adw_*.ts"];

export function defaultConfig(): SSSFConfig {
  return {
    defaults: {
      coding_agent: "pi",
      model: "google/gemini-3.6-flash",
      thinking: "medium",
      color: "",
      harness_engineering: [],
      tools: null,
      protected_files: [...DEFAULT_PROTECTED],
      data_dir: "adws/adw_data",
    },
    observability: { db: "adws/adw_data/sssf.db", poll_ms: 500 },
    agents: [],
  };
}

const BASE = defaultConfig();

const STR_LIST = { name: "item", kind: "str" as const };

export interface PromptEngineering {
  system: string;
  user: string;
}

const PROMPT_ENGINEERING: Schema = {
  name: "PromptEngineering",
  fields: [
    { name: "system", kind: "str" },
    { name: "user", kind: "str" },
  ],
};

export interface AgentConfig {
  name: string;
  coding_agent: string;
  model: string;
  thinking: string;
  color: string;
  purpose: string;
  prompt_engineering: PromptEngineering;
  harness_engineering: string[];
  tools: string[] | null;
  writes: string[] | null;
  command: string[];
}

const AGENT_CONFIG: Schema = {
  name: "AgentConfig",
  fields: [
    { name: "name", kind: "str" },
    { name: "coding_agent", kind: "str", default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "purpose", kind: "str", default: "" },
    { name: "prompt_engineering", kind: "model", model: PROMPT_ENGINEERING },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "writes", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "command", kind: "list", defaultFactory: () => [], inner: STR_LIST },
  ],
};

export interface ConfigDefaults {
  coding_agent: string;
  model: string;
  thinking: string;
  color: string;
  harness_engineering: string[];
  tools: string[] | null;
  protected_files: string[];
  data_dir: string;
}

const CONFIG_DEFAULTS: Schema = {
  name: "ConfigDefaults",
  fields: [
    { name: "coding_agent", kind: "str", default: "pi" },
    { name: "model", kind: "str", default: BASE.defaults.model },
    { name: "thinking", kind: "str", default: BASE.defaults.thinking },
    { name: "color", kind: "str", default: "" },
    { name: "harness_engineering", kind: "list", defaultFactory: () => [], inner: STR_LIST },
    { name: "tools", kind: "list", optional: true, default: null, inner: STR_LIST },
    { name: "protected_files", kind: "list", defaultFactory: () => [...DEFAULT_PROTECTED], inner: STR_LIST },
    { name: "data_dir", kind: "str", default: BASE.defaults.data_dir },
  ],
};

export interface ObservabilityConfig {
  db: string;
  poll_ms: number;
}

const OBSERVABILITY_CONFIG: Schema = {
  name: "ObservabilityConfig",
  fields: [
    { name: "db", kind: "str", default: BASE.observability.db },
    { name: "poll_ms", kind: "int", default: BASE.observability.poll_ms },
  ],
};

export interface SSSFConfig {
  defaults: ConfigDefaults;
  observability: ObservabilityConfig;
  agents: AgentConfig[];
}

export const SSSF_CONFIG: Schema = {
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

export interface EventRecord {
  adw_id: string;
  phase_id?: string;
  type: string;
  name?: string;
  payload?: Record<string, unknown>;
  parent_id?: string;
  tokens?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
}
