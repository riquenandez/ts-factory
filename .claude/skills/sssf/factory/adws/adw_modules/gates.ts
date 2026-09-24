import { existsSync, readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { spawnShell } from "./shell.ts";
import { GateReport, type EnvelopeBase, type GateFn } from "./dataTypes.ts";

const TAIL_CHARS = 1000;

function _size(path: string): string {
  const n = statSync(path).size;
  return n < 1024 ? `${n}B` : `${(n / 1024).toFixed(1)}KB`;
}

function jsonTypeName(value: unknown, raw: string): string {
  if (value === null) return "NoneType";
  if (typeof value === "boolean") return "bool";
  if (typeof value === "string") return "str";
  if (Array.isArray(value)) return "list";
  if (typeof value === "number") {
    return /^-?\d+$/.test(raw.trim()) ? "int" : "float";
  }
  return "dict";
}

export function artifactsExist(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  for (const a of envelope.artifacts) {
    report.check(
      a,
      existsSync(a),
      existsSync(a) ? `exists, ${_size(a)}` : "declared artifact does not exist",
    );
  }
  return report;
}

export function filesNonEmpty(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  for (const a of envelope.artifacts) {
    if (!(existsSync(a) && statSync(a).isFile())) {
      continue;
    }
    const empty = statSync(a).size === 0;
    report.check(a, !empty, empty ? "declared artifact is empty" : _size(a));
  }
  return report;
}

export function jsonParses(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  for (const a of envelope.artifacts) {
    if (extname(a) !== ".json" || !existsSync(a)) {
      continue;
    }
    try {
      const text = readFileSync(a, "utf8");
      const parsed = JSON.parse(text);
      report.check(a, true, `parses, ${jsonTypeName(parsed, text)}`);
    } catch (e) {
      report.check(a, false, `declared JSON artifact does not parse: ${e instanceof Error ? e.message : e}`);
    }
  }
  return report;
}

export function diffMatchesClaims(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  const files = (envelope as EnvelopeBase & { changed_files?: string[] }).changed_files ?? [];
  for (const f of files) {
    report.check(
      f,
      existsSync(f),
      existsSync(f) ? `exists, ${_size(f)}` : "claimed changed file does not exist",
    );
  }
  return report;
}

export function verdictConsistent(envelope: EnvelopeBase, _run: unknown): GateReport {
  const report = new GateReport();
  const rec = envelope as EnvelopeBase & {
    approved?: unknown;
    blocking?: unknown;
    findings?: Array<{ requirement: string; met: boolean }>;
  };
  const approved = Boolean(rec.approved ?? false);
  const blocking = Array.isArray(rec.blocking) ? [...rec.blocking] : [];
  const unmet = (rec.findings ?? []).filter((f) => !f.met).map((f) => f.requirement);

  report.check(
    "approved vs blocking",
    !(approved && blocking.length),
    !blocking.length
      ? "no blocking items"
      : approved
        ? `${blocking.length} blocking item(s) while approved=true`
        : `${blocking.length} blocking item(s), not approved`,
  );
  report.check(
    "approved vs findings",
    !(approved && unmet.length),
    !unmet.length
      ? "every requirement met"
      : approved
        ? `${unmet.length} unmet requirement(s) while approved=true`
        : `${unmet.length} unmet requirement(s), not approved`,
  );
  report.check(
    "rejection names a problem",
    approved || Boolean(blocking.length || unmet.length),
    approved || blocking.length || unmet.length
      ? "verdict is supported"
      : "approved=false but no blocking item or unmet requirement was given",
  );
  return report;
}

Object.defineProperty(artifactsExist, "name", { value: "artifacts_exist" });
Object.defineProperty(filesNonEmpty, "name", { value: "files_non_empty" });
Object.defineProperty(jsonParses, "name", { value: "json_parses" });
Object.defineProperty(diffMatchesClaims, "name", { value: "diff_matches_claims" });
Object.defineProperty(verdictConsistent, "name", { value: "verdict_consistent" });

export function testsPass(command: string): GateFn {
  function gate(_envelope: EnvelopeBase, _run: unknown): GateReport {
    const result = spawnShell(command);
    const ok = result.returncode === 0;
    let note = `exit ${result.returncode}`;
    if (!ok) {
      note += "\n" + (result.stdout + result.stderr).slice(-TAIL_CHARS);
    }
    return new GateReport().check(command, ok, note);
  }
  Object.defineProperty(gate, "name", { value: `tests_pass(${command})` });
  return gate;
}
