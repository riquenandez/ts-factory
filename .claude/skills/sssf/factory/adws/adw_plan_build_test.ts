#!/usr/bin/env bun
const DOC = `ADW Plan Build Test — the full starter chain.

Phases: engineer(request) -> planner -> builder -> code(test) [-> builder(fix) -> code(test) ... bounded] -> git(commit)

Testing is CODE: the suite's command lives in adw_modules/quality.ts,
so no agent spends a context window rediscovering it. Failures flow back to the
builder as an envelope, and only an exhausted fix loop fails the run.
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as gitHelper from "./adw_modules/gitHelper.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { BuildOutput, PlanOutput } from "./adw_modules/dataTypes.ts";
import type { QualityResult } from "./adw_modules/quality.ts";

const REQUIRED_AGENTS = ["planner", "builder"];
const MAX_FIX_LOOPS = 3;

await adw(DOC, async ({ cfg, prompt, adwId }) => {
  agents.validate(cfg, REQUIRED_AGENTS);
  const run = session.ensure(cfg, adwId);

  function record(ph: { log: (payload: Record<string, unknown>) => void }, result: QualityResult): void {
    const passed = result.checks.filter((check) => check.passed).length;
    ph.log({
      passed: result.passed,
      checks: `${passed}/${result.checks.length}`,
      artifacts: result.artifacts.join(", "),
    });
  }

  await run.request(prompt);

  const plan = await run.phase({
    name: "plan",
    kind: "agent",
    owner: "planner",
    description: "Turn the request into an implementable plan",
  }, async (ph) => {
    return await ph.call({
      outputType: PlanOutput,
      prompt,
      gates: [gates.artifactsExist, gates.filesNonEmpty],
    }) as PlanOutput;
  });

  let previous = await run.phase({
    name: "build",
    kind: "agent",
    owner: "builder",
    description: "Implement the plan exactly",
  }, async (ph) => {
    return await ph.call({
      outputType: BuildOutput,
      prompt,
      previous: plan,
      gates: [gates.artifactsExist],
    }) as BuildOutput;
  });

  let test: QualityResult | null = null;
  for (let i = 1; i <= MAX_FIX_LOOPS; i++) {
    test = await run.phase({
      name: `test_${i}`,
      kind: "code",
      owner: "quality",
      description: "Run the suite — a known command, so code runs it and no agent has to rediscover it",
    }, async (ph) => {
      const result = quality.runTests(run);
      record(ph, result);
      return result;
    });

    if (test.passed) {
      break;
    }

    previous = await run.phase({
      name: `fix_${i}`,
      kind: "agent",
      owner: "builder",
      retries: 1,
      description: "Repair what the suite reported, from its verbatim output",
    }, async (ph) => {
      return await ph.call({
        outputType: BuildOutput,
        prompt,
        previous: quality.asEnvelope(test!, "tests"),
        gates: [gates.artifactsExist],
      }) as BuildOutput;
    });
  }

  // Only tested work gets committed — a red suite leaves the tree uncommitted.
  if (test !== null && test.passed) {
    await run.phase({
      name: "commit",
      kind: "code",
      owner: "git",
      description: "Land the code only after the suite came back green",
    }, async (ph) => {
      const message = previous.commit_message || `sssf(${run.adwId}): ${previous.summary}`;
      ph.log({ sha: gitHelper.commitAll(message), message });
    });
  }

  return run.finish({
    accepted: test !== null && test.passed,
    reason: `the suite still failed after ${MAX_FIX_LOOPS} fix attempt(s)`,
  });
});
