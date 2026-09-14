import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixed, pyTail } from "./compat/format.ts";
import { shlexJoin, spawnCaptured } from "./compat/shell.ts";
import type {
  QualityCheckResult,
  QualityCheckSpec,
  QualityResult,
  VerifyOutput,
} from "./dataTypes.ts";
import type { Run } from "./runner.ts";
import { nowIso, operatorEnv } from "./utils.ts";

const TAIL_CHARS = 4000;

function placeholder(name: string): string[] {
  return [
    "echo",
    `PLACEHOLDER ${name}: edit adws/adw_modules/quality.ts and ` +
      `replace this echo with the real ${name} command`,
  ];
}

function checkDir(run: Run, name: string): string {
  const seq = run.phases.length ? run.phases[run.phases.length - 1]!.seq : 0;
  const path = join(run.contextHandoffDir, "quality", `${String(seq).padStart(2, "0")}_${name}`);
  mkdirSync(path, { recursive: true });
  return path;
}

function _run(spec: QualityCheckSpec, run: Run): QualityCheckResult {
  const phase = run.phases[run.phases.length - 1]!;
  const outputDir = checkDir(run, spec.name);
  const outputArtifact = join(outputDir, "command.log");
  const command = shlexJoin(spec.argv);
  const env = operatorEnv();

  run.console.note(`quality ${spec.name}: ${command}`);
  const startedAt = nowIso();
  const clock = performance.now();
  const completed = spawnCaptured(spec.argv, {
    cwd: run.repoRoot,
    env,
    timeoutSeconds: spec.timeoutSeconds,
  });
  const returncode = completed.returncode;
  const stdout = completed.stdout;
  const stderr = completed.stderr;

  const duration = (performance.now() - clock) / 1000;
  writeFileSync(
    outputArtifact,
    `$ ${command}\nexit: ${returncode}\nduration_seconds: ${fixed(duration, 3)}\n` +
      `\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}\n`,
  );
  const passed = returncode === 0;
  run.tracer.event({
    adw_id: run.adwId,
    phase_id: phase.phase_id,
    type: "tool_call",
    name: `quality:${spec.name}`,
    payload: {
      area: spec.area,
      operation: spec.operation,
      command,
      returncode,
      passed,
      output_artifact: outputArtifact,
    },
    started_at: startedAt,
    ended_at: nowIso(),
  });
  run.console.note(
    `quality ${spec.name}: ${passed ? "passed" : "failed"} ` +
      `(exit ${returncode}, ${fixed(duration, 1)}s)`,
  );
  return {
    name: spec.name,
    area: spec.area,
    operation: spec.operation,
    command,
    returncode,
    passed,
    duration_seconds: duration,
    output_artifact: outputArtifact,
    output_tail: pyTail(stdout + stderr, TAIL_CHARS),
  };
}

export function test(run: Run): QualityCheckResult {
  return _run(
    {
      name: "test",
      area: "backend",
      operation: "build",
      argv: placeholder("test"),
      timeoutSeconds: 600,
    },
    run,
  );
}

export function lint(run: Run): QualityCheckResult {
  return _run(
    {
      name: "lint",
      area: "backend",
      operation: "lint",
      argv: placeholder("lint"),
      timeoutSeconds: 120,
    },
    run,
  );
}

export function typecheck(run: Run): QualityCheckResult {
  return _run(
    {
      name: "typecheck",
      area: "backend",
      operation: "typecheck",
      argv: placeholder("typecheck"),
      timeoutSeconds: 120,
    },
    run,
  );
}

export function build(run: Run): QualityCheckResult {
  return _run(
    {
      name: "build",
      area: "backend",
      operation: "build",
      argv: placeholder("build"),
      timeoutSeconds: 120,
    },
    run,
  );
}

export function runTests(run: Run): QualityResult {
  const check = test(run);
  const failures = check.passed
    ? []
    : [
        `${check.name}: \`${check.command}\` exited ${check.returncode}\n` +
          check.output_tail.replace(/[ \t\n\r\f\v]+$/, ""),
      ];
  return {
    passed: check.passed,
    checks: [check],
    failures,
    artifacts: [check.output_artifact],
  };
}

export function asEnvelope(result: QualityResult, what: string): VerifyOutput {
  return {
    status: result.passed ? "success" : "fail",
    summary: result.passed
      ? `${what}: all ${result.checks.length} check(s) passed`
      : `${what}: ${result.failures.length} of ${result.checks.length} check(s) failed`,
    artifacts: result.artifacts,
    notes_for_next_agent: result.passed
      ? ""
      : "Fix every failure below. The output is verbatim from the " +
        "command — trust it over any summary.",
    passed: result.passed,
    failures: result.failures,
  };
}

export function runQuality(run: Run): QualityResult {
  const blocks = [test, lint, typecheck, build];
  const checks = blocks.map((block) => block(run));
  const failures = checks
    .filter((check) => !check.passed)
    .map((check) =>
      `${check.name}: \`${check.command}\` exited ${check.returncode}\n${check.output_tail}`.replace(
        /[ \t\n\r\f\v]+$/,
        "",
      ),
    );
  return {
    passed: !failures.length,
    checks,
    failures,
    artifacts: checks.map((check) => check.output_artifact),
  };
}
