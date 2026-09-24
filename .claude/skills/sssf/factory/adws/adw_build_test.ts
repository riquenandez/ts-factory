#!/usr/bin/env bun
const DOC = `ADW Build Test — implement, then verify; failures flow back into the builder.

Phases: engineer(request) -> builder -> code(test) [-> builder(fix) -> code(test) ... bounded]

Testing is CODE. The suite's command is written down in adw_modules/quality.ts,
so running it needs no judgement — only repairing it does. Failures reach the
builder as an envelope through \`quality.asEnvelope\`, which is the same door an
agent's report came through, so the repair loop is unchanged.

A failing suite does NOT fail its phase: the runner did its job, the code is
what failed. It fails the run, checked at the end, after the bounded fix loop
has had its chances.
`;

import * as agents from "./adw_modules/agents.ts";
import * as gates from "./adw_modules/gates.ts";
import * as quality from "./adw_modules/quality.ts";
import * as session from "./adw_modules/session.ts";
import { adw } from "./adw_modules/cli.ts";
import { BuildOutput } from "./adw_modules/dataTypes.ts";
import type { QualityResult } from "./adw_modules/quality.ts";

const REQUIRED_AGENTS = ["builder"];
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

  await run.phase({
    name: "build",
    kind: "agent",
    owner: "builder",
    description: "Implement the request",
  }, async (ph) => {
    return await ph.call({
      outputType: BuildOutput,
      prompt,
      gates: [gates.diffMatchesClaims],
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

    await run.phase({
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
        gates: [gates.diffMatchesClaims],
      }) as BuildOutput;
    });
  }

  return run.finish({
    accepted: test !== null && test.passed,
    reason: `the suite still failed after ${MAX_FIX_LOOPS} fix attempt(s)`,
  });
});
