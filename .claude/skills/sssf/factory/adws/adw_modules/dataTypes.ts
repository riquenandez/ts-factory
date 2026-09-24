import { fieldNames, modelDump, modelValidate, type Schema } from "./schema.ts";

export type PhaseKind = "engineer" | "agent" | "code";

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

